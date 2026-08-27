/**
 * 하드웨어 해제 경로 회귀 테스트 — 가짜 시리얼 포트
 *
 *   실행: node scripts/test_device_disconnect.mjs
 *
 * 왜 있는가:
 *   `public/js/core/device.js`의 해제 경로는 **실기기 없이는 검증이 거의 불가능**한데,
 *   실패해도 화면에 아무 표시가 안 나는 구조라 조용히 썩기 쉽다.
 *   실제로 2026-08-27에 "영상을 멈추고 해제하면 포트가 열린 채 남는다"는 버그가 있었다.
 *   원인은 셋이 겹친 것이었다 —
 *     ① `writer.releaseLock()`을 안 불러 잠긴 채 `close()`로 넘어감
 *     ② `bounded()`가 거부를 전부 삼켜 실패가 안 보임
 *     ③ `finally`가 `state.port`를 지워 다시 닫을 방법조차 없어짐
 *   진짜 원인은 따로 있었다 — **`writer.abort()`가 영영 안 끝나는 것**이다.
 *   실기기 계측(2026-08-28): 연결 직후엔 abort가 0ms에 끝나지만 유휴 20초 뒤에는
 *   5초를 줘도 안 끝나고, 그 뒤 close()까지 같이 매달린다. abort를 빼면 close는 2ms다.
 *   **순수 Web Serial로도 재현되므로 우리 버그가 아니다. 피해 가는 것이 유일한 대응이다.**
 *
 * 무엇을 흉내내는가:
 *   기기가 이동 명령 수행 중이라 시리얼 버퍼를 안 빼가는 상황(= `write`가 영영 안 끝나고
 *   `abort()`도 응답 없음)과, OS가 포트를 안 놓아주는 상황이다.
 *   `document`·`navigator.serial` 등은 vm 컨텍스트에 최소한으로 스텁한다.
 *
 * ⚠ 이 테스트가 통과해도 **실기기 동작을 보장하지는 않는다.** 로직 회귀만 잡는다.
 */
import fs from 'fs';
import vm from 'vm';

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
const SRC = read('../public/js/core/device.js');
const DRV = read('../public/js/core/device_drivers.js');

/**
 * 가짜 SerialPort
 * @param abortHangs      abort()가 영영 안 끝난다 (기기가 버퍼를 안 빼가는 상황)
 * @param closeFailsTimes close()가 앞의 N번 실패한다 (OS가 포트를 안 놓아주는 상황)
 */
function makePort({ abortHangs = false, closeFailsTimes = 0 } = {}) {
    const p = {
        readable: null,
        writable: null,
        _closeFails: closeFailsTimes,
        releaseCalls: 0,
        abortCalls: 0,
        getInfo: () => ({ usbVendorId: 0x10c4, usbProductId: 0xea60 }),

        async open() {
            // 실제 Web Serial은 이미 열린 포트를 다시 열면 던진다
            if (p.readable || p.writable) {
                throw new DOMException('The port is already open.', 'InvalidStateError');
            }
            p.readable = new ReadableStream({ start() {} });
            p.writable = new WritableStream({
                write() { return new Promise(() => {}); },   // 기기가 안 빼감 — 영원히 대기
                abort() { return abortHangs ? new Promise(() => {}) : Promise.resolve(); },
            });
            // releaseLock 호출 여부를 세기 위해 래핑
            const orig = p.writable.getWriter.bind(p.writable);
            p.writable.getWriter = () => {
                const w = orig();
                const rl = w.releaseLock.bind(w);
                w.releaseLock = () => { p.releaseCalls++; return rl(); };
                const ab = w.abort.bind(w);
                w.abort = (r) => { p.abortCalls++; return ab(r); };
                return w;
            };
        },

        async close() {
            if (p._closeFails > 0) {
                p._closeFails--;
                throw new DOMException('close failed', 'InvalidStateError');
            }
            // 잠긴 스트림이 남아 있으면 닫히지 않는다 — 이게 원래 버그의 핵심이다
            if ((p.readable && p.readable.locked) || (p.writable && p.writable.locked)) {
                throw new TypeError('스트림이 잠겨 있어 닫을 수 없다');
            }
            p.readable = null;
            p.writable = null;
        },
    };
    return p;
}

/** device.js를 격리된 컨텍스트에 올리고 PulseDevice를 돌려준다 */
function load(port) {
    const store = {};
    const ctx = {
        console, setTimeout, clearTimeout, queueMicrotask,
        ReadableStream, WritableStream, TextDecoderStream,
        TextEncoder, TextDecoder, DOMException, TypeError, Promise,
        addEventListener: () => {},
        sessionStorage: {
            getItem: (k) => (k in store ? store[k] : null),
            setItem: (k, v) => { store[k] = String(v); },
            removeItem: (k) => { delete store[k]; },
        },
        navigator: {
            serial: {
                addEventListener() {},
                getPorts: async () => [],
                requestPort: async () => port,
            },
        },
    };
    ctx.window = ctx;
    ctx.globalThis = ctx;
    vm.createContext(ctx);
    vm.runInContext(DRV + '\n' + SRC, ctx);
    return ctx.window.PulseDevice;
}

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
    cond ? pass++ : fail++;
    console.log(`  ${cond ? '✅' : '❌'} ${name}${extra ? ' — ' + extra : ''}`);
};

// ── 1. abort()가 멈춰도 잠금을 풀고 포트를 닫는다 ────────────────
console.log('\n1. abort()가 응답 없음 (기기가 이동 명령 수행 중인 상황)');
{
    const port = makePort({ abortHangs: true });
    const D = load(port);
    await D.connectSerial();
    ok('연결됨', D.isConnected);

    const t0 = Date.now();
    await D.disconnect();
    const ms = Date.now() - t0;

    ok('releaseLock() 호출됨', port.releaseCalls > 0, `${port.releaseCalls}회`);
    // ⚠ 실기기에서 abort()는 유휴 후 영영 안 끝난다(2026-08-28 계측). 절대 부르면 안 된다.
    ok('writer.abort()를 부르지 않음', port.abortCalls === 0, `${port.abortCalls}회`);
    ok('포트가 실제로 닫힘', port.readable === null && port.writable === null);
    ok('해제 상태', !D.isConnected);
    ok('오류 없음', !D.getStatus().lastError, D.getStatus().lastError || '—');
    ok('시간 제한 지켜짐 (<2s)', ms < 2000, ms + 'ms');
}

// ── 2. close() 실패를 조용히 넘기지 않는다 ──────────────────────
console.log('\n2. close()가 실패 (OS가 포트를 안 놓아주는 상황)');
{
    const port = makePort({ closeFailsTimes: 99 });
    const D = load(port);
    await D.connectSerial();
    await D.disconnect();

    ok('포트가 열린 채 남음 (재현 조건)', !!(port.readable || port.writable));
    ok('lastError로 보고됨', !!D.getStatus().lastError, D.getStatus().lastError || '(비어있음)');
    ok('연결 상태는 해제', !D.isConnected);
}

// ── 3. 해제에 실패해도 재연결이 된다 ────────────────────────────
console.log('\n3. 해제 실패 후 재연결');
{
    const port = makePort({ closeFailsTimes: 1 });   // 첫 close만 실패
    const D = load(port);
    await D.connectSerial();
    await D.disconnect();
    ok('1차 해제 실패 (포트 남음)', !!(port.readable || port.writable));

    await D.connectSerial();          // 남은 포트를 먼저 닫고 다시 연다
    ok('재연결 성공', D.isConnected);

    await D.disconnect();
    ok('2차 해제 성공', port.readable === null && !D.getStatus().lastError);
}

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`);
process.exit(fail ? 1 : 0);
