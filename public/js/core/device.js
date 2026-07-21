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
        };
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
                    try { await send(drv().stop); } catch (_) {}
                    try { state.writer.releaseLock(); } catch (_) {}
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
                try { await send(drv().stop); } catch (_) {}
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
            state.sentCount = 0;
            state.portLabel = '';
            if (!keepIntent) sessionStorage.removeItem(KEY_INTENT);
            notify();
        }
    }

    // ─── 공통 send ───────────────────────────────────────────
    async function send(cmd) {
        if (!state.connected) return false;
        try {
            const data = drv().encode(cmd);                 // 캐노니컬 → 기기 바이트 (드라이버가 변환)
            if (state.kind === 'serial' && state.writer) {
                await state.writer.write(data);
            } else if (state.kind === 'bluetooth' && state.btChar) {
                const wantNoResp = drv().ble.write !== 'withResponse';
                if (wantNoResp && state.btChar.writeValueWithoutResponse) {
                    await state.btChar.writeValueWithoutResponse(data);
                } else {
                    await state.btChar.writeValue(data);
                }
            } else {
                return false;
            }
            state.sentCount++;
            if (state.sentCount % 5 === 0) notify();
            return true;
        } catch (e) {
            console.warn('PulseDevice send failed', e);
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
            if (state.kind === 'serial' && state.writer) {
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
