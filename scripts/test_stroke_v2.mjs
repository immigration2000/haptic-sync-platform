/**
 * 스트로크 제어 v2 회귀 테스트 — `public/js/core/funscript.js` (shapeAxis · autoGain · 엔진 축별 성형)
 *
 *   실행: node scripts/test_stroke_v2.mjs
 *
 * 사양 (2026-09-20 확정):
 *   - 6축 공통. cfg = { hwMin, hwMax, centerFrac, gain, auto }
 *   - 가동범위(hwMin~hwMax)를 바꾸면 중심도 같이 움직인다 (centerFrac 비율 유지)
 *   - 중심은 가동범위 안에서 따로 움직인다
 *   - 강도 100% = 원본 그대로. 수동 0~300%
 *   - 자동 맞춤: 진폭이 가동범위에 꽉 차는 배율. **상한 없음.** 원본 폭 < 10 이면 증폭 안 함
 *   - interp(이동시간)는 건드리지 않는다
 *   - 엔진은 L0 뿐 아니라 **모든 축**에 축별 설정을 적용한다
 *
 * 검증값은 vr_technician_01 실측 진폭(L0 30~50 · R2 40~60)을 기준으로 잡았다.
 */
import fs from 'fs';
import vm from 'vm';

const SRC = fs.readFileSync(new URL('../public/js/core/funscript.js', import.meta.url), 'utf8');
const ctx = { console, setTimeout, clearTimeout, setInterval, clearInterval, performance, Math, JSON, Number, String, Object, Promise, Infinity, isNaN, parseInt, parseFloat };
ctx.window = ctx; ctx.globalThis = ctx;
ctx.requestAnimationFrame = (fn) => setTimeout(() => fn(performance.now()), 16);
ctx.document = { hidden: false, addEventListener() {}, removeEventListener() {} };
vm.createContext(ctx); vm.runInContext(SRC, ctx);
const FS = ctx.window.PulseFunscript;

let pass = 0, fail = 0;
const ok = (n, c, e = '') => { c ? pass++ : fail++; console.log(`  ${c ? '✅' : '❌'} ${n}${e ? ' — ' + e : ''}`); };
const L0 = FS.buildAxis([{ at: 0, pos: 30 }, { at: 184, pos: 50 }]);          // 원본 30~50, 중앙 40
const D = FS.SHAPE_DEFAULT;
const run = (ax, c) => [ax.lo, (ax.lo + ax.hi) / 2, ax.hi].map((p) => FS.shapeAxis(p, ax, Object.assign({}, D, c))).join('/');

console.log('\n1. 수동 강도 (100% = 원본)');
ok('기본 100% → 중심 50 으로 이동, 폭 그대로', run(L0, {}) === '40/50/60', run(L0, {}));
ok('300%', run(L0, { gain: 3 }) === '20/50/80', run(L0, { gain: 3 }));
ok('0% = 정지', run(L0, { gain: 0 }) === '50/50/50', run(L0, { gain: 0 }));
ok('50% = 반', run(L0, { gain: 0.5 }) === '45/50/55', run(L0, { gain: 0.5 }));

console.log('\n2. 가동범위 → 중심이 따라감 (비율 유지)');
ok('40~100, 중심비율 0.5 → 중심 70', run(L0, { hwMin: 40, hwMax: 100 }) === '60/70/80', run(L0, { hwMin: 40, hwMax: 100 }));
ok('0~40 → 중심 20', run(L0, { hwMin: 0, hwMax: 40 }) === '10/20/30', run(L0, { hwMin: 0, hwMax: 40 }));
ok('범위 밖은 잘림 (300%, 40~60)', run(L0, { gain: 3, hwMin: 40, hwMax: 60 }) === '40/50/60');

console.log('\n3. 중심 이동 (가동범위 안에서)');
ok('0~100 에서 25% 지점 → 중심 25', run(L0, { centerFrac: 0.25 }) === '15/25/35', run(L0, { centerFrac: 0.25 }));
ok('20~80 에서 100% 지점 → 중심 80, 위쪽 잘림', run(L0, { hwMin: 20, hwMax: 80, centerFrac: 1 }) === '70/80/80');
ok('centerFrac 범위 밖은 0~1 로 고정', FS.shapeCenter({ hwMin: 0, hwMax: 100, centerFrac: 5 }).center === 100);

console.log('\n4. 자동 맞춤 — 상한 없음, 좁은 쪽에 맞춤');
ok('0~100 중심 50 → 5.00배 (30~50 이 0~100 꽉 참)', FS.autoGain(L0, Object.assign({}, D, { auto: true })) === 5, String(FS.autoGain(L0, Object.assign({}, D, { auto: true }))));
ok('  결과 0/50/100', run(L0, { auto: true }) === '0/50/100');
ok('40~60 → 1.00배 (딱 맞음)', FS.autoGain(L0, Object.assign({}, D, { hwMin: 40, hwMax: 60 })) === 1);
ok('40~80 중심 25% (=50) → 아래 여유 10 에 맞춰 1.00배', FS.autoGain(L0, Object.assign({}, D, { hwMin: 40, hwMax: 80, centerFrac: 0.25 })) === 1);
ok('40~80 중심 50% (=60) → 위·아래 20 → 2.00배', FS.autoGain(L0, Object.assign({}, D, { hwMin: 40, hwMax: 80 })) === 2);
ok('자동 OFF 면 수동값', FS.effectiveGain(L0, Object.assign({}, D, { gain: 2.5 })) === 2.5);
ok('자동 ON 이면 수동값 무시', FS.effectiveGain(L0, Object.assign({}, D, { gain: 2.5, auto: true })) === 5);

console.log('\n5. 안전장치 — 거의 정지한 원본은 자동 증폭 안 함');
{
    const narrow = FS.buildAxis([{ at: 0, pos: 47 }, { at: 100, pos: 53 }]);    // 폭 6
    ok('폭 6 → autoGain 1', FS.autoGain(narrow, Object.assign({}, D, { auto: true })) === 1);
    ok('폭 6 자동 → 원본 폭 유지', run(narrow, { auto: true }) === '47/50/53', run(narrow, { auto: true }));
    ok('스크립트 없으면 autoGain 1', FS.autoGain(null, D) === 1);
    ok('cfg 없으면 원본 그대로', FS.shapeAxis(37, L0, null) === 37);
}

console.log('\n6. 엔진 — 모든 축에 축별 설정 적용 (L0 만이 아니라)');
{
    const axes = {
        L0: FS.buildAxis([{ at: 0, pos: 30 }, { at: 300, pos: 50 }]),
        R2: FS.buildAxis([{ at: 0, pos: 40 }, { at: 300, pos: 60 }]),
    };
    const cfg = {
        L0: Object.assign({}, D, { gain: 3 }),                       // 30~50 → 20~80
        R2: Object.assign({}, D, { hwMin: 0, hwMax: 40 }),            // 40~60 → 중심 20 → 10~30
    };
    const clock = { _s: 0, _p: true, get paused() { return this._p; }, get ended() { return false; },
        get currentTime() { return this._p ? 0 : (performance.now() - this._s) / 1000; },
        start() { this._s = performance.now(); this._p = false; }, stop() { this._p = true; } };
    const out = [];
    const eng = new FS.MultiAxisEngine({ video: clock, axes, sendOnce: true, onCommand: (c) => out.push(c),
                                         shapeGetter: (k) => cfg[k] });
    clock.start(); eng.start();
    await new Promise((r) => setTimeout(r, 700));
    eng.stop(); clock.stop();
    const line = out.join(' ');
    ok('L0 가 300% 로 성형됨 (L080)', /L080I/.test(line), line);
    ok('R2 도 성형됨 (R230 — 가동범위 0~40)', /R230I/.test(line), line);
    ok('원본값(L050/R260) 은 안 나감', !/L050I|R260I/.test(line));
    ok('interp 는 원본 그대로 (I300)', /I300/.test(line));
}

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`);
process.exit(fail ? 1 : 0);
