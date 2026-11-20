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
        ble: {
			service: '2d10a187-a483-4a60-8ca2-59b7d1704146', txChar: '216f3732-6f41-4fde-98fa-e3033a2ace80',	// ESP32
		//	service: '6e400001-b5a3-f393-e0a9-e50e24dcca9e', txChar: '6e400002-b5a3-f393-e0a9-e50e24dcca9e',	// NUS; Nordic UART Service
			write: 'withoutResponse'
		},
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

    // ─── 입력(두 번째 BLE) 기기 ──────────────────────────────
    // 출력 상태(state)와 **완전히 분리**해 둔다. 기존 코드 전부가 state 만 보고 동작하므로
    // 여기를 건드리지 않는 한 기존 동작이 바뀌지 않는다.
    const inState = {
        connected: false,
        device: null,
        rxChar: null,
        label: '',
        rxCount: 0,        // 수신한 '줄' 수
        lastLine: '',
        lastError: '',
        buf: '',           // 줄 조립 버퍼
        lastRxAt: 0,       // 도착 간격 계측용
    };
    let relayOn = true;
    const inputListeners = new Set();

    // ─── 진단 로그 버스 ──────────────────────────────────────
    // 기기 입출력에서 일어나는 **모든 일**을 한 줄기로 모은다 — 실기기 디버깅용(2026-11-19).
    //   in     기기에서 받은 줄
    //   out    기기로 보낸 줄 (앱 어디서 보냈든)
    //   relay  입력 → 출력 복사로 나간 줄
    //   drop   간격 제한으로 **보내지 않고 버린** 줄
    //   reject 원격 명령 검증에서 **거부한** 줄
    //   err    전송 실패
    //   info   연결·해제·캐릭터리스틱 목록 등
    // ⚠ 새 창은 **별도 자바스크립트 컨텍스트**라 이 버퍼를 공유하지 못한다.
    //   그래서 BroadcastChannel 로도 뿌려 다른 탭의 진단 창이 실시간으로 볼 수 있게 한다.
    //   (BroadcastChannel 은 보낸 쪽에는 되돌아오지 않으므로 메아리 걱정이 없다)
    // 이 자바스크립트 컨텍스트(탭/창)의 식별자.
    // ⚠ BroadcastChannel 은 **같은 문서 안의 다른 채널 객체에도** 전달된다 —
    //   진단 창이 자기 이벤트를 '다른 탭' 으로 한 번 더 받아 중복으로 찍혔다. 그래서 꼬리표를 단다.
    const CTX_ID = Math.random().toString(36).slice(2, 10);
    const LOG_MAX = 500;
    const logBuf = [];
    const logListeners = new Set();
    let logChannel = null;

    // 🔴 구독자가 없는데도 뿌리면 **그 자체가 끊김의 원인**이 된다 (2026-11-20).
    //   100Hz 입력이면 수신·복사·생략 합쳐 초당 200건이고, postMessage 는 구조화 복제라
    //   같은 출처의 모든 문서로 복사된다. 메인 스레드가 밀려 릴레이 타이머까지 늦어졌다.
    //   → ① 다른 탭의 진단 창이 '살아있다'고 알려올 때만 내보낸다 (2초마다 갱신, 6초 만료)
    //      ② 건별이 아니라 100ms 단위로 **묶어서** 한 번만 보낸다 (200/s → 10/s)
    //   같은 문서 안의 진단 창은 logListeners 로 직접 받으므로 이 경로와 무관하다.
    const WATCH_TTL_MS = 6000;     // 이 시간 지나면 구독자가 없다고 본다
    const OUTBOX_MS = 100;         // 묶어 보내는 간격
    const OUTBOX_MAX = 300;        // 묶음 상한 (느린 수신 측이 밀려도 메모리를 지킨다)
    let watcherUntil = 0;
    let outbox = [];
    let outboxTimer = null;

    function flushOutbox() {
        outboxTimer = null;
        if (!outbox.length || !logChannel) { outbox = []; return; }
        const batch = outbox; outbox = [];
        try { logChannel.postMessage({ batch }); } catch (_) {}
    }

    try {
        if ('BroadcastChannel' in window) {
            logChannel = new BroadcastChannel('pulse_devlog');
            logChannel.onmessage = (e) => {
                const m = e && e.data;
                if (!m || m.watch !== 1) return;
                if (m.src === CTX_ID) return;            // 같은 문서의 진단 창은 셈에서 빼낸다
                watcherUntil = Date.now() + WATCH_TTL_MS;
            };
        }
    } catch (_) {}

    function devLog(dir, text, meta) {
        const ev = { ts: Date.now(), dir, text: String(text == null ? '' : text), meta: meta || '', src: CTX_ID };
        logBuf.push(ev);
        if (logBuf.length > LOG_MAX) logBuf.shift();
        for (const cb of logListeners) { try { cb(ev); } catch (_) {} }
        if (logChannel && ev.ts < watcherUntil) {
            outbox.push(ev);
            if (outbox.length > OUTBOX_MAX) outbox.shift();
            if (!outboxTimer) outboxTimer = setTimeout(flushOutbox, OUTBOX_MS);
        }
    }

    // ─── 간격 계측 ───────────────────────────────────────────
    // 인계서(2026-11-19) §5 가 요구한 숫자 — 도착 간격의 평균·최대·p95.
    // 작업자가 실기기를 한 번 돌리면 이 값이 나와야 한다. 콘솔로는 낼 방법이 없었다.
    // ⚠ 정렬이 들어가므로 notify 경로에서 부르지 않는다. 진단 창이 1초에 한 번 getTiming() 을 부른다.
    function mkStat(cap) {
        const buf = [];
        let i = 0;
        return {
            add(v) { if (buf.length < cap) buf.push(v); else { buf[i] = v; i = (i + 1) % cap; } },
            reset() { buf.length = 0; i = 0; },
            summary() {
                if (!buf.length) return null;
                const a = buf.slice().sort((x, y) => x - y);
                let sum = 0;
                for (let k = 0; k < a.length; k++) sum += a[k];
                return {
                    n:   a.length,
                    avg: sum / a.length,
                    max: a[a.length - 1],
                    p95: a[Math.min(a.length - 1, Math.floor(a.length * 0.95))],
                };
            },
        };
    }
    const STAT_CAP = 300;
    const rxGap    = mkStat(STAT_CAP);   // 기기 → 브라우저 도착 간격
    const relayGap = mkStat(STAT_CAP);   // 실제로 출력에 내보낸 간격
    const writeMs  = mkStat(STAT_CAP);   // 쓰기 1건이 끝나는 데 걸린 시간 (큐 대기 포함)

    /** 진단용 타이밍 요약. 간격에서 Hz 를 뽑아 같이 준다. */
    function getTiming() {
        const rx = rxGap.summary(), rl = relayGap.summary(), w = writeMs.summary();
        const hz = (x) => (x && x.avg > 0) ? 1000 / x.avg : 0;
        return {
            rx:    rx ? { n: rx.n, avg: rx.avg, max: rx.max, p95: rx.p95, hz: hz(rx) } : null,
            relay: rl ? { n: rl.n, avg: rl.avg, max: rl.max, p95: rl.p95, hz: hz(rl) } : null,
            write: w  ? { n: w.n,  avg: w.avg,  max: w.max,  p95: w.p95 } : null,
            pending: Object.keys(relayPend).length,
        };
    }

    // 릴레이 간격. 입력 기기가 초당 수십~수백 줄을 쏟으면 BLE 쓰기 큐가 무한정 밀린다.
    // 위치 프로토콜이라 **지나간 값은 의미가 없다** → 간격 안에서는 마지막 줄만 보낸다.
    // (axis_sender 가 UI 입력에 쓰는 것과 같은 원칙)
    //
    // ⚠ 20ms 는 **추측값**이다 — 기기의 실제 쓰기 속도와 아무 관계가 없다.
    //   쓰기가 20ms 보다 오래 걸리면 큐가 계속 쌓여 움직임이 점점 늦어진다(인계서 BLE-03).
    //   그래서 아래 relay/pumpRelay 는 **쓰기가 끝났는지**(writeInFlight)를 먼저 보고,
    //   20ms 는 그 위의 안전 하한으로만 쓴다. 기기가 빠르면 20ms 로, 느리면 기기 속도로 간다.
    const RELAY_MIN_MS = 20;
    // 쓰기가 끝나지 않아도 이 시간이 지나면 그냥 보낸다.
    // GATT 쓰기가 끝내 안 돌아오는 경우에 릴레이가 **영구히 멈추는 것**을 막는 안전장치다.
    // (예전에 write 를 기다리다 연결을 버리는 fail-closed 로 사고가 났다 — 아래 전송 주석 참고)
    const RELAY_STALL_MS = 300;
    let relayLastAt = 0, relayTimer = null, relayDropped = 0;
    let relayPendingSince = 0;

    // ⚠ 대기 줄은 **하나가 아니라 축별로** 들고 있어야 한다 (인계서 BLE-07).
    //   입력이 축마다 별도 줄로 오는지, 한 줄에 전 축이 오는지는 **기기·펌웨어마다 다르다.**
    //   '마지막 줄만' 남기면 축마다 따로 오는 기기에서 **다른 축의 최신값**이 버려져
    //   그 축이 멈춘 것처럼 보인다. 지나간 값을 버리는 것과 전혀 다른 문제다.
    //   아래 relayKey() 로 두 포맷을 **구분 없이** 옳게 처리한다.
    let relayPend = {};                  // 축 키 → 최신 줄 (문자열 키라 삽입 순서가 유지된다)
    const RELAY_PEND_MAX = 8;            // 축 수만큼만 쌓이는 게 정상. 넘으면 오래된 것부터 버린다

    // T-Code 축 토큰: L0 R1 V0 A2 … (뒤에 숫자가 붙는다)
    const AXIS_RE = /\b([LRVA][0-9])[0-9]/g;

    /**
     * 이 줄이 건드리는 축 목록 → 병합 키.
     *   L0500I100 R1800I100   → 'L0+R1'  전체 상태. 같은 조합이 또 오면 교체 (기존 동작과 같다)
     *   L0500I100 / R1800I100 → 'L0', 'R1'  서로 다른 축이라 **둘 다 보낸다**
     *   L0500I100 / L0600I100 → 같은 'L0'  → 교체 (맞는 동작)
     *   DSTOP, D1 …           → 축이 안 보인다. **제어 명령일 수 있으므로** 줄 자체를 키로 둔다
     *                           (서로 다른 명령이 서로를 덮어쓰지 않게)
     */
    function relayKey(line) {
        AXIS_RE.lastIndex = 0;
        const seen = [];
        let m;
        while ((m = AXIS_RE.exec(line)) !== null) {
            if (seen.indexOf(m[1]) < 0) seen.push(m[1]);
        }
        return seen.length ? seen.sort().join('+') : 'cmd:' + line;
    }

    function clearPend() { relayPend = {}; relayPendingSince = 0; }

	let bleWriteQueue = Promise.resolve();
	// 큐에 넣었지만 아직 끝나지 않은 쓰기 수. 릴레이 배압과 진단 창이 쓴다.
	let writeInFlight = 0;
	// 쓰기 **완료** 수. state.sentCount 는 큐에 넣은 수라 실제 전송 성공을 뜻하지 않는다(BLE-05).
	let writeOkCount = 0;

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
            sentCount:          state.sentCount,   // 큐에 **넣은** 수
            writeOk:            writeOkCount,       // 실제로 쓰기가 **끝난** 수
            writeErr:           writeErrCount,
            queued:             writeInFlight,      // 아직 끝나지 않은 쓰기 (쌓이면 기기가 느린 것)
            portLabel:          state.portLabel,
            deviceInfo:         state.deviceInfo,   // 기기 응답 (있으면 통신 정상 = baud 맞음)
            lastError:          state.lastError,
            input:              getInputStatus(),   // 입력 기기 요약 (헤더 UI가 같이 그린다)
        };
    }

    function getInputStatus() {
        return {
            connected: inState.connected,
            label:     inState.label,
            rxCount:   inState.rxCount,
            lastLine:  inState.lastLine,
            lastError: inState.lastError,
            relay:     relayOn,
            dropped:   relayDropped,
            queued:    writeInFlight,
            pending:   Object.keys(relayPend).length,
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
		const data = drv().encode(cmd);

		// Serial — 기존 동작 유지
		if (state.kind === 'serial' && state.writer) {
			writeInFlight++;
			const t0 = Date.now();
			state.writer.write(data)
				.then(() => { writeOkCount++; }, noteWriteError)
				.then(() => { writeInFlight--; writeMs.add(Date.now() - t0); });
			return true;
		}

		// Bluetooth — GATT write를 직렬화
		if (state.kind === 'bluetooth' && state.btChar) {
			const char = state.btChar;
			const wantNoResp = drv().ble.write !== 'withResponse';

			writeInFlight++;
			const t0 = Date.now();
			bleWriteQueue = bleWriteQueue
				.catch(() => {})
				.then(() => {
					if (wantNoResp && char.writeValueWithoutResponse) {
						return char.writeValueWithoutResponse(data);
					}
					return char.writeValue(data);
				})
				.then(() => { writeOkCount++; }, noteWriteError)
				// 큐 대기까지 포함한 '한 건이 끝나는 데 걸린 시간' — 이게 실제 전송 주기의 한계다
				.then(() => { writeInFlight--; writeMs.add(Date.now() - t0); });

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
        devLog('err', state.lastError, `${writeErrCount}건째`);
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
            //filters: [{ services: [ble.service] }],
			acceptAllDevices: true,
            optionalServices: [ble.service],
        });

        // 디바이스 끊김 감지
        device.addEventListener('gattserverdisconnected', () => {
            if (state.btDevice === device) {
                devLog('info', `출력 기기 끊김 — ${state.portLabel || 'BLE'}`, 'GATT 연결 해제');
                state.connected = false;
                state.kind = null;
                state.btChar = null;
                state.btDevice = null;
                state.portLabel = '';
                notify();
            }
        });

		console.time('[BLE] total');

		console.time('[BLE] gatt.connect');
		const server = await device.gatt.connect();
		console.timeEnd('[BLE] gatt.connect');

		console.time('[BLE] getPrimaryService');
		const service = await server.getPrimaryService(ble.service);
		console.timeEnd('[BLE] getPrimaryService');

		console.time('[BLE] getCharacteristic');
		const txChar = await service.getCharacteristic(ble.txChar);
		console.timeEnd('[BLE] getCharacteristic');

		console.timeEnd('[BLE] total');

        state.btDevice  = device;
        state.btChar    = txChar;
        state.kind      = 'bluetooth';
        state.connected = true;
        state.lastError = '';
        state.portLabel = `BLE · ${device.name || 'Unknown'}`;
        sendOffCount = 0;
        writeMs.reset();
        devLog('info', `출력 기기 연결 — ${state.portLabel} / tx ${txChar.uuid}`);
        sessionStorage.setItem(KEY_INTENT, 'bluetooth');
        notify();
        for (const c of drv().init) { await send(c); }
    }

    // ─── 입력 BLE 기기 (기기 → 브라우저, notify) ──────────────
    //
    // 왜 따로 있나: 폰 1대에 **남성용·여성용 기기를 동시에** 붙이고, 한쪽이 보내는 신호를
    //   다른 쪽으로 흘려주기 위한 것이다(2026-11-18 하드웨어 작업자 요청).
    //   Web Bluetooth 는 한 페이지에서 여러 기기와 GATT 연결을 유지할 수 있으므로
    //   출력 연결(state)은 그대로 두고 **두 번째 연결**을 만든다.

    /** 서비스 안에서 rx(notify) 캐릭터리스틱 찾기. 드라이버에 UUID 가 있으면 그것, 없으면 자동 탐색. */
    async function findRxChar(service, ble) {
        if (ble.rxChar) {
            return await service.getCharacteristic(ble.rxChar);
        }
        // UUID 를 모를 때 — 서비스의 캐릭터리스틱을 훑어 notify 되는 것을 쓴다.
        // 작업자가 UUID 를 확정할 수 있게 **전체 목록을 콘솔에 찍는다.**
        const list = await service.getCharacteristics();
        const dump = list.map((c) => {
            const p = c.properties || {};
            const f = ['read', 'write', 'writeWithoutResponse', 'notify', 'indicate']
                .filter((k) => p[k]).join(',');
            return `${c.uuid} [${f}]`;
        });
        console.log('[PulseDevice] 서비스 캐릭터리스틱 목록:\n  ' + dump.join('\n  '));
        dump.forEach((d) => devLog('info', d, '캐릭터리스틱'));
        const rx = list.find((c) => c.properties && (c.properties.notify || c.properties.indicate));
        if (!rx) throw new Error('이 기기에서 notify 되는 캐릭터리스틱을 찾지 못했습니다');
        console.log('[PulseDevice] 입력 캐릭터리스틱 자동 선택: ' + rx.uuid);
        return rx;
    }

    /**
     * 수신 바이트 → 줄 단위로 자른다.
     * ⚠ BLE notify 는 MTU(보통 20바이트) 단위로 쪼개져 온다. 한 줄이 여러 알림에 걸쳐 오거나
     *   한 알림에 여러 줄이 들어올 수 있다 → **버퍼에 모아 \n 기준으로 자르는 것이 필수**다.
     *   (줄바꿈이 끝내 안 오면 아무것도 내보내지 않는다. 버퍼만 상한으로 잘라 메모리를 지킨다)
     */
    function onRxValue(ev) {
        let text = '';
        try {
            const v = ev.target.value;                    // DataView
            text = new TextDecoder().decode(v);
        } catch (_) { return; }

        inState.buf += text;
        if (inState.buf.length > 512) inState.buf = inState.buf.slice(-512);

        let i;
        while ((i = inState.buf.search(/[\r\n]/)) >= 0) {
            const line = inState.buf.slice(0, i).trim();
            inState.buf = inState.buf.slice(i + 1);
            if (!line) continue;
            inState.rxCount++;
            inState.lastLine = line;
            const rxAt = Date.now();
            if (inState.lastRxAt) rxGap.add(rxAt - inState.lastRxAt);
            inState.lastRxAt = rxAt;
            for (const cb of inputListeners) { try { cb(line); } catch (_) {} }
            devLog('in', line);
            if (!relayOn) devLog('drop', line, '복사 꺼짐');
            else if (!state.connected) devLog('drop', line, '출력 미연결');
            relay(line);
            if (inState.rxCount <= 5) console.log('[PulseDevice] 입력 ← ' + line);
        }
        if (inState.rxCount % 10 === 0) notify();
    }

    /** 지금 보내도 되는가 — 쓰기가 끝났고(또는 너무 오래 기다렸고) 최소 간격도 지났는가. */
    function relayReady(now) {
        if (writeInFlight > 0 && (relayPendingSince === 0 || now - relayPendingSince < RELAY_STALL_MS)) {
            return false;                                  // 기기가 아직 앞 줄을 쓰는 중
        }
        return now - relayLastAt >= RELAY_MIN_MS;
    }

    /** 대기 줄에 넣는다 — **같은 축**의 옛 값만 버리고, 다른 축은 남긴다. */
    function putPend(line, why) {
        const key = relayKey(line);
        if (Object.prototype.hasOwnProperty.call(relayPend, key)) {
            relayDropped++;
            devLog('drop', relayPend[key], why);
        } else if (Object.keys(relayPend).length === 0) {
            relayPendingSince = Date.now();
        }
        relayPend[key] = line;

        // 상한 — 축 수를 넘게 쌓이면 뭔가 잘못된 것이다. 오래된 것부터 버린다.
        let keys = Object.keys(relayPend);
        while (keys.length > RELAY_PEND_MAX) {
            relayDropped++;
            devLog('drop', relayPend[keys[0]], '대기 상한');
            delete relayPend[keys[0]];
            keys = Object.keys(relayPend);
        }
    }

    /**
     * 대기 중인 축을 내보낸다 (들어온 순서대로).
     * @param onlyOne 기기가 아직 앞 쓰기를 못 끝냈는데 안전장치(STALL)로 억지로 내보내는 경우.
     *   이때 **전부** 쏟으면 막힌 큐에 한꺼번에 밀어넣어 배압이 무의미해진다 → 한 줄만 보낸다.
     *   기기가 정상이면(writeInFlight 0) 축 전체를 같이 보내야 한다 — 축마다 따로 오는 입력에서
     *   한 줄만 보내면 다른 축이 매번 한 박자씩 밀린다.
     */
    function flushPend(now, onlyOne) {
        const keys = Object.keys(relayPend);
        const lines = [];
        const take = onlyOne ? Math.min(1, keys.length) : keys.length;
        for (let i = 0; i < take; i++) { lines.push(relayPend[keys[i]]); delete relayPend[keys[i]]; }
        if (Object.keys(relayPend).length) {
            relayPendingSince = now;                 // 남은 축은 다음 차례에
            if (!relayTimer) relayTimer = setTimeout(pumpRelay, 5);
        } else {
            clearPend();
        }
        if (relayLastAt) relayGap.add(now - relayLastAt);
        relayLastAt = now;
        for (let i = 0; i < lines.length; i++) send(lines[i], 'relay');
    }

    /** 내보낼 때가 됐는지 보고, 아직이면 다시 들여다본다. */
    function pumpRelay() {
        relayTimer = null;
        if (Object.keys(relayPend).length === 0) { relayPendingSince = 0; return; }
        if (!relayOn || !state.connected) { clearPend(); return; }

        const now = Date.now();
        if (!relayReady(now)) { relayTimer = setTimeout(pumpRelay, 5); return; }
        flushPend(now, writeInFlight > 0);
    }

    /** 입력 → 출력 복사. 내용은 **그대로** 보내되, 보내는 때만 조절한다. */
    function relay(line) {
        if (!relayOn || !state.connected) return;
        const now = Date.now();

        // 🔴 대기 타이머가 살아있는 채로 새 줄을 보내면 **지나간 줄이 뒤에 나간다**(위치 역전).
        //   인계서 BLE-02. 타이머는 relayLastAt+20ms 에 발화하도록 예약되지만 메인 스레드가
        //   밀리면 그 시점을 넘겨서 발화한다. 그 사이 새 줄이 즉시 송신되면 출력 기기가
        //   새 위치로 갔다가 **옛 위치로 되돌아간다** — 이게 덜컥거림으로 보였다.
        //   → 새 줄도 일단 대기 줄에 넣고, 보낼 수 있으면 **타이머를 끄고 한꺼번에** 내보낸다.
        //     이러면 역전이 구조적으로 불가능하고, 다른 축도 버려지지 않는다.
        putPend(line, relayReady(now) ? '새 값으로 대체'
                    : (writeInFlight > 0 ? '기기 쓰기 대기' : '간격 제한'));

        if (relayReady(now)) {
            if (relayTimer) { clearTimeout(relayTimer); relayTimer = null; }
            flushPend(now, writeInFlight > 0);
            return;
        }
        if (!relayTimer) relayTimer = setTimeout(pumpRelay, 5);
    }

    async function connectBluetoothInput() {
        if (!('bluetooth' in navigator)) {
            throw new Error('Web Bluetooth 미지원 (Chrome Android, Chrome/Edge 데스크탑 필요)');
        }
        if (inState.connected) return;

        const ble = drv().ble;
        const device = await navigator.bluetooth.requestDevice({
            acceptAllDevices: true,
            optionalServices: [ble.service],
        });

        // ⚠ 출력과 **같은 기기**를 입력으로 붙이면 보낸 값이 그대로 되돌아와 무한 반복이 된다.
        //   (물리 액추에이터라 실제로 위험하다) 요청 자체가 '2대 연결' 이므로 막는다.
        if (state.btDevice && device.id && state.btDevice.id === device.id) {
            throw new Error('출력 기기와 같은 기기입니다. 입력은 다른 기기를 선택하세요');
        }

        device.addEventListener('gattserverdisconnected', () => {
            if (inState.device === device) resetInput('연결이 끊겼습니다');
        });

        const server  = await device.gatt.connect();
        const service = await server.getPrimaryService(ble.service);
        const rxChar  = await findRxChar(service, ble);

        await rxChar.startNotifications();
        rxChar.addEventListener('characteristicvaluechanged', onRxValue);

        inState.device    = device;
        inState.rxChar    = rxChar;
        inState.connected = true;
        inState.label     = `BLE · ${device.name || 'Unknown'}`;
        inState.lastError = '';
        inState.buf       = '';
        // ⚠ 통계는 **이번 연결 기준**으로 센다. 이전 세션 누적이 섞이면 생략률을 읽을 수 없다
        //   ("생략 1,000회"가 지금 것인지 어제 것인지 구분이 안 됐다 — 인계서 BLE-04)
        inState.rxCount   = 0;
        inState.lastLine  = '';
        inState.lastRxAt  = 0;
        relayDropped      = 0;
        relayLastAt       = 0;
        clearPend();
        rxGap.reset();
        relayGap.reset();
        if (relayTimer) { clearTimeout(relayTimer); relayTimer = null; }
        devLog('info', `입력 기기 연결 — ${inState.label} / rx ${rxChar.uuid}`);
        notify();
    }

    function resetInput(err) {
        if (relayTimer) { clearTimeout(relayTimer); relayTimer = null; }
        clearPend();
        inState.device = null;
        inState.rxChar = null;
        inState.connected = false;
        inState.label = '';
        inState.buf = '';
        inState.lastError = err || '';
        devLog('info', '입력 기기 해제' + (err ? ' — ' + err : ''));
        notify();
    }

    async function disconnectInput() {
        try {
            if (inState.rxChar) {
                inState.rxChar.removeEventListener('characteristicvaluechanged', onRxValue);
                await bounded(inState.rxChar.stopNotifications(), 500);
            }
            if (inState.device && inState.device.gatt && inState.device.gatt.connected) {
                try { inState.device.gatt.disconnect(); } catch (_) {}
            }
        } finally {
            resetInput('');
        }
    }

    function setRelay(on) {
        relayOn = !!on;
        if (!relayOn && relayTimer) {
            clearTimeout(relayTimer); relayTimer = null;
            clearPend();
        }
        notify();
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
                    // ⚠⚠ **여기서 writer.abort()를 부르면 안 된다.**
                    //   연결 후 시간이 조금만 지나면 이 포트에서 abort()가 **영영 안 끝나고**,
                    //   그 뒤 close()까지 같이 매달려 포트가 OS에 열린 채 남는다.
                    //   한번 그렇게 되면 재시도도 안 된다 ("close() is already in progress").
                    //
                    //   2026-08-28 실기기 계측 (CP210x, MiraPlay-Lite 펌웨어):
                    //     연결 직후          → abort settled @0ms
                    //     유휴 20초 뒤       → abort TIMEOUT @5000ms, 이어서 close TIMEOUT @8000ms
                    //     abort 빼고 releaseLock만 → close settled @2ms  ✅
                    //   순수 Web Serial(우리 코드 없이)로도 그대로 재현된다 — 우리 버그가 아니라
                    //   이 조합에서의 브라우저/드라이버 동작이다. 그래서 **피해 가는 것이 유일한 대응**이다.
                    //
                    //   잠금만 풀어주면 된다. close()가 어차피 writable을 abort하고
                    //   readable을 cancel한다 (Web Serial 명세).
                    try { state.writer.releaseLock(); } catch (_) {}
                }
                // 읽기 스트림 먼저 정리해야 port.close()가 걸리지 않음
                if (state.reader) {
                    try { await state.reader.cancel(); } catch (_) {}
                    try { state.reader.releaseLock(); } catch (_) {}
                }
                if (state.readDone) { await bounded(state.readDone, 300); }
                if (state.port) {
                    await bounded(state.port.close(), 1500);
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
            writeOkCount = 0;
            writeErrCount = 0;
            sendOffCount = 0;
            writeMs.reset();
            devLog('info', '출력 기기 해제' + (leftOpen ? ' — 포트를 닫지 못했다' : ''));
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
    // src: 'relay' 면 입력 기기에서 복사된 것 — 진단 창에서 구분해 보여준다.
    // §7 '스크롤 멈춤' 미해결 건 — 연결이 끊긴 뒤에도 엔진이 명령을 계속 만든다.
    // 재발 시 이 줄이 있으면 "연결이 먼저 끊겼는가"를 로그만으로 판별할 수 있다.
    let sendOffCount = 0;
    function send(cmd, src) {
		if (!state.connected) {
			sendOffCount++;
			if (sendOffCount === 1 || sendOffCount % 100 === 0) {
				devLog('drop', cmd, `출력 미연결 (${sendOffCount}건째)`);
			}
			return false;
		}
		if (!writeOnce(cmd)) return false;

		state.sentCount++;
		devLog(src === 'relay' ? 'relay' : 'out', cmd);
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
            devLog('reject', line.slice(0, 80), '원격 명령 검증 실패');
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

    // 화면이 숨으면 브라우저가 타이머를 늦춘다 — 릴레이·재생 루프가 밀리는 원인이 된다.
    // §7 '스크롤 멈춤' 재발 시 이 줄이 증상 시각과 겹치는지 보면 된다.
    try {
        if (typeof document !== 'undefined' && document.addEventListener) {
            document.addEventListener('visibilitychange', () => {
                devLog('info', document.hidden ? '화면 숨김 (탭 비활성)' : '화면 표시',
                       '숨으면 브라우저가 타이머를 늦출 수 있다');
            });
        }
    } catch (_) {}

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
        // 입력 기기 (BLE notify → 출력으로 복사)
        connectBluetoothInput,
        disconnectInput,
        setRelay,
        getInputStatus,
        get inputConnected() { return inState.connected; },
        onInput(cb) { inputListeners.add(cb); return () => inputListeners.delete(cb); },
        // 진단 로그 (개발자용 창이 쓴다)
        onLog(cb) { logListeners.add(cb); return () => logListeners.delete(cb); },
        getTiming,                                // 도착 간격·전송 간격·쓰기 소요 (진단 창이 1초마다)
        getLog() { return logBuf.slice(); },
        ctxId: CTX_ID,
        clearLog() { logBuf.length = 0; },
        devLog,                                   // 외부(페이지)에서도 한 줄기에 적을 수 있게
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
