/**
 * 계정 발급 — 스트리머(콘텐츠 업로드용)
 *
 * CLI(`scripts/make_streamer.js`)와 관리자 UI(`/admin/streamers`)가 **이 모듈 하나를 공유**한다.
 * 양쪽에 따로 구현하면 정책(권한·요율·안전장치)이 조용히 갈라진다.
 *
 * ⚠ role은 반드시 'bj'다. 'admin'을 주면 requireRole이 모든 역할 검사를 통과시켜
 *   (server/middleware/auth.js) 회원목록·거래내역·점검모드까지 열린다.
 */
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { db, stmts } = require('../db');
const svc = require('../service_types');

// 사람이 옮겨 적기 쉬운 문자만 (0/O, 1/l 등 혼동 문자 제외)
const PW_ALPHABET = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';

function generatePassword(len = 12) {
    return Array.from(crypto.randomBytes(len))
        .map((b) => PW_ALPHABET[b % PW_ALPHABET.length])
        .join('');
}

/**
 * 스트리머 계정 발급/갱신 (멱등)
 * @returns {{ok:true, id, loginId, stageName, password, generated, created}}
 *          실패 시 {ok:false, error} — error는 사용자에게 그대로 보여줄 수 있는 문구
 */
function provisionStreamer({ loginId, stageName, password }) {
    const login = String(loginId || '').trim();
    const stage = String(stageName || '').trim().slice(0, 40);

    if (!login || !stage) return { ok: false, error: '로그인 ID와 활동명은 필수입니다.' };
    if (login.length > 60)  return { ok: false, error: '로그인 ID가 너무 깁니다.' };

    const generated = !password;
    const pw = password || generatePassword();
    if (pw.length < 4) return { ok: false, error: '비밀번호는 4자 이상이어야 합니다.' };

    const hash = bcrypt.hashSync(pw, 10);
    const existing = stmts.findUserByEmail.get(login);
    let id;
    let created = false;

    if (existing) {
        // 관리자를 실수로 강등시키지 않는다
        if (existing.role === 'admin') {
            return { ok: false, error: `'${login}'은 관리자 계정입니다. 권한을 낮추지 않습니다.` };
        }
        id = existing.id;
        db.prepare("UPDATE users SET password_hash=?, role='bj', age_verified=1 WHERE id=?").run(hash, id);
    } else {
        let nick = stage;
        if (stmts.findUserByNick.get(nick)) nick = stage + '-' + Date.now().toString().slice(-4);
        const r = stmts.insertUser.run(login, hash, nick, 'bj', 1);
        id = Number(r.lastInsertRowid);
        created = true;
    }

    // 스튜디오가 프로필을 조회하므로 행이 없으면 화면이 깨진다 → 반드시 보장
    if (!db.prepare('SELECT user_id FROM bj_profiles WHERE user_id=?').get(id)) {
        stmts.insertBJProfile.run(id, stage, '콘텐츠 업로드 계정', 0, '');
    }

    // 업로드 전용 — 라이브 요율은 전부 0으로 막고 기기 제어도 끈다.
    // services는 최소 1개가 강제되므로 voice_1on1만 남긴다 (server/service_types.js)
    db.prepare(
        'UPDATE bj_profiles SET services=?, rate_per_minute=0, rate_with_video=0, rate_cam=0, ' +
        'sub_price=0, device_control=0, is_online=0 WHERE user_id=?'
    ).run(svc.normalizeServices(['voice_1on1']), id);

    return { ok: true, id, loginId: login, stageName: stage, password: pw, generated, created };
}

module.exports = { provisionStreamer, generatePassword };
