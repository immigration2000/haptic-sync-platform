/**
 * 마스터 계정 생성/갱신 (관리자 + 스트리머 권한)
 * 실행: node scripts/make_master.js   (~/pulse 에서)
 * role='admin' → requireRole이 admin은 모든 권한 통과(스트리머 페이지 포함).
 * + bj_profiles 행 생성 → 스튜디오/콘솔 정상 동작.
 */
const bcrypt = require('bcryptjs');
const { db, stmts } = require('../server/db');

const EMAIL = '1111';
const NICK  = '마스터';
const PW    = '2222';
const CREDITS = 99999999;

const hash = bcrypt.hashSync(PW, 10);

let u = stmts.findUserByEmail.get(EMAIL);
let id;
if (u) {
    id = u.id;
    db.prepare("UPDATE users SET password_hash=?, role='admin', age_verified=1, credits=? WHERE id=?")
      .run(hash, CREDITS, id);
    console.log('기존 계정 → 마스터로 갱신 (id=' + id + ')');
} else {
    let nick = NICK;
    if (stmts.findUserByNick.get(nick)) nick = NICK + '-' + id;
    const r = stmts.insertUser.run(EMAIL, hash, nick, 'admin', 1);
    id = Number(r.lastInsertRowid);
    db.prepare('UPDATE users SET credits=? WHERE id=?').run(CREDITS, id);
    console.log('새 마스터 계정 생성 (id=' + id + ', nick=' + nick + ')');
}

// 스트리머 프로필 보장 (모든 서비스/요율 활성)
const prof = db.prepare('SELECT user_id FROM bj_profiles WHERE user_id=?').get(id);
if (!prof) {
    stmts.insertBJProfile.run(id, '마스터', '마스터 계정 (관리자+스트리머)', 100, 'master');
    db.prepare("UPDATE bj_profiles SET rate_with_video=100, rate_cam=150, sub_price=1000, sub_days=30, " +
               "services='call,cowatch,live-priv,broadcast' WHERE user_id=?").run(id);
    console.log('스트리머 프로필 생성 (모든 서비스 활성)');
} else {
    console.log('스트리머 프로필 이미 존재');
}

const f = stmts.findUserById.get(id);
console.log('✅ 완료:', JSON.stringify({
    id: f.id, login: f.email, nickname: f.nickname, role: f.role,
    age_verified: f.age_verified, credits: f.credits, password: PW,
}));
