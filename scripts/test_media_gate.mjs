/**
 * 미디어 게이트 테스트 — `server/middleware/media_gate.js`
 *
 *   실행: node scripts/test_media_gate.mjs
 *
 * 지켜야 하는 것:
 *   1) 영상·funscript 는 로그인+연령확인 없이는 403
 *   2) 썸네일(이미지)과 라우트(`/content/vod` 등)는 그대로 통과 — 비로그인 카탈로그가 깨지면 안 된다
 *   3) **우회가 막혀야 한다** — 퍼센트 인코딩, `..` 로 디렉터리 건너뛰기, 백슬래시, 대문자
 *      (serve-static 은 경로를 디코드·정규화해서 파일을 찾으므로, 게이트도 같은 눈으로 봐야 한다)
 *   4) /content 밖 요청에는 간섭하지 않는다
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const gate = require('../server/middleware/media_gate.js');

let pass = 0, fail = 0;
const ok = (n, c, e = '') => { c ? pass++ : fail++; console.log(`  ${c ? '✅' : '❌'} ${n}${e ? ' — ' + e : ''}`); };

/** 게이트를 한 번 돌려 결과를 'next' | 상태코드 로 돌려준다 */
function run(urlPath, user) {
    let result = null;
    const req = { path: urlPath, user };
    const res = {
        status(c) { result = c; return this; },
        type() { return this; },
        send() { return this; },
    };
    gate(req, res, () => { result = 'next'; });
    return result;
}

const guest = undefined;
const member = { id: 2, role: 'user', age_verified: 1 };
const unverified = { id: 3, role: 'user', age_verified: 0 };
const admin = { id: 1, role: 'admin', age_verified: 0 };

console.log('\n1. 콘텐츠 파일은 막는다');
ok('비로그인 → mp4 403',        run('/content/vods/a.mp4', guest) === 403);
ok('비로그인 → funscript 403',  run('/content/vods/a.funscript', guest) === 403);
ok('비로그인 → BJ 업로드 403',  run('/content/bj/9/1787_x.mp4', guest) === 403);
ok('연령미확인 → 403',          run('/content/vrs/a.mp4', unverified) === 403);

console.log('\n2. 허용돼야 하는 것');
ok('로그인+연령확인 → 통과',    run('/content/vods/a.mp4', member) === 'next');
ok('admin → 통과',              run('/content/vods/a.mp4', admin) === 'next');
ok('썸네일(비로그인) → 통과',   run('/content/thumbnails/vod1.jpg', guest) === 'next');
ok('BJ 썸네일(비로그인) → 통과', run('/content/bj/9/1787_thumb.jpg', guest) === 'next');
ok('라우트 /content/vod → 통과', run('/content/vod', guest) === 'next');
ok('라우트 /content/play/3 → 통과', run('/content/play/3', guest) === 'next');

console.log('\n3. 우회 차단');
ok('퍼센트 인코딩(%76ods)',     run('/content/%76ods/a.mp4', guest) === 403, String(run('/content/%76ods/a.mp4', guest)));
ok('확장자 인코딩(.mp%34)',     run('/content/vods/a.mp%34', guest) === 403, String(run('/content/vods/a.mp%34', guest)));
ok('.. 로 디렉터리 건너뛰기',   run('/content/thumbnails/../vods/a.mp4', guest) === 403, String(run('/content/thumbnails/../vods/a.mp4', guest)));
ok('대문자 확장자(.MP4)',       run('/content/vods/A.MP4', guest) === 403);
ok('백슬래시',                  run('/content\\vods\\a.mp4', guest) === 403, String(run('/content\\vods\\a.mp4', guest)));
ok('잘못된 인코딩 → 400',       run('/content/vods/%E0%A4%A.mp4', guest) === 400, String(run('/content/vods/%E0%A4%A.mp4', guest)));

console.log('\n4. 간섭하지 않는 영역');
ok('/js/core/device.js 통과',   run('/js/core/device.js', guest) === 'next');
ok('/css/theme.css 통과',       run('/css/theme.css', guest) === 'next');
ok('/ 통과',                    run('/', guest) === 'next');
ok('/content 자체 통과',        run('/content', guest) === 'next');

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`);
process.exit(fail ? 1 : 0);
