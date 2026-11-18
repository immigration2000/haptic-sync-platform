/**
 * BLE 입력 기기 → 출력 릴레이 테스트 — `public/js/core/device.js`
 *
 *   실행: node scripts/test_ble_input.mjs
 *
 * 무엇을 지키는가 (2026-11-18 하드웨어 작업자 요청):
 *   1) 폰 1대에 **출력·입력 2대**를 동시에 붙인다 (출력 연결은 기존 그대로)
 *   2) rxChar(notify)로 들어온 줄을 **그대로** txChar 로 복사한다
 *   3) rxChar UUID 를 모르면 서비스에서 notify 되는 캐릭터리스틱을 **자동 탐색**한다
 *   4) ⚠ BLE 알림은 MTU 단위로 쪼개져 온다 — 한 줄이 여러 알림에 걸쳐 오거나
 *      한 알림에 여러 줄이 올 수 있다. **버퍼링해서 줄 단위로 잘라야** 한다
 *   5) 출력과 같은 기기를 입력으로 붙이면 되먹임이 되므로 막는다
 */
import fs from 'fs';
import vm from 'vm';

const SRC = fs.readFileSync(new URL('../public/js/core/device.js', import.meta.url), 'utf8');

let pass = 0, fail = 0;
const ok = (n, c, e = '') => { c ? pass++ : fail++; console.log(`  ${c ? '✅' : '❌'} ${n}${e ? ' — ' + e : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── 가짜 Web Bluetooth ───────────────────────────────────
function mkChar(uuid, props) {
    const listeners = [];
    return {
        uuid, properties: props, notifying: false, writes: [],
        async startNotifications() { this.notifying = true; return this; },
        async stopNotifications() { this.notifying = false; return this; },
        addEventListener(ev, fn) { if (ev === 'characteristicvaluechanged') listeners.push(fn); },
        removeEventListener(ev, fn) { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); },
        async writeValueWithoutResponse(d) { this.writes.push(new TextDecoder().decode(d)); },
        async writeValue(d) { this.writes.push(new TextDecoder().decode(d)); },
        /** 기기가 알림을 보낸 것처럼 흉내 */
        emit(text) {
            const value = new DataView(new TextEncoder().encode(text).buffer);
            listeners.slice().forEach((fn) => fn({ target: { value } }));
        },
    };
}
function mkDevice(id, name, chars) {
    const dev = {
        id, name, _disc: [],
        addEventListener(ev, fn) { if (ev === 'gattserverdisconnected') this._disc.push(fn); },
        gatt: {
            connected: false,
            async connect() {
                this.connected = true;
                return { async getPrimaryService() { return {
                    async getCharacteristics() { return chars; },
                    async getCharacteristic(u) {
                        const c = chars.find((x) => x.uuid === u);
                        if (!c) throw new Error('no char ' + u);
                        return c;
                    },
                } ; } };
            },
            disconnect() { this.connected = false; },
        },
    };
    return dev;
}

function makeCtx(queue) {
    const ctx = {
        console: { log() {}, warn() {}, time() {}, timeEnd() {} },
        setTimeout, clearTimeout, Date, Promise, Error, Object, String, Math, Set,
        TextEncoder, TextDecoder, DataView, ArrayBuffer,
        sessionStorage: { _d: {}, getItem(k) { return this._d[k] || null; },
                          setItem(k, v) { this._d[k] = v; }, removeItem(k) { delete this._d[k]; } },
        navigator: {
            bluetooth: { requestDevice: async () => queue.shift() },
        },
    };
    ctx.window = ctx; ctx.globalThis = ctx;
    ctx.window.addEventListener = () => {};
    vm.createContext(ctx);
    vm.runInContext(SRC, ctx);
    return ctx;
}

/** 출력 기기 1대 + 입력 기기 1대를 붙인 상태를 만든다 */
async function setup({ sameDevice = false, rxUuid = null } = {}) {
    const outTx = mkChar('tx-uuid', { write: true, writeWithoutResponse: true });
    const outRx = mkChar('rx-uuid', { notify: true });
    const out = mkDevice('dev-OUT', '출력기기', [outTx, outRx]);

    const inTx = mkChar('tx-uuid', { write: true, writeWithoutResponse: true });
    const inRx = mkChar('rx-uuid', { notify: true });
    const inp = sameDevice ? out : mkDevice('dev-IN', '입력기기', [inTx, inRx]);

    const ctx = makeCtx([out, inp]);
    const D = ctx.window.PulseDevice;
    // 드라이버 폴백이 txChar='216f...' 를 찾으므로 UUID 를 맞춰준다
    ctx.window.PulseDrivers = {
        active: () => ({
            id: 't', name: 't', serialBaud: 115200,
            ble: { service: 'svc', txChar: 'tx-uuid', rxChar: rxUuid, write: 'withoutResponse' },
            init: [], stop: 'DSTOP', idle: 'L050I300',
            encode: (c) => new TextEncoder().encode(c + '\n'),
        }),
    };
    await D.connectBluetooth();          // 출력
    return { D, out, outTx, inp, inRx: sameDevice ? outRx : inRx, ctx };
}

console.log('\n1. 출력 1대 + 입력 1대 동시 연결');
{
    const { D, inRx } = await setup();
    ok('출력 연결됨', D.isConnected === true);
    await D.connectBluetoothInput();
    ok('입력도 연결됨 (2대 동시)', D.inputConnected === true);
    ok('입력 상태에 기기 이름', /입력기기/.test(D.getInputStatus().label), D.getInputStatus().label);
    ok('notify 구독 시작됨', inRx.notifying === true);
    ok('출력 연결은 그대로', D.isConnected === true);
}

console.log('\n2. 수신한 줄을 그대로 출력으로 복사');
{
    const { D, outTx, inRx } = await setup();
    await D.connectBluetoothInput();
    const before = outTx.writes.length;
    inRx.emit('L050I100\n');
    await sleep(5);
    const sent = outTx.writes.slice(before);
    ok('출력에 1줄 전달', sent.length === 1, JSON.stringify(sent));
    ok('내용 그대로 (드라이버 인코딩만 적용)', sent[0] === 'L050I100\n', JSON.stringify(sent[0]));
    ok('수신 카운트 증가', D.getInputStatus().rxCount === 1);
    ok('마지막 줄 기록', D.getInputStatus().lastLine === 'L050I100');
}

console.log('\n3. ⚠ MTU 로 쪼개진 알림을 줄 단위로 조립');
{
    const { D, outTx, inRx } = await setup();
    await D.connectBluetoothInput();
    const before = outTx.writes.length;
    inRx.emit('L05');            // 한 줄이 3조각으로 나뉘어 도착
    inRx.emit('0I10');
    await sleep(0);
    ok('줄바꿈 전에는 아무것도 안 보낸다', outTx.writes.length === before, String(outTx.writes.length - before));
    inRx.emit('0\n');
    await sleep(5);
    const sent = outTx.writes.slice(before);
    ok('조립해서 한 줄로 보낸다', sent.length === 1 && sent[0] === 'L050I100\n', JSON.stringify(sent));
}

console.log('\n4. 한 알림에 여러 줄이 와도 각각 처리');
{
    const { D, outTx, inRx } = await setup();
    await D.connectBluetoothInput();
    const before = outTx.writes.length;
    inRx.emit('R0200I050\nR0300I050\n');
    await sleep(60);             // 릴레이 최소 간격(20ms) 때문에 두 번째는 조금 뒤에 나간다
    const sent = outTx.writes.slice(before);
    ok('2줄 모두 수신 집계', D.getInputStatus().rxCount === 2, String(D.getInputStatus().rxCount));
    ok('출력에도 2줄 (마지막 줄 보존)', sent.length === 2 && sent[1] === 'R0300I050\n', JSON.stringify(sent));
}

console.log('\n5. 릴레이 끄면 복사하지 않는다 (수신 집계는 계속)');
{
    const { D, outTx, inRx } = await setup();
    await D.connectBluetoothInput();
    D.setRelay(false);
    const before = outTx.writes.length;
    inRx.emit('L099I100\n');
    await sleep(40);
    ok('출력으로 안 나간다', outTx.writes.length === before);
    ok('그래도 수신은 보인다', D.getInputStatus().rxCount === 1);
    ok('상태에 relay=false', D.getInputStatus().relay === false);
    D.setRelay(true);
    inRx.emit('L010I100\n');
    await sleep(40);
    ok('다시 켜면 나간다', outTx.writes.length === before + 1, String(outTx.writes.length - before));
}

console.log('\n6. rxChar UUID 자동 탐색 / 명시 지정');
{
    const a = await setup({ rxUuid: null });
    await a.D.connectBluetoothInput();
    ok('UUID 없으면 notify 되는 것을 자동 선택', a.inRx.notifying === true);

    const b = await setup({ rxUuid: 'rx-uuid' });
    await b.D.connectBluetoothInput();
    ok('UUID 를 주면 그것을 쓴다', b.inRx.notifying === true);
}

console.log('\n7. 안전장치');
{
    const { D } = await setup({ sameDevice: true });
    let msg = '';
    try { await D.connectBluetoothInput(); } catch (e) { msg = e.message; }
    ok('출력과 같은 기기는 거부 (되먹임 방지)', /같은 기기/.test(msg), msg || '(거부 안 됨)');
    ok('입력은 연결되지 않은 상태', D.inputConnected === false);

    const s = await setup();
    await s.D.connectBluetoothInput();
    await s.D.disconnectInput();
    ok('해제하면 notify 중단', s.inRx.notifying === false);
    ok('해제 후 상태 정리', s.D.inputConnected === false && s.D.getInputStatus().label === '');
    const before = s.outTx.writes.length;
    s.inRx.emit('L050I100\n');
    await sleep(30);
    ok('해제 후 수신해도 출력으로 안 샌다', s.outTx.writes.length === before);
}

console.log('\n8. 출력이 없으면 조용히 버린다 (예외 없음)');
{
    const outTx = mkChar('tx-uuid', { write: true });
    const inRx2 = mkChar('rx-uuid', { notify: true });
    const inp = mkDevice('dev-IN', '입력만', [mkChar('tx-uuid', { write: true }), inRx2]);
    const ctx = makeCtx([inp]);
    ctx.window.PulseDrivers = { active: () => ({
        ble: { service: 'svc', txChar: 'tx-uuid', rxChar: null, write: 'withoutResponse' },
        serialBaud: 115200, init: [], stop: 'DSTOP', idle: 'L050I300',
        encode: (c) => new TextEncoder().encode(c + '\n'),
    }) };
    const D = ctx.window.PulseDevice;
    await D.connectBluetoothInput();
    let threw = false;
    try { inRx2.emit('L050I100\n'); await sleep(30); } catch (_) { threw = true; }
    ok('출력 미연결이어도 예외 없음', !threw);
    ok('수신 집계는 된다', D.getInputStatus().rxCount === 1);
}

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`);
process.exit(fail ? 1 : 0);
