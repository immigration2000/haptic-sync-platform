/**
 * BLE 릴레이 고부하·지연 테스트 — `public/js/core/device.js`
 *
 *   실행: node scripts/test_ble_relay_load.mjs
 *
 * 왜 따로 있는가 (2026-11-19 인계서 BLE-06):
 *   `test_ble_input.mjs` 는 **기능**만 본다 — 줄 조립, 2대 연결, 그대로 복사.
 *   실기기에서 보고된 "끊김"은 기능이 아니라 **타이밍**에서 나왔다. 그래서 여기서는
 *   타이머가 늦게 발화하는 상황과 쓰기가 느린 기기를 흉내 내어 다음을 지킨다:
 *
 *   1) BLE-02 — 지나간 줄이 새 줄 **뒤에** 나가지 않는다 (위치 역전 금지)
 *   2) BLE-03 — 기기가 느려도 쓰기 큐가 쌓이지 않는다 (쓰기 완료 기준 배압)
 *   3) 쓰기가 끝내 안 돌아와도 릴레이가 **영구히 멈추지 않는다** (안전장치)
 *   4) BLE-04 — 통계는 이번 연결 기준으로 센다
 *   5) BLE-05 — 큐에 넣은 수와 **실제로 쓰기가 끝난 수**를 구분해 센다
 *   6) 구독자가 없으면 진단 로그를 **내보내지 않는다** (로그 자체가 끊김을 만들었다)
 */
import fs from 'fs';
import vm from 'vm';

const SRC = fs.readFileSync(new URL('../public/js/core/device.js', import.meta.url), 'utf8');

let pass = 0, fail = 0;
const ok = (n, c, e = '') => { c ? pass++ : fail++; console.log(`  ${c ? '✅' : '❌'} ${n}${e ? ' — ' + e : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── 가짜 캐릭터리스틱 ─────────────────────────────────────
// writeDelay: 쓰기가 끝나는 데 걸리는 시간(ms). null 이면 **영원히 끝나지 않는다**.
function mkChar(uuid, props, opts = {}) {
    const listeners = [];
    return {
        uuid, properties: props, notifying: false,
        writes: [], failNext: false,
        async startNotifications() { this.notifying = true; return this; },
        async stopNotifications() { this.notifying = false; return this; },
        addEventListener(ev, fn) { if (ev === 'characteristicvaluechanged') listeners.push(fn); },
        removeEventListener(ev, fn) { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); },
        holds: [],
        /** 붙잡아둔 쓰기를 전부 끝낸 것으로 처리 (기기가 다시 응답하기 시작한 상황) */
        release() { const h = this.holds.splice(0); h.forEach((r) => r()); return h.length; },
        _write(d) {
            const text = new TextDecoder().decode(d);
            if (this.failNext) { this.failNext = false; return Promise.reject(new Error('가짜 쓰기 실패')); }
            this.writes.push(text);
            // hold: 내가 release() 할 때까지 끝나지 않는다 (응답 없는 기기)
            if (opts.hold) return new Promise((r) => this.holds.push(r));
            if (!opts.writeDelay) return Promise.resolve();
            return new Promise((r) => setTimeout(r, opts.writeDelay));
        },
        writeValueWithoutResponse(d) { return this._write(d); },
        writeValue(d) { return this._write(d); },
        emit(text) {
            const value = new DataView(new TextEncoder().encode(text).buffer);
            listeners.slice().forEach((fn) => fn({ target: { value } }));
        },
    };
}

function mkDevice(id, name, chars) {
    return {
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
                }; } };
            },
            disconnect() { this.connected = false; },
        },
    };
}

/**
 * timers: 'real' 이면 실제 setTimeout, 'held' 면 **발화를 내가 직접 한다.**
 *   타이머가 늦게 발화하는 상황(메인 스레드 혼잡)을 재현하기 위한 것이다.
 */
function makeCtx(queue, { timers = 'real', channel = null } = {}) {
    const held = [];
    const ctx = {
        console: { log() {}, warn() {}, time() {}, timeEnd() {} },
        clearTimeout: (h) => { if (timers === 'real') clearTimeout(h); else { const i = held.findIndex((x) => x.h === h); if (i >= 0) held.splice(i, 1); } },
        setTimeout: timers === 'real' ? setTimeout : (fn, ms) => { const h = Symbol('t'); held.push({ h, fn, ms }); return h; },
        setInterval, clearInterval,
        Date, Promise, Error, Object, String, Math, Set, Symbol,
        TextEncoder, TextDecoder, DataView, ArrayBuffer,
        sessionStorage: { _d: {}, getItem(k) { return this._d[k] || null; },
                          setItem(k, v) { this._d[k] = v; }, removeItem(k) { delete this._d[k]; } },
        navigator: { bluetooth: { requestDevice: async () => queue.shift() } },
    };
    if (channel) ctx.BroadcastChannel = channel;
    ctx.window = ctx; ctx.globalThis = ctx;
    ctx.window.addEventListener = () => {};
    vm.createContext(ctx);
    vm.runInContext(SRC, ctx);
    ctx._held = held;
    ctx._fireHeld = () => { const list = held.splice(0); list.forEach((t) => t.fn()); return list.length; };
    return ctx;
}

async function setup(opts = {}) {
    const outTx = mkChar('tx-uuid', { write: true, writeWithoutResponse: true }, opts);
    const out = mkDevice('dev-OUT', '출력기기', [outTx, mkChar('rx-uuid', { notify: true })]);
    const inRx = mkChar('rx-uuid', { notify: true });
    const inp = mkDevice('dev-IN', '입력기기', [mkChar('tx-uuid', { write: true }), inRx]);

    const ctx = makeCtx([out, inp], opts);
    ctx.window.PulseDrivers = { active: () => ({
        id: 't', name: 't', serialBaud: 115200,
        ble: { service: 'svc', txChar: 'tx-uuid', rxChar: 'rx-uuid', write: 'withoutResponse' },
        init: [], stop: 'DSTOP', idle: 'L050I300',
        encode: (c) => new TextEncoder().encode(c + '\n'),
    }) };
    const D = ctx.window.PulseDevice;
    await D.connectBluetooth();
    await D.connectBluetoothInput();
    return { D, outTx, inRx, ctx };
}

// ─────────────────────────────────────────────────────────────
console.log('\n1. 🔴 BLE-02 — 지나간 줄이 새 줄 뒤에 나가지 않는다');
{
    // 타이머 발화를 내가 쥐고 있다가, 새 줄이 즉시 나간 **뒤에** 발화시킨다.
    // 수정 전에는 여기서 B(옛 위치)가 C(새 위치) 뒤에 나갔다.
    const { D, outTx, inRx, ctx } = await setup({ timers: 'held' });

    inRx.emit('A1\n');                       // 첫 줄 — 즉시 송신
    await sleep(2);
    inRx.emit('B2\n');                       // 20ms 안이라 대기 (타이머는 내 손에 잡혀 있다)
    ok('간격 안의 줄은 대기 타이머에 걸린다', ctx._held.length >= 1, String(ctx._held.length));

    await sleep(25);                         // 간격이 지났다
    inRx.emit('C3\n');                       // 즉시 송신 — 이때 대기 줄 B2 를 버려야 한다
    await sleep(5);
    const seq = outTx.writes.map((w) => w.trim());
    ok('새 줄은 즉시 나갔다', seq.includes('C3'), JSON.stringify(seq));
    // ★ 수정의 핵심 — 예전에는 타이머가 그대로 살아남아 B2 가 C3 뒤에 나갔다
    ok('🔴 즉시 송신 때 대기 타이머를 정리한다', ctx._held.length === 0, ctx._held.length + '개 남음');

    const fired = ctx._fireHeld();           // 늦게 발화할 타이머가 있었다면 지금 발화한다
    await sleep(5);
    const seq2 = outTx.writes.map((w) => w.trim());
    ok('옛 줄(B2)은 끝까지 나가지 않는다', !seq2.includes('B2'), JSON.stringify(seq2));
    ok('마지막으로 나간 값이 최신값이다', seq2[seq2.length - 1] === 'C3', JSON.stringify(seq2));
    ok('버린 줄은 생략으로 집계된다', D.getInputStatus().dropped >= 1, String(D.getInputStatus().dropped));
    ok('(발화를 기다리는 타이머가 없었다)', fired === 0, String(fired));
}

// ─────────────────────────────────────────────────────────────
console.log('\n2. 🔴 BLE-03 — 기기가 느려도 쓰기 큐가 쌓이지 않는다');
{
    // 쓰기 1회가 60ms 걸리는 기기. 입력은 그보다 훨씬 빠르게 쏟아진다.
    const { D, outTx, inRx } = await setup({ writeDelay: 60 });
    let maxQueued = 0;
    for (let i = 0; i < 60; i++) {
        inRx.emit(`L${String(i).padStart(3, '0')}I100\n`);
        await sleep(3);
        const q = D.getStatus().queued;
        if (q > maxQueued) maxQueued = q;
    }
    await sleep(120);
    ok('쓰기 대기가 쌓이지 않는다 (≤2)', maxQueued <= 2, '최대 ' + maxQueued);
    ok('느린 기기에 맞춰 덜 보낸다 (60줄 중 일부만)', outTx.writes.length < 30,
       outTx.writes.length + '줄');
    ok('그래도 전송은 계속된다', outTx.writes.length >= 2, outTx.writes.length + '줄');
    const last = outTx.writes[outTx.writes.length - 1].trim();
    ok('마지막으로 나간 값이 최신 쪽이다', last === 'L059I100' || last === 'L058I100', last);
}

// ─────────────────────────────────────────────────────────────
console.log('\n3. 기기가 응답을 멈춰도 큐가 폭증하지 않고, 풀리면 바로 복귀한다');
{
    // GATT 쓰기 Promise 가 돌아오지 않는 기기. 쓰기 큐는 직렬이라 뒤가 전부 막힌다.
    // ⚠ 여기서 지켜야 할 것은 "계속 보내는 것"이 아니다 — 그건 큐가 막혀 있어 불가능하다.
    //   지켜야 할 것은 ① 릴레이가 큐에 무한정 밀어넣지 않는 것(배압),
    //   ② 연결을 버리지 않는 것(예전 fail-closed 사고), ③ 풀리면 **최신값**으로 바로 복귀하는 것.
    const { D, outTx, inRx } = await setup({ hold: true });
    let maxQueued = 0;
    for (let i = 0; i < 40; i++) {
        inRx.emit(`L${i}I100\n`);
        await sleep(20);
        const q = D.getStatus().queued;
        if (q > maxQueued) maxQueued = q;
    }
    ok('응답 없는 기기에도 대기가 폭증하지 않는다 (40줄 입력, 대기 ≤5)', maxQueued <= 5, '최대 ' + maxQueued);
    ok('연결은 유지된다 (fail-closed 아님)', D.isConnected === true);
    ok('쓰기 완료는 0 으로 정직하게 보고된다', D.getStatus().writeOk === 0, String(D.getStatus().writeOk));
    ok('막혀 있는 동안 실제로 나간 건 1줄뿐', outTx.writes.length === 1, outTx.writes.length + '줄');

    const released = outTx.release();                 // 기기가 다시 응답하기 시작
    await sleep(60);
    ok('풀리면 다시 나간다', outTx.writes.length > 1, outTx.writes.length + '줄');
    ok('쓰기 완료가 집계된다', D.getStatus().writeOk >= 1, String(D.getStatus().writeOk));
    ok('(실제로 붙잡고 있었다)', released >= 1, String(released));
}

// ─────────────────────────────────────────────────────────────
console.log('\n4. BLE-04 — 통계는 이번 연결 기준으로 센다');
{
    const { D, inRx, ctx } = await setup({ writeDelay: 60 });
    for (let i = 0; i < 10; i++) { inRx.emit(`L${i}I100\n`); }
    await sleep(10);
    ok('첫 세션에 수신이 쌓였다', D.getInputStatus().rxCount === 10, String(D.getInputStatus().rxCount));
    ok('첫 세션에 생략도 쌓였다', D.getInputStatus().dropped > 0, String(D.getInputStatus().dropped));

    await D.disconnectInput();
    ctx.navigator.bluetooth.requestDevice = async () =>
        mkDevice('dev-IN2', '입력기기2', [mkChar('tx-uuid', { write: true }), mkChar('rx-uuid', { notify: true })]);
    await D.connectBluetoothInput();
    ok('재연결하면 수신이 0 부터', D.getInputStatus().rxCount === 0, String(D.getInputStatus().rxCount));
    ok('재연결하면 생략도 0 부터', D.getInputStatus().dropped === 0, String(D.getInputStatus().dropped));
}

// ─────────────────────────────────────────────────────────────
console.log('\n5. BLE-05 — 큐에 넣은 수와 쓰기가 끝난 수를 구분한다');
{
    const { D, outTx } = await setup({ writeDelay: 40 });
    const base = D.getStatus();
    D.send('L050I100');
    const mid = D.getStatus();
    ok('요청은 바로 올라간다', mid.sentCount === base.sentCount + 1);
    ok('완료는 아직 아니다', mid.writeOk === base.writeOk, `${mid.writeOk} vs ${base.writeOk}`);
    ok('대기 중으로 보인다', mid.queued >= 1, String(mid.queued));
    await sleep(70);
    const done = D.getStatus();
    ok('쓰기가 끝나면 완료가 올라간다', done.writeOk === base.writeOk + 1, String(done.writeOk));
    ok('대기가 0 으로 돌아온다', done.queued === 0, String(done.queued));

    outTx.failNext = true;
    const beforeErr = D.getStatus().writeErr;
    D.send('L060I100');
    await sleep(30);
    ok('실패는 실패로 센다', D.getStatus().writeErr === beforeErr + 1, String(D.getStatus().writeErr));
    ok('실패해도 연결은 유지된다', D.isConnected === true);
    ok('실패 후 대기가 남지 않는다', D.getStatus().queued === 0, String(D.getStatus().queued));
}

// ─────────────────────────────────────────────────────────────
console.log('\n6. 🔴 구독자가 없으면 진단 로그를 내보내지 않는다');
{
    // 아무도 안 보는데 초당 수백 건을 postMessage 하면 그게 끊김의 원인이 된다(2026-11-20).
    const posted = [];
    let onmsg = null;
    class FakeChannel {
        constructor(name) { this.name = name; }
        set onmessage(fn) { onmsg = fn; }
        get onmessage() { return onmsg; }
        postMessage(m) { posted.push(m); }
    }
    const { D, inRx } = await setup({ channel: FakeChannel });

    for (let i = 0; i < 30; i++) inRx.emit(`L${i}I100\n`);
    await sleep(160);
    ok('구독자가 없으면 한 건도 안 내보낸다', posted.length === 0, posted.length + '건');

    onmsg({ data: { watch: 1, src: 'other-tab' } });       // 다른 탭의 진단 창이 생겼다
    for (let i = 0; i < 30; i++) inRx.emit(`R${i}I100\n`);
    await sleep(160);
    ok('구독자가 있으면 내보낸다', posted.length >= 1, posted.length + '건');
    ok('건별이 아니라 묶어 보낸다', posted.length <= 4, posted.length + '건');
    const total = posted.reduce((n, m) => n + (m.batch ? m.batch.length : 0), 0);
    ok('묶음 안에 여러 건이 들어 있다', total >= 30, total + '건');
    ok('묶음 형식이다', posted.every((m) => Array.isArray(m.batch)), JSON.stringify(posted[0]).slice(0, 60));

    // 자기 자신의 알림은 구독자로 세지 않는다 (같은 문서의 진단 창)
    const before = posted.length;
    onmsg({ data: { watch: 1, src: D.ctxId } });
    await sleep(6100);                                      // 구독 만료 (TTL 6초)
    posted.length = 0;
    for (let i = 0; i < 10; i++) inRx.emit(`S${i}I100\n`);
    await sleep(160);
    ok('구독 알림이 끊기면 발행도 멈춘다', posted.length === 0, posted.length + '건');
    ok('(그 전에는 보내고 있었다)', before >= 1, String(before));
}

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`);
process.exit(fail ? 1 : 0);
