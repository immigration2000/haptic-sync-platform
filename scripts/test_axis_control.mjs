/**
 * 축 제어 공용 모듈 회귀 테스트 — `public/js/core/axis_control.js`
 *
 *   실행: node scripts/test_axis_control.mjs
 *
 * 왜 있는가:
 *   방송·콘솔·통화가 같은 모듈로 슬라이더→명령 송신과 원격 명령 수신을 한다.
 *   여기가 깨지면 세 화면이 동시에 깨진다. 속도 제한 수치(30Hz + slew 200 pos/s)는
 *   노트북이 데스크톱 앱에서 실기기로 검증한 값이라 회귀로 지킨다.
 *
 * ⚠ 브라우저 없이 vm 컨텍스트에 최소 DOM 을 스텁한다. 실기기 동작을 보장하지는 않는다.
 */
import fs from 'fs';
import vm from 'vm';

const SRC = fs.readFileSync(new URL('../public/js/core/axis_control.js', import.meta.url), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 최소 이벤트 타깃 — 슬라이더·document 흉내 */
class El {
    // 실제 DOM 처럼 value / textContent 는 무엇을 넣어도 문자열이 된다
    constructor(value = '50', tagName = 'INPUT') { this._v = String(value); this._t = ''; this.tagName = tagName; this._h = {}; }
    get value() { return this._v; }            set value(v) { this._v = String(v); }
    get textContent() { return this._t; }      set textContent(v) { this._t = String(v); }
    addEventListener(t, f) { (this._h[t] = this._h[t] || []).push(f); }
    removeEventListener(t, f) { this._h[t] = (this._h[t] || []).filter((x) => x !== f); }
    fire(t, e = {}) { for (const f of (this._h[t] || [])) f(Object.assign({ preventDefault() {} }, e)); }
}

function load({ device } = {}) {
    const doc = new El('', 'DOC'); doc.activeElement = null;
    const ctx = { console, setInterval, clearInterval, performance, Math, String, Number, Object, Error, isNaN, parseInt, document: doc };
    ctx.window = ctx;
    if (device) ctx.PulseDevice = device;
    vm.createContext(ctx); vm.runInContext(SRC, ctx);
    return { A: ctx.window.PulseAxisControl, doc };
}

let pass = 0, fail = 0;
const ok = (n, c, e = '') => { c ? pass++ : fail++; console.log(`  ${c ? '✅' : '❌'} ${n}${e ? ' — ' + e : ''}`); };

// ── 1. 송신기: 병합 + slew ──────────────────────────────────
console.log('\n1. createSender — 빠른 입력 → 30Hz 이하');
{
    const { A } = load(); const out = [];
    const tx = A.createSender({ send: (l) => out.push(performance.now()) });
    const t0 = performance.now(); let inputs = 0;
    while (performance.now() - t0 < 1200) { tx.set('L0', 20 + (inputs++ % 2) * 60); await sleep(4); }
    await sleep(100); tx.stop();
    const secs = (out[out.length - 1] - out[0]) / 1000;
    ok('입력이 전송보다 훨씬 많다', inputs > out.length * 2, `입력 ${inputs} → 전송 ${out.length}`);
    ok('전송률 ≤ 31/s', out.length / secs <= 31, (out.length / secs).toFixed(1) + '/s');
}
console.log('\n2. createSender — 변화율 ≤ 200 pos/s, 최종값 도달');
{
    const { A } = load(); const out = [];
    const tx = A.createSender({ send: (l) => out.push({ t: performance.now(), v: parseInt(l.match(/L0(\d\d)/)[1], 10) }) });
    tx.set('L0', 0); await sleep(60); tx.set('L0', 99); await sleep(700); tx.stop();
    const rise = out.filter((o, i) => i > 0 && o.v > out[i - 1].v);
    const rate = (rise[rise.length - 1].v - rise[0].v) / ((rise[rise.length - 1].t - rise[0].t) / 1000);
    ok('평균 속도 ≤ 230 pos/s', rate <= 230, rate.toFixed(0) + '/s');
    ok('한 번에 큰 점프 없음', out.map((o) => o.v).every((v, i, a) => i === 0 || Math.abs(v - a[i - 1]) < 20));
    ok('최종값 99', out[out.length - 1].v === 99);
}
console.log('\n3. createSender — 다축 병합 · 변화 없으면 안 보냄 · interp');
{
    const { A } = load(); const out = [];
    const tx = A.createSender({ send: (l) => out.push(l), interp: 250 });
    tx.set('L0', 50); tx.set('R0', 40); tx.set('R2', 60); await sleep(80);
    const n1 = out.length; await sleep(120); tx.stop();
    ok('한 줄에 3토큰', out[0] && out[0].split(' ').length === 3, out[0]);
    ok('형식 · interp 반영', /^L050I250 R040I250 R260I250$/.test(out[0] || ''), out[0]);
    ok('같은 값 반복 전송 없음', out.length === n1);
}

// ── 2. 바인딩: 슬라이더·키보드 → 송신 ─────────────────────────
console.log('\n4. bind — 슬라이더 input · 키보드 · enabled 게이트');
{
    const { A, doc } = load(); const out = [];
    const L0 = new El(50), R0 = new El(50), R2 = new El(50), interp = new El(100);
    const vL0 = new El(), vInterp = new El();
    let enabled = true;
    const ctl = A.bind({
        axes: { L0: { el: L0, val: vL0 }, R0: { el: R0 }, R2: { el: R2 } },
        interpEl: interp, interpVal: vInterp,
        send: (l) => out.push(l), enabled: () => enabled,
    });
    L0.value = '72'; L0.fire('input'); await sleep(60);
    ok('슬라이더 input → 전송', out.some((l) => /L072I100/.test(l)), out[0]);
    ok('값 표시 갱신', vL0.textContent === '72', vL0.textContent);

    out.length = 0;
    doc.fire('keydown', { code: 'ArrowUp' }); await sleep(60);
    ok('↑ 키 → L0 +5 (77)', L0.value === '77' && out.some((l) => /L077/.test(l)), `L0=${L0.value} ${out[0] || ''}`);
    doc.fire('keydown', { code: 'ArrowLeft' }); await sleep(60);
    ok('← 키 → R0 −5 (45)', R0.value === '45', `R0=${R0.value}`);
    doc.fire('keydown', { code: 'KeyW' }); await sleep(60);
    ok('W 키 → R2 +5 (55)', R2.value === '55', `R2=${R2.value}`);

    out.length = 0; enabled = false;
    doc.fire('keydown', { code: 'ArrowUp' }); await sleep(60);
    ok('enabled=false 면 키 무시', out.length === 0 && L0.value === '77');
    enabled = true;

    doc.activeElement = new El('', 'INPUT');
    doc.fire('keydown', { code: 'ArrowUp' }); await sleep(60);
    ok('입력창 포커스 중엔 키 무시', L0.value === '77');
    doc.activeElement = null;

    interp.value = '300'; interp.fire('input');
    out.length = 0; L0.value = '80'; L0.fire('input'); await sleep(60);
    ok('보간 변경 반영', out.some((l) => /I300/.test(l)) && vInterp.textContent === '300', out[0]);
    ctl.stop();
}

// ── 3. 수신: 검증 → 게이트 → 기기 ────────────────────────────
console.log('\n5. receive — 게이트 · 미연결 · 비축 명령 · 카운트');
{
    const calls = [];
    const dev = { isConnected: true, sendRemote: (l) => { calls.push(l); return l.split(' ').length; } };
    const { A } = load({ device: dev });
    let count = 0;
    ok('축 명령 → sendRemote 1회', A.receive('L050I100', { onCount: (n) => count += n }) === 1 && calls.length === 1);
    ok('다축 한 줄 → 토큰 수 반환', A.receive('L050I100 R040I100', { onCount: (n) => count += n }) === 2 && count === 3);
    ok('비축 문자열(MODE:) 은 0', A.receive('MODE:cam') === 0 && calls.length === 2);
    ok('게이트 false 면 0, 기기에 안 감', A.receive('L050I100', { gate: () => false }) === 0 && calls.length === 2);
    dev.isConnected = false;
    ok('기기 미연결이면 0', A.receive('L050I100') === 0 && calls.length === 2);
}
{
    const { A } = load();
    ok('PulseDevice 없으면 0 (예외 없음)', A.receive('L050I100') === 0);
}

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`);
process.exit(fail ? 1 : 0);
