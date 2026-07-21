/**
 * 사용자 작성 텍스트 필터 (피드 포스트·댓글)
 *
 * 목적 1 — 외부 유인 차단:
 *   스트리머가 개인 텔레그램·외부 결제 링크로 사용자를 빼돌리면 플랫폼 수익이 증발한다.
 *   이 업계에서 실제로 가장 흔한 이탈 경로라 URL·메신저 아이디·연락처를 막는다.
 * 목적 2 — 불법/미성년 암시 차단: tags.js의 CORE_BLOCK을 그대로 재사용(같은 법적 기준).
 */
const { CORE_BLOCK } = require('./tags');

// 외부 링크 / 연락처 패턴
const PATTERNS = [
    { re: /https?:\/\/\S+/gi,                     label: '외부 링크' },
    { re: /www\.\S+/gi,                           label: '외부 링크' },
    { re: /\b[\w.-]+\.(com|net|org|io|kr|me|xyz|shop|link|tv|cc)\b/gi, label: '외부 주소' },
    // 한글은 \b(단어경계)가 동작하지 않으므로 경계 없이 매칭한다. (영문만 \b 사용)
    { re: /(텔레그램|텔그|테레그람|카카오톡|카톡|오픈채팅|오픈카톡|라인아이디|위커|디스코드|왓츠앱)/g, label: '외부 메신저' },
    { re: /\b(telegram|kakao|kakaotalk|wickr|discord|whatsapp|snapchat|line\s?id)\b/gi, label: '외부 메신저' },
    { re: /(아이디\s*[:：]?\s*[A-Za-z0-9._-]{3,})/g, label: '외부 아이디' },
    { re: /\b01[016-9][-.\s]?\d{3,4}[-.\s]?\d{4}\b/g, label: '전화번호' },
    { re: /[\w.+-]+@[\w-]+\.[\w.]+/g,             label: '이메일' },
];

/**
 * @returns { ok, text, blocked:[라벨] }  — ok=false면 거부, 사유는 blocked
 */
function check(raw, { maxLen = 500 } = {}) {
    const text = String(raw || '').trim().slice(0, maxLen);
    if (!text) return { ok: false, text: '', blocked: ['빈 내용'] };

    const blocked = [];
    for (const p of PATTERNS) {
        p.re.lastIndex = 0;
        if (p.re.test(text) && !blocked.includes(p.label)) blocked.push(p.label);
    }
    const low = text.toLowerCase();
    if (CORE_BLOCK.some(w => w && low.includes(w))) blocked.push('금지 표현');

    return { ok: blocked.length === 0, text, blocked };
}

module.exports = { check, PATTERNS };
