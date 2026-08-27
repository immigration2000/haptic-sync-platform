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
            lastError:          state.lastError,
        };
    }

    // ─── 전송 ────────────────────────────────────────────────
    // 참고 구현(tnxa/mosa `useSerialHook`)과 같은 방식 — **write를 기다리지 않는다.**
    // 스트림에 넣고 바로 다음으로 넘어가며, 배압은 스트림 내부 큐가 처리한다.
    //
    // ⚠ 예전에는 write를 await하고 500ms를 넘기면 포트를 버리는 fail-closed였다.
    //   기기가 잠깐 느려지기만 해도 연결이 통째로 끊겨 복구가 안 됐다.
    //   실사용에서 "스트로크 제어를 건드리면 연결이 끊긴다"로 나타났다. 그래서 걷어냈다.
    //   실패는 로그로만 남기고 연결은 유지한다. 물리적 단절은 아래 disconnect 이벤트가 잡는다.

    /** 드라이버 인코딩 후 쓰기 1회. 큐에 넣기만 하고 결과를 기다리지 않는다. */
    function writeOnce(cmd) {
        const data = drv().encode(cmd);                 // 캐노니컬 → 기기 바이트 (드라이버가 변환)
        if (state.kind === 'serial' && state.writer) {
            state.writer.write(data).catch(noteWriteError);
            return true;
        }
        if (state.kind === 'bluetooth' && state.btChar) {
            const wantNoResp = drv().ble.write !== 'withResponse';
            const op = (wantNoResp && state.btChar.writeValueWithoutResponse)
                ? state.btChar.writeValueWithoutResponse(data)
                : state.btChar.writeValue(data);
            if (op && op.catch) op.catch(noteWriteError);
            return true;
        }
        return false;
    }

    // 쓰기 실패는 진단용으로만 남긴다 (연결을 끊지 않는다).
    // 같은 오류가 쏟아질 수 있으므로 처음 1회와 100회마다만 콘솔에 찍는다.
    let writeErrCount = 0;
    function noteWriteError(e) {
        writeErrCount++;
        state.lastError = (e && e.message) ? e.message : '전송 오류';
        if (writeErrCount === 1 || writeErrCount % 100 === 0) {
            console.warn(`[PulseDevice] 전송 실패 (${writeErrCount}건째):`, state.lastError);
        }
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
        // 앞선 해제가 실패해 포트가 열린 채 남아 있을 수 있다(disconnect의 leftOpen).
        // 그대로 open()하면 InvalidStateError가 나서 재연결이 영영 안 된다 → 먼저 닫아본다.
        if (port.readable || port.writable) {
            await bounded(port.close(), 500);
        }
        await port.open({ baudRate: drv().serialBaud });
        startSerialRead(port);                       // 응답 수신 시작 (await 안 함)
        const writer = port.writable.getWriter();
        state.port      = port;
        state.writer    = writer;
        state.kind      = 'serial';
        state.connected = true;
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
        state.lastError = '';
        state.portLabel = `BLE · ${device.name || 'Unknown'}`;
        sessionStorage.setItem(KEY_INTENT, 'bluetooth');
        notify();
        for (const c of drv().init) { await send(c); }
    }

    // 해제 경로 전용 시간 제한.
    // 전송에는 시간 제한을 두지 않지만(느린 기기를 끊지 않기 위해),
    // **정리는 반드시 끝나야 한다.** 멈춘 쓰기가 있으면 close()가 영영 안 끝나기 때문이다.
    function bounded(promise, ms) {
        return Promise.race([
            Promise.resolve(promise).catch(() => {}),
            new Promise((resolve) => setTimeout(resolve, ms)),
        ]);
    }

    // ─── 공통 disconnect ─────────────────────────────────────
    async function disconnect(opts) {
        const keepIntent = !!(opts && opts.keepIntent);
        let leftOpen = null;        // 닫는 데 실패한 포트 — 지우지 말고 남겨야 재시도할 수 있다
        try {
            if (state.kind === 'serial') {
                if (state.writer) {
                    try { writeOnce(drv().stop); } catch (_) {}
                    // write를 기다리지 않으므로 큐에 남은 게 있을 수 있다.
                    // abort()는 대기 중 쓰기를 실패시키며 스트림을 버린다 — 그래야 포트가 풀린다.
                    //
                    // ⚠ abort()가 300ms 안에 안 끝나도 **잠금은 반드시 푼다.**
                    //   잠긴 채로 close()하면 거부되고, 포트가 OS에 열린 채 남는다.
                    //   (기기가 이동 명령 수행 중이면 버퍼를 안 빼가 abort가 늦어질 수 있다)
                    try { await bounded(state.writer.abort(), 300); }
                    finally { try { state.writer.releaseLock(); } catch (_) {} }
                }
                // 읽기 스트림 먼저 정리해야 port.close()가 걸리지 않음
                if (state.reader) {
                    try { await state.reader.cancel(); } catch (_) {}
                    try { state.reader.releaseLock(); } catch (_) {}
                }
                if (state.readDone) { await bounded(state.readDone, 300); }
                if (state.port) {
                    await bounded(state.port.close(), 500);
                    // 닫히면 readable/writable이 null이 된다. 남아 있으면 닫기 실패다.
                    // bounded()가 거부를 삼키므로 **결과로 확인하는 수밖에 없다.**
                    if (state.port.readable || state.port.writable) leftOpen = state.port;
                }
            } else if (state.kind === 'bluetooth') {
                try { await writeOnce(drv().stop); } catch (_) {}
                if (state.btDevice && state.btDevice.gatt && state.btDevice.gatt.connected) {
                    try { state.btDevice.gatt.disconnect(); } catch (_) {}
                }
            }
        } finally {
            // 닫기에 실패했으면 포트 참조를 남긴다. null로 지우면 다시 닫을 방법이 없어져
            // 페이지를 새로고침할 때까지 OS 포트가 잡힌 채로 남는다.
            state.port = leftOpen;
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
            // 해제 실패는 **반드시 드러나야 한다.** 예전에는 bounded()가 거부를 삼키고
            // finally가 무조건 상태를 지워서, 화면은 '해제됨'인데 포트는 열린 채 남았고
            // 콘솔에 아무 흔적도 없었다.
            if (leftOpen) {
                state.lastError = '포트를 닫지 못했습니다. 다시 연결을 시도하거나 페이지를 새로고침해 주세요.';
                console.warn('[PulseDevice] 포트 닫기 실패 — OS에 열린 채로 남아 있습니다.', leftOpen.getInfo());
            } else {
                state.lastError = '';
            }
            if (!keepIntent) sessionStorage.removeItem(KEY_INTENT);
            notify();
        }
    }

    // ─── 공통 send ───────────────────────────────────────────
    function send(cmd) {
        if (!state.connected) return false;
        if (!writeOnce(cmd)) return false;
        state.sentCount++;
        if (state.sentCount % 5 === 0) notify();
        return true;
    }

    // ─── 원격 수신 명령 전용 송신 ─────────────────────────────
    // ⚠ 드라이버의 정규화 함수는 **검증기가 아니다.** 축 패턴과 안 맞는 토큰은
    //   그대로 통과시켜 시리얼 포트로 내보낸다(D1/DSTOP을 통과시키기 위한 설계).
    //   따라서 원격(WebRTC 데이터채널·방송 소켓)에서 받은 문자열을 send()에 바로 넣으면
    //   임의 문자열이 기기로 나간다. 원격 입력은 반드시 이 함수를 쓴다.
    //
    //   허용: 축 명령만 (L0500I0100, 다축 한 줄 묶음)
    //   차단: D1/DSTOP 등 제어 명령 포함 그 외 전부 — 원격이 기기 상태를 바꾸게 두지 않는다
    const AXIS_CMD  = /^[LR][0-9]\d{1,4}(?:I\d{1,5})?$/;
    const MAX_TOKENS = 6;                  // 축 6개(L0/L1/L2/R0/R1/R2)가 상한
    let rejectCount = 0;

    /** 원격 명령 송신. 반환값: 보낸 토큰 수 (0이면 거부됨) */
    function sendRemote(cmd) {
        const line = String(cmd == null ? '' : cmd).trim();
        if (!line) return 0;
        const toks = line.split(/\s+/);
        // 하나라도 이상하면 줄 전체를 버린다. 조작된 명령의 일부만 실행되는 게 더 위험하다.
        if (toks.length > MAX_TOKENS || !toks.every(t => AXIS_CMD.test(t))) {
            rejectCount++;
            if (rejectCount === 1 || rejectCount % 100 === 0) {
                console.warn(`[PulseDevice] 원격 명령 거부 (${rejectCount}건째): ` + line.slice(0, 40));
            }
            return 0;
        }
        send(line);                         // 다축은 한 줄로 — 드라이버가 토큰별 정규화
        return toks.length;
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
        sendRemote,
        get rejectedCount() { return rejectCount; },
        get isConnected() { return state.connected; },
        get kind()        { return state.kind; },
        get sentCount()   { return state.sentCount; },
        get portLabel()   { return state.portLabel; },
        getStatus,
        onChange(cb) { listeners.add(cb); return () => listeners.delete(cb); },
    };

    tryAutoReconnect();
})();
