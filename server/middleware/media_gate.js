/**
 * 미디어 파일 접근 게이트 (2026-10-10)
 *
 * 왜 있는가:
 *   콘텐츠 파일이 `public/content/` 에 있어서 `express.static` 이 **인증 검사보다 먼저**
 *   서빙했다. 즉 사이트 출입 게이트만 지나면 로그인·연령확인 없이 주소창으로 영상 파일을
 *   직접 받을 수 있었다. 플레이어 라우트(`/content/play/:id`)는 `requireAgeVerified` 인데
 *   정작 파일은 무인증이었던 것.
 *
 * 무엇을 막는가:
 *   `/content/` 아래의 **영상·스크립트 파일**. 디렉터리가 아니라 **확장자**로 가른다 —
 *   BJ 업로드 폴더는 영상·funscript·`_thumb.jpg` 가 한 디렉터리에 섞여 있고(`content/bj/<id>/`),
 *   나중에 새 업로드 경로가 생겨도 자동으로 보호되게 하려면 확장자 기준이 맞다.
 *   funscript 도 보호 대상이다 — 동작 데이터 자체가 콘텐츠다.
 *
 * 무엇을 열어두는가:
 *   이미지(썸네일·포스터). 카탈로그는 비로그인 손님도 볼 수 있어야 한다(`requireAgeOrGuest`).
 *   `/content/vod` 같은 **라우트**(확장자 없음)는 건드리지 않는다 — 각 라우트의 미들웨어가 검사한다.
 *
 * 정책: 로그인 + 연령확인 (플레이어 라우트와 동일). admin 은 통과.
 *
 * ⚠ 한계 — 로그인한 사용자는 여전히 URL 로 파일을 받을 수 있다(구독·구매 여부는 보지 않는다).
 *   구독 전용 보호와 공유 방지는 **짧은 만료의 서명 URL** 이 필요하다 (PROJECT_STATUS §8).
 *   화면 녹화는 어떤 방법으로도 못 막는다. 목표는 "쉽게·대량으로 못 가져가게".
 *
 * ⚠ 파일 전송 자체는 손대지 않는다 — 통과시키면 기존 `express.static` 이 서빙한다.
 *   Range(이어보기·탐색)·ETag·304 가 지금과 똑같이 동작해야 하므로 여기서 다시 구현하지 않는다.
 */
const path = require('path');

const PROTECTED_EXT = new Set(['.mp4', '.webm', '.mov', '.m4v', '.mkv', '.avi', '.ts', '.m3u8', '.funscript', '.csv']);

/** 우회 방지 — 퍼센트 인코딩·`..`·백슬래시·대문자를 모두 풀어서 본다 */
function normalizedPath(req) {
    let p = req.path || '';
    try { p = decodeURIComponent(p); } catch (_) { return null; }   // 잘못된 인코딩 = 거부
    p = p.replace(/\\/g, '/');
    return path.posix.normalize(p).toLowerCase();
}

function isAllowed(req) {
    const u = req.user;
    if (!u) return false;
    return !!u.age_verified || u.role === 'admin';
}

module.exports = function mediaGate(req, res, next) {
    const p = normalizedPath(req);
    if (p === null) return res.status(400).type('text/plain').send('bad request');
    if (!p.startsWith('/content/')) return next();
    if (!PROTECTED_EXT.has(path.posix.extname(p))) return next();   // 이미지·라우트는 통과

    if (isAllowed(req)) return next();

    // 영상 요소는 본문을 읽지 않으므로 상태코드만 의미가 있다. 로그인 페이지로 리다이렉트하면
    // <video> 가 HTML 을 받아 깨진 재생으로 보이므로 그냥 403 으로 끊는다.
    return res.status(403).type('text/plain').send('forbidden');
};
