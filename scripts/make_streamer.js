/**
 * 스트리머 계정 발급 (콘텐츠 업로드용)
 *
 * 실행: node scripts/make_streamer.js <로그인ID> <활동명> [비밀번호]
 *   예: node scripts/make_streamer.js worker01 "콘텐츠팀"
 *       node scripts/make_streamer.js worker01 "콘텐츠팀" 원하는비번
 *
 * 비밀번호를 생략하면 무작위로 만들어 **화면에 한 번만** 출력한다.
 * 그 자리에서 복사해 전달할 것. 어디에도 저장하지 않는다.
 *
 * role='bj' — 관리자 화면(/admin)은 열리지 않는다.
 *   ⚠ role='admin'을 주면 requireRole이 모든 권한을 통과시켜(server/middleware/auth.js)
 *     회원목록·거래내역·점검모드까지 열린다. 콘텐츠 작업자에게는 절대 주지 말 것.
 *
 * 이 계정으로 할 수 있는 것: /bj-studio 에서 영상 + funscript 업로드, 자기 영상 관리.
 * 업로드 결과물은 public/content/bj/<userId>/ 에 저장되고
 * **그 계정의 스트리머 라이브러리**에 들어간다. 플랫폼 VOD/VR 카탈로그가 아니다.
 * (카탈로그 등재는 /admin/contents/add 로 경로를 등록하는 별도 단계)
 */
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { db, stmts } = require('../server/db');
const svc = require('../server/service_types');

const [, , loginId, stageNameArg, pwArg] = process.argv;

if (!loginId || !stageNameArg) {
    console.error('사용법: node scripts/make_streamer.js <로그인ID> <활동명> [비밀번호]');
    process.exit(1);
}

const STAGE = String(stageNameArg).trim().slice(0, 40);
const generated = !pwArg;
// 사람이 옮겨 적기 쉬운 문자만 사용 (0/O, 1/l 같은 혼동 문자 제외)
const PW = pwArg || Array.from(crypto.randomBytes(12))
    .map((b) => 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789'[b % 54]).join('');

const hash = bcrypt.hashSync(PW, 10);

let u = stmts.findUserByEmail.get(loginId);
let id;

if (u) {
    id = u.id;
    if (u.role === 'admin') {
        console.error(`❌ ${loginId} 은 관리자 계정입니다. 권한을 낮추지 않습니다. 다른 ID를 쓰세요.`);
        process.exit(1);
    }
    db.prepare("UPDATE users SET password_hash=?, role='bj', age_verified=1 WHERE id=?").run(hash, id);
    console.log(`기존 계정을 스트리머로 갱신 (id=${id})`);
} else {
    let nick = STAGE;
    if (stmts.findUserByNick.get(nick)) nick = STAGE + '-' + Date.now().toString().slice(-4);
    const r = stmts.insertUser.run(loginId, hash, nick, 'bj', 1);
    id = Number(r.lastInsertRowid);
    console.log(`새 스트리머 계정 생성 (id=${id}, 닉네임=${nick})`);
}

// 스튜디오가 프로필을 조회하므로 행이 없으면 화면이 깨진다 → 반드시 보장
const prof = db.prepare('SELECT user_id FROM bj_profiles WHERE user_id=?').get(id);
if (!prof) {
    stmts.insertBJProfile.run(id, STAGE, '콘텐츠 업로드 계정', 0, '');
    console.log('스트리머 프로필 생성');
}

// 업로드 전용이므로 라이브 서비스는 최소로 두고 요율은 0으로 막는다.
// (services는 최소 1개가 강제되므로 voice_1on1만 남긴다 — server/service_types.js)
db.prepare(
    "UPDATE bj_profiles SET services=?, rate_per_minute=0, rate_with_video=0, rate_cam=0, " +
    "sub_price=0, device_control=0, is_online=0 WHERE user_id=?"
).run(svc.normalizeServices(['voice_1on1']), id);

const f = stmts.findUserById.get(id);
console.log('\n✅ 발급 완료');
console.log('  로그인 ID :', f.email);
console.log('  활동명    :', STAGE);
console.log('  권한      :', f.role, '(관리자 화면 접근 불가)');
console.log('  업로드    : /bj-studio/videos');
if (generated) {
    console.log('  비밀번호  :', PW);
    console.log('\n  ⚠ 비밀번호는 지금 이 화면에만 나옵니다. 복사해서 전달하고 이 출력은 남기지 마세요.');
    console.log('    받는 분에게 첫 로그인 후 /mypage 에서 변경하도록 안내하세요.');
} else {
    console.log('  비밀번호  : (입력한 값으로 설정됨)');
}
console.log('\n  ℹ 이 계정은 공개 스트리머 목록(/bj)에 오프라인으로 표시됩니다.');
console.log('    숨기려면 별도 처리 필요 — listBJs 쿼리에 노출 필터가 없습니다.');
