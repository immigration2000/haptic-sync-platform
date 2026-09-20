/**
 * 이름(활동명·닉네임) 정책 — 저장 경로 셋(가입·마이페이지·스튜디오·계정발급)이 공유한다.
 *
 * 왜 있는가:
 *   활동명이 소켓으로 다른 사용자 화면에 그대로 전달된다. 렌더 쪽에서 이스케이프하지만
 *   (2026-09-20 XSS 수정), 저장 시점에도 태그 문자를 거부해 방어선을 두 겹으로 둔다.
 *   렌더 쪽 이스케이프를 나중에 누가 빠뜨려도 여기서 한 번 더 막힌다.
 *
 * 규칙: '<' '>' 를 포함하면 거부. 길이 검사는 각 경로가 기존대로 한다.
 */
const BAD = /[<>]/;

/** @returns {string|null} 거부 사유 문구 (통과면 null) */
function nameProblem(name) {
    const s = String(name == null ? '' : name);
    if (BAD.test(s)) return "이름에 '<' 또는 '>' 문자는 쓸 수 없습니다.";
    return null;
}

module.exports = { nameProblem };
