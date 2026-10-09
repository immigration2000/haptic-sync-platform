/**
 * 배속 재생 ↔ T-Code 이동시간(interp) 테스트 — `public/js/core/funscript.js`
 *
 *   실행: node scripts/test_playback_rate.mjs
 *
 * 왜 있는가 (2026-10-09 속도 조절 기능 추가):
 *   interp 는 **스크립트 시간 간격**(next.at - cur.at)으로 뽑는다. 영상을 2배속으로 틀면
 *   키프레임은 절반 시간에 지나가는데 기기에게는 원래 이동시간을 주게 되어 **기기가 뒤처진다.**
 *   그래서 엔진이 `video.playbackRate` 로 나눈다. 이 관계가 깨지면 배속에서 동작이 밀린다.
 *
 *   ⚠ 1:다수 방송 쪽은 video 대신 클럭 심(shim)을 넘긴다 — playbackRate 가 없다.
 *     그때도 1배속으로 동작해야 한다 (예전 동작 보존).
 */
import fs from 'fs';
import vm from 'vm';

const SRC = fs.readFileSync(new URL('../public/js/core/funscript.js', import.meta.url), 'utf8');
const ctx = { console, setTimeout, clearTimeout, setInterval, clearInterval, performance, Math, JSON,
              Number, String, Object, Promise, Infinity, isNaN, parseInt, parseFloat };
ctx.window = ctx; ctx.globalThis = ctx;
ctx.requestAnimationFrame = (fn) => setTimeout(() => fn(performance.now()), 16);
ctx.document = { hidden: false, addEventListener() {}, removeEventListener() {} };
vm.createContext(ctx); vm.runInContext(SRC, ctx);
const FS = ctx.window.PulseFunscript;

let pass = 0, fail = 0;
const ok = (n, c, e = '') => { c ? pass++ : fail++; console.log(`  ${c ? '✅' : '❌'} ${n}${e ? ' — ' + e : ''}`); };

/** 0ms→200ms 한 구간(간격 200ms)을 한 tick 으로 지나가게 하고, 나간 명령을 받는다 */
function emit(rate) {
    const axes = { L0: FS.buildAxis([{ at: 0, pos: 30 }, { at: 200, pos: 50 }]) };
    const clock = { paused: false, ended: false, currentTime: 0.3 };      // 300ms → 구간 통과
    if (rate !== undefined) clock.playbackRate = rate;
    const out = [];
    const eng = new FS.MultiAxisEngine({ video: clock, axes, sendOnce: true, onCommand: (c) => out.push(c) });
    eng._tick();
    return out.join(' ');
}
const interpOf = (line) => { const m = line.match(/I(\d+)/); return m ? parseInt(m[1], 10) : null; };

console.log('\n1. 배속에 따라 이동시간이 줄어든다');
ok('1배속 → I200 (원본 간격 그대로)', interpOf(emit(1)) === 200, emit(1));
ok('2배속 → I100 (절반)',             interpOf(emit(2)) === 100, emit(2));
ok('1.5배속 → I133',                  interpOf(emit(1.5)) === 133, emit(1.5));
ok('0.5배속 → I400 (두 배)',          interpOf(emit(0.5)) === 400, emit(0.5));

console.log('\n2. 위치값은 배속과 무관하다 (이동시간만 바뀐다)');
{
    const a = emit(1), b = emit(2);
    const posOf = (l) => (l.match(/^L0(\d+)/) || [])[1];
    ok('같은 위치로 간다', posOf(a) === posOf(b), a + ' / ' + b);
}

console.log('\n3. playbackRate 가 없는 클럭(1:다수 방송 심)은 1배속 취급');
ok('playbackRate 없음 → I200', interpOf(emit(undefined)) === 200, emit(undefined));
ok('playbackRate 0 → I200 (0 으로 나누지 않는다)', interpOf(emit(0)) === 200, emit(0));

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`);
process.exit(fail ? 1 : 0);
