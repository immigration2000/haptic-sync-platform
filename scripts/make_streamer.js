/**
 * 스트리머 계정 발급 (콘텐츠 업로드용) — CLI
 *
 * 실행: node scripts/make_streamer.js <로그인ID> <활동명> [비밀번호]
 *   예: node scripts/make_streamer.js worker01 "콘텐츠팀"
 *
 * 실제 발급 로직은 server/services/account_provision.js 에 있다.
 * 관리자 UI(/admin/streamers)와 같은 모듈을 쓰므로 정책이 갈라지지 않는다.
 *
 * 비밀번호를 생략하면 무작위로 만들어 **화면에 한 번만** 출력한다.
 * 그 자리에서 복사해 전달할 것. 어디에도 저장하지 않는다.
 */
const { provisionStreamer } = require('../server/services/account_provision');

const [, , loginId, stageName, pwArg] = process.argv;

if (!loginId || !stageName) {
    console.error('사용법: node scripts/make_streamer.js <로그인ID> <활동명> [비밀번호]');
    process.exit(1);
}

const r = provisionStreamer({ loginId, stageName, password: pwArg });

if (!r.ok) {
    console.error('❌ ' + r.error);
    process.exit(1);
}

console.log(r.created ? `새 스트리머 계정 생성 (id=${r.id})` : `기존 계정을 스트리머로 갱신 (id=${r.id})`);
console.log('\n✅ 발급 완료');
console.log('  로그인 ID :', r.loginId);
console.log('  활동명    :', r.stageName);
console.log('  권한      : bj (관리자 화면 접근 불가)');
console.log('  업로드    : /bj-studio/videos');

if (r.generated) {
    console.log('  비밀번호  :', r.password);
    console.log('\n  ⚠ 비밀번호는 지금 이 화면에만 나옵니다. 복사해서 전달하고 이 출력은 남기지 마세요.');
    console.log('    받는 분에게 첫 로그인 후 /mypage 에서 변경하도록 안내하세요.');
} else {
    console.log('  비밀번호  : (입력한 값으로 설정됨)');
}

console.log('\n  ℹ 이 계정은 공개 스트리머 목록(/bj)에 오프라인으로 표시됩니다.');
