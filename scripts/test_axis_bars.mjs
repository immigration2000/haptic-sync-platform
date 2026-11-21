/**
 * 진단 창의 축 위치 막대 — 값 해석 테스트
 *
 *   실행: node scripts/test_axis_bars.mjs
 *
 * 무엇을 지키는가:
 *   TCode 위치는 **"0.xxx" 소수**다 (L0500 = 0.500 = 50%, L05 = 0.5, L0050 = 5%).
 *   자릿수를 왼쪽으로 채우면(50 → 050) 50% 가 5% 로 바뀐다 — `device_drivers.js` 에
 *   같은 함정이 주석으로 남아 있다(padStart 쓰면 완전히 틀림).
 *   막대가 그 규칙을 드라이버와 **똑같이** 해석하는지 본다. 어긋나면 화면이 거짓말을 한다.
 *
 * 테스트 대상 함수는 `views/support/device_lab.ejs` 안에 있으므로 거기서 그대로 떼어내
 * 실행한다 — 테스트용으로 베껴 쓰면 원본이 바뀌어도 테스트는 통과해 버린다.
 */
import fs from 'fs';
import vm from 'vm';

const LAB = fs.readFileSync(new URL('../views/support/device_lab.ejs', import.meta.url), 'utf8');
const DRV = fs.readFileSync(new URL('../public/js/core/device_drivers.js', import.meta.url), 'utf8');

let pass = 0, fail = 0;
const ok = (n, c, e = '') => { c ? pass++ : fail++; console.log(`  ${c ? '✅' : '❌'} ${n}${e ? ' — ' + e : ''}`); };

// ── 진단 창에서 파서를 떼어낸다 ──
const i0 = LAB.indexOf('var AX_RE =');
const i1 = LAB.indexOf('function curVal(');
if (i0 < 0 || i1 < 0 || i1 < i0) {
    console.error('❌ device_lab.ejs 에서 AX_RE/parseAxes 를 찾지 못했다 — 테스트를 고쳐야 한다');
    process.exit(1);
}
const src = LAB.slice(i0, i1);
const ctx = { Math, parseInt, String };
vm.createContext(ctx);
vm.runInContext(src + '\n', ctx);
const parseAxes = ctx.parseAxes;

// ── 드라이버의 정규화를 가져온다 (encode 를 통해) ──
const dctx = { window: {}, TextEncoder, console: { log() {} } };
dctx.window.window = dctx.window;
vm.createContext(dctx);
vm.runInContext(DRV, dctx);
const drv = dctx.window.PulseDrivers.active();
const norm = (cmd) => new TextDecoder().decode(drv.encode(cmd)).trim();

console.log('\n1. 위치는 "0.xxx" 소수로 읽는다');
{
    const cases = [
        ['L0500I0100', 0.500], ['L050I100', 0.50], ['L05', 0.5],
        ['L0050', 0.050], ['L0999I0050', 0.999], ['L0000', 0],
    ];
    for (const [cmd, want] of cases) {
        const a = parseAxes(cmd);
        ok(`${cmd} → ${(want * 100).toFixed(1)}%`,
           a.length === 1 && Math.abs(a[0].v - want) < 1e-9,
           JSON.stringify(a));
    }
}

console.log('\n2. 🔴 드라이버 정규화가 값을 바꾸지 않는다 (막대와 기기가 같은 값을 본다)');
{
    for (const cmd of ['L050I100', 'L05I100', 'L0500I0100', 'R160I200', 'V099', 'A0123I9999']) {
        const before = parseAxes(cmd), after = parseAxes(norm(cmd));
        ok(`${cmd} → ${norm(cmd)}`,
           before.length === after.length && before.every((b, i) => Math.abs(b.v - after[i].v) < 1e-9),
           JSON.stringify([before.map(b => b.v), after.map(b => b.v)]));
    }
}

console.log('\n3. 축을 구분한다');
{
    const a = parseAxes('L0500I0100 R1800I0100');
    ok('다축 한 줄에서 두 축', a.length === 2, JSON.stringify(a));
    ok('축 이름 L0 / R1', a[0].ax === 'L0' && a[1].ax === 'R1', JSON.stringify(a.map(x => x.ax)));
    ok('값이 각각', Math.abs(a[0].v - 0.5) < 1e-9 && Math.abs(a[1].v - 0.8) < 1e-9);
}

console.log('\n4. 보간 시간(I)을 읽고 범위를 지킨다');
{
    ok('I0100 → 100ms', parseAxes('L0500I0100')[0].ms === 100);
    ok('I 없으면 0 (즉시)', parseAxes('L0500')[0].ms === 0);
    ok('I 상한 9999', parseAxes('L0500I99999')[0].ms === 9999, String(parseAxes('L0500I99999')[0].ms));
    ok('I 하한 1', parseAxes('L0500I0')[0].ms === 1, String(parseAxes('L0500I0')[0].ms));
    // S(속도)는 보간 시간이 아니다 — 시간으로 오해하면 막대가 엉뚱하게 움직인다
    ok('S 는 시간으로 쓰지 않는다', parseAxes('L0500S0100')[0].ms === 0, String(parseAxes('L0500S0100')[0].ms));
}

console.log('\n5. 축이 아닌 줄은 집지 않는다 (제어 명령이 막대를 흔들면 안 된다)');
{
    for (const cmd of ['DSTOP', 'D1', 'D0', '', 'hello', '#ok']) {
        ok(`${cmd || '(빈 줄)'} → 축 없음`, parseAxes(cmd).length === 0, JSON.stringify(parseAxes(cmd)));
    }
}

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`);
process.exit(fail ? 1 : 0);
