/* PULSE Device Manager — 사이트 전역 디바이스 연결 유지
 *
 * 지원 연결 방식
 * - USB Serial (Web Serial API) — 데스크탑 Chrome/Edge. 페이지 이동 시 자동 재연결됨
 * - Bluetooth LE (Web Bluetooth API + Nordic UART Service) — 모바일/데스크탑 Chrome.
 *     ⚠ 브라우저 정책상 페이지 이동 시 자동 재연결 X (사용자가 다시 선택해야 함)
 *
 * sessionStorage 정책
 * - pulse_device_intent = "serial" | "bluetooth"
 *     "serial"이면 다음 페이지 로드 시 navigator.serial.getPorts()로 자동 재연결
 *     "bluetooth"는 정보만 보관 (자동 재연결 불가, 버튼만 활성화 상태로)
 *
 * API
 * - PulseDevice.connectSerial()      USB 시리얼 연결
 * - PulseDevice.connectBluetooth()   BLE 연결
 * - PulseDevice.disconnect()
 * - PulseDevice.send(cmd)            TCode 명령 송신
 * - PulseDevice.isConnected
 * - PulseDevice.onChange(cb)
 */
(function () {
    const KEY_INTENT = 'pulse_device_intent';

    // 활성 하드웨어 드라이버 (device_drivers.js). 미로드 시 TCode V3 폴백.
    const FALLBACK_DRIVER = {
        id: 'tcode_v3', name: 'TCode V3', serialBaud: 115200,   // TCode 표준 (9600이면 기기가 명령 못 읽음)
        ble: { service: '6e400001-b5a3-f393-e0a9-e50e24dcca9e', txChar: '6e400002-b5a3-f393-e0a9-e50e24dcca9e', write: 'withoutResponse' },
        init: ['D1', 'L050I500'], stop: 'DSTOP', idle: 'L050I300',
        encode: (cmd) => new TextEncoder().encode(cmd + '\n'),
    };
    const drv = () => (window.PulseDrivers && window.PulseDrivers.active()) || FALLBACK_DRIVER;

    const state = {
        kind: null,           // 'serial' | 'bluetooth' | null
        connected: false,
        sentCount: 0,
        portLabel: '',
        deviceInfo: '',       // 기기가 보내온 마지막 응답 (통신 검증용)
        writeDead: false,     // 쓰기 실패로 차단된 상태 (재연결 전까지 출력 거부)
        lastError: '',        // 사용자에게 보여줄 마지막 실패 사유
        // serial
        port: null,
        writer: null,
        reader: null,
        readDone: null,
        // bluetooth
        btDevice: null,
        btChar: null,
    };
    const listeners = new Set();

    function notify() {
        for (const cb of listeners) {
            try { cb(getStatus()); } catch (_) {}
        }
    }

    function getStatus() {
        return {
            serialSupported:    ('serial' in navigator),
            bluetoothSupported: ('bluetooth' in navigator),
            connected:          state.connected,
            kind:               state.kind,
            sentCount:          state.sentCount,
            portLabel:          state.portLabel,
            deviceInfo:         state.deviceInfo,   // 기기 응답 (있으면 통신 정상 = baud 맞음)
            writeDead:          state.writeDead,
            lastError:          state.lastError,
        };
    }

    // ─── 쓰기 타임아웃 · fail-closed ─────────────────────────
    // 기기가 응답을 멈추면 write promise가 영영 안 끝난다. 그런데 Web Streams는
    // write를 큐에 쌓으므로 **하나가 멈추면 뒤따르는 write가 전부 그 뒤에 갇힌다.**
    // → 긴급정지(DSTOP)조차 기기에 도달하지 못한다. 그래서 시간 제한이 필수다.
    // 멈춘 writer는 재사용해도 복구되지 않으므로(큐가 그대로) 포트째 버리고
    // 사용자가 명시적으로 재연결할 때까지 출력을 거부한다. (fail-closed)
    const WRITE_TIMEOUT_MS = 500;

    function withTimeout(promise, ms) {
        let timer;
        return Promise.race([
            promise,
            new Promise((_, reject) => {
                timer = setTimeout(() => reject(new Error('write-timeout')), ms);
            }),
        ]).finally(() => clearTimeout(timer));
    }

    function failClosed(reason) {
        if (state.writeDead) return;          // 이미 차단됨 — 중복 실행 방지
        state.writeDead = true;
        state.connected = false;
        state.lastError = reason;
        console.error('[PulseDevice] 출력 차단 — ' + reason);

        // 참조를 먼저 끊어 이후 send()가 죽은 포트를 못 잡게 한다
        const w = state.writer, r = state.reader, rd = state.readDone, p = state.port;
        state.writer = null; state.reader = null; state.readDone = null; state.port = null;
        state.btChar = null;

        // 정리는 best-effort — 여기서 await로 막히면 차단 자체가 무의미하다
        (async () => {
            try { if (w)  await withTimeout(w.abort(), WRITE_TIMEOUT_MS); } catch (_) {}
            try { if (r)  await r.cancel(); } catch (_) {}
            try { if (rd) await rd; } catch (_) {}
            try { if (p)  await p.close(); } catch (_) {}
        })();

        // 자동 재연결로 조용히 되살아나면 안 된다 — 사용자가 직접 다시 연결해야 한다
        sessionStorage.removeItem(KEY_INTENT);
        notify();
    }

    /** 드라이버 인코딩 후 실제 쓰기 1회 (시간 제한 포함). 성공 여부만 반환. */
    async function writeOnce(cmd) {
        const data = drv().encode(cmd);                 // 캐노니컬 → 기기 바이트 (드라이버가 변환)
        if (state.kind === 'serial' && state.writer) {
            await withTimeout(state.writer.write(data), WRITE_TIMEOUT_MS);
            return true;
        }
        if (state.kind === 'bluetooth' && state.btChar) {
            const wantNoResp = drv().ble.write !== 'withResponse';
            const op = (wantNoResp && state.btChar.writeValueWithoutResponse)
                ? state.btChar.writeValueWithoutResponse(data)
                : state.btChar.writeValue(data);
            await withTimeout(op, WRITE_TIMEOUT_MS);
            return true;
        }
        return false;
    }

    // ─── 기기 응답 읽기 ───────────────────────────────────────
    // baud가 맞아야 정상 텍스트가 돌아온다. 연결 직후 'D1'에 대한 펌웨어 응답이 오면
    // "포트만 열린 게 아니라 기기와 실제로 통신 중"임이 증명된다. (진단용)
    async function startSerialRead(port) {
        try {
            const dec = new TextDecoderStream();
            state.readDone = port.readable.pipeTo(dec.writable).catch(() => {});
            const reader = dec.readable.getReader();
            state.reader = reader;
            let buf = '';
            for (;;) {
                const { value, done } = await reader.read();
                if (done) break;
                buf += value;
                let i;
                while ((i = buf.indexOf('\n')) >= 0) {
                    const line = buf.slice(0, i).trim();
                    buf = buf.slice(i + 1);
                    if (line) {
                        state.deviceInfo = line;
                        console.log('[PulseDevice] ← ' + line);
                        notify();
                    }
                }
                if (buf.length > 300) buf = buf.slice(-300);
            }
        } catch (_) { /* 연결 종료 시 정상 이탈 */ }
    }

    // ─── Serial 연결 ─────────────────────────────────────────
    async function openSerialInternal(port) {
        await port.open({ baudRate: drv().serialBaud });
        startSerialRead(port);                       // 응답 수신 시작 (await 안 함)
        const writer = port.writable.getWriter();
        state.port      = port;
        state.writer    = writer;
        state.kind      = 'serial';
        state.connected = true;
        state.writeDead = false;
        state.lastError = '';
        const info = port.getInfo();
        state.portLabel = (info && info.usbVendorId)
            ? `USB · VID:${info.usbVendorId.toString(16).toUpperCase()} PID:${info.usbProductId.toString(16).toUpperCase()}`
            : 'USB Serial';
        sessionStorage.setItem(KEY_INTENT, 'serial');
        notify();
        for (const c of drv().init) { await send(c); }
    }

    async function connectSerial() {
        if (!('serial' in navigator)) {
            throw new Error('Web Serial 미지원 (Chrome/Edge 89+ 데스크탑 필요)');
        }
        if (state.connected) return;
        const port = await navigator.serial.requestPort();
        await openSerialInternal(port);
    }

    // ─── Bluetooth 연결 ─────────────────────────────────────
    async function connectBluetooth() {
        if (!('bluetooth' in navigator)) {
            throw new Error('Web Bluetooth 미지원 (Chrome Android, Chrome/Edge 데스크탑 필요)');
        }
        if (state.connected) return;

        const ble = drv().ble;
        const device = await navigator.bluetooth.requestDevice({
            filters: [{ services: [ble.service] }],
            optionalServices: [ble.service],
        });

        // 디바이스 끊김 감지
        device.addEventListener('gattserverdisconnected', () => {
            if (state.btDevice === device) {
                state.connected = false;
                state.kind = null;
                state.btChar = null;
                state.btDevice = null;
                state.portLabel = '';
                notify();
            }
        });

        const server = await device.gatt.connect();
        const service = await server.getPrimaryService(ble.service);
        const txChar = await service.getCharacteristic(ble.txChar);

        state.btDevice  = device;
        state.btChar    = txChar;
        state.kind      = 'bluetooth';
        state.connected = true;
        state.writeDead = false;
        state.lastError = '';
        state.portLabel = `BLE · ${device.name || 'Unknown'}`;
        sessionStorage.setItem(KEY_INTENT, 'bluetooth');
        notify();
        for (const c of drv().init) { await send(c); }
    }

    // ─── 공통 disconnect ─────────────────────────────────────
    async function disconnect(opts) {
        const keepIntent = !!(opts && opts.keepIntent);
        try {
            if (state.kind === 'serial') {
                if (state.writer) {
                    // 정지 명령이 막혀도 정리를 멈추면 안 된다 → 시간 제한
                    let stopped = false;
                    try { stopped = await writeOnce(drv().stop); } catch (_) {}
                    // 쓰기가 걸려 있으면 releaseLock()이 예외를 던진다 → abort로 스트림을 버린다
                    if (stopped) {
                        try { state.writer.releaseLock(); } catch (_) {}
                    } else {
                        try { await withTimeout(state.writer.abort(), WRITE_TIMEOUT_MS); } catch (_) {}
                    }
                }
                // 읽기 스트림 먼저 정리해야 port.close()가 걸리지 않음
                if (state.reader) {
                    try { await state.reader.cancel(); } catch (_) {}
                    try { state.reader.releaseLock(); } catch (_) {}
                }
                if (state.readDone) { try { await state.readDone; } catch (_) {} }
                if (state.port) {
                    try { await state.port.close(); } catch (_) {}
                }
            } else if (state.kind === 'bluetooth') {
                try { await writeOnce(drv().stop); } catch (_) {}
                if (state.btDevice && state.btDevice.gatt && state.btDevice.gatt.connected) {
                    try { state.btDevice.gatt.disconnect(); } catch (_) {}
                }
            }
        } finally {
            state.port = null;
            state.writer = null;
            state.reader = null;
            state.readDone = null;
            state.deviceInfo = '';
            state.btDevice = null;
            state.btChar = null;
            state.kind = null;
            state.connected = false;
            state.writeDead = false;      // 명시적 해제 — 다시 연결할 수 있다
            state.lastError = '';
            state.sentCount = 0;
            state.portLabel = '';
            if (!keepIntent) sessionStorage.removeItem(KEY_INTENT);
            notify();
        }
    }

    // ─── 공통 send ───────────────────────────────────────────
    async function send(cmd) {
        if (state.writeDead) return false;              // 차단 상태 — 재연결 전까지 거부
        if (!state.connected) return false;
        try {
            if (!(await writeOnce(cmd))) return false;
            state.sentCount++;
            if (state.sentCount % 5 === 0) notify();
            return true;
        } catch (e) {
            // 타임아웃이든 포트 오류든 스트림은 이미 못 쓴다 → 즉시 차단
            const timedOut = e && e.message === 'write-timeout';
            failClosed(timedOut
                ? '기기 무응답 (' + WRITE_TIMEOUT_MS + 'ms 초과) — 다시 연결하세요'
                : '전송 실패 — 다시 연결하세요');
            return false;
        }
    }

    // ─── 자동 재연결 (Serial만 가능) ─────────────────────────
    async function tryAutoReconnect() {
        const intent = sessionStorage.getItem(KEY_INTENT);
        if (intent !== 'serial') return; // BLE는 자동 재연결 불가
        if (!('serial' in navigator)) return;
        try {
            const ports = await navigator.serial.getPorts();
            if (!ports.length) {
                sessionStorage.removeItem(KEY_INTENT);
                return;
            }
            await openSerialInternal(ports[0]);
        } catch (e) {
            console.warn('PulseDevice auto-reconnect failed', e);
            sessionStorage.removeItem(KEY_INTENT);
        }
    }

    // 페이지 떠날 때 — 안전 위치로 부드럽게 이동 (의도는 유지)
    window.addEventListener('beforeunload', () => {
        try {
            if (!state.writeDead && state.kind === 'serial' && state.writer) {
                state.writer.write(drv().encode(drv().idle));   // 안전 위치 (드라이버별)
            }
            // BLE는 어차피 페이지 unload 시 끊김
        } catch (_) {}
    });

    // 물리적 USB 분리 감지
    if ('serial' in navigator) {
        navigator.serial.addEventListener('disconnect', (e) => {
            if (state.port === e.target) disconnect({ keepIntent: false });
        });
    }

    // 전역 노출
    window.PulseDevice = {
        connectSerial,
        connectBluetooth,
        disconnect,
        send,
        get isConnected() { return state.connected; },
        get kind()        { return state.kind; },
        get sentCount()   { return state.sentCount; },
        get portLabel()   { return state.portLabel; },
        getStatus,
        onChange(cb) { listeners.add(cb); return () => listeners.delete(cb); },
    };

    tryAutoReconnect();
})();
