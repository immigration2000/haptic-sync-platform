/**
 * 축 제어 공용 모듈 — 슬라이더·키보드 → 명령 송신, 원격 명령 수신 → 기기.
 *
 * 왜 하나로 모았나:
 *   방송(1:N)과 통화(1:1)의 하드웨어 제어는 **"여러 명에게 뿌리느냐"만 달라야 한다.**
 *   그런데 슬라이더 바인딩·키 매핑·명령 조립·수신 검증이 페이지마다 복사돼 있었다
 *   (broadcast.js / bj_console.js / bj_call.js / watch.js). 키 매핑은 세 파일에 글자 하나 안 다르게
 *   있었고, 속도 제한은 새로 만든 곳에만 있었다. 하나를 고치면 셋을 찾아 고쳐야 했다.
 *   → 여기에 한 번만 두고, 각 페이지는 **전송로(send)와 게이트(gate)만** 넘긴다.
 *
 * 송신 속도 제한 (createSender):
 *   슬라이더 `input` 은 드래그 중 초당 60회 넘게 온다. 그대로 기기에 쓰면 MiraBot(CP210x)이
 *   포트에서 사라지고 재연결이 안 되는 P0 가 난다. 노트북 Codex 가 데스크톱 앱에서 실기기로
 *   재현·수정했다 (haptic-relay-desktop 997e4de):
 *     ① 33.3ms(30Hz) 간격으로 **마지막 값만** 보낸다 (latest-value 병합)
 *     ② 한 tick 에 움직일 수 있는 거리를 제한한다 (slew, 정규화 초당 2.0 = 200 pos/s)
 *   같은 하드웨어를 쓰므로 검증된 수치를 그대로 쓴다. 새로 발명하지 않는다.
 *
 * 사용:
 *   // 송신 쪽 (방송자·콘솔·통화 사용자)
 *   const ctl = PulseAxisControl.bind({
 *       axes: { L0: { el, val }, R0: {...}, R2: {...} },   // slider 요소와 값 표시 요소
 *       interpEl, interpVal,                                 // 보간 슬라이더와 값 표시 (선택)
 *       send: (line) => peer.send(line),                     // ★ 페이지마다 다른 유일한 부분
 *       enabled: () => broadcasting,                         // false 면 키 입력 무시 (선택)
 *   });
 *   ctl.stop();                                              // 페이지 떠날 때
 *
 *   // 수신 쪽 (시청자·통화 사용자·콘솔)
 *   const n = PulseAxisControl.receive(line, {
 *       gate: () => mode === 'call' || ctrl === 'manual',  // 통화만 있는 조건 (선택)
 *       onCount: (n) => recvCount += n,
 *   });
 *
 * 출력 형식은 한 가지: `L072I100`, 다축이면 공백으로 이어붙여 한 줄.
 */
(function () {
    const TICK_MS    = 33.3;    // 30Hz — 데스크톱 앱과 같은 값
    const SLEW_PER_S = 200;     // pos 단위/초. 정규화 2.0/s × 100
    const KEY_STEP   = 5;

    /** 키보드 매핑 — 방송·콘솔·통화 사용자 화면이 전부 같은 배치를 쓴다 */
    const KEYS = {
        ArrowUp:   ['L0', +KEY_STEP], ArrowDown:  ['L0', -KEY_STEP],
        ArrowLeft: ['R0', -KEY_STEP], ArrowRight: ['R0', +KEY_STEP],
        KeyW:      ['R2', +KEY_STEP], KeyS:       ['R2', -KEY_STEP],
    };

    const clamp99 = (v) => Math.max(0, Math.min(99, v));
    const token   = (axis, pos, interp) => `${axis}${String(pos).padStart(2, '0')}I${interp}`;

    // ── 송신기: 병합 + slew ───────────────────────────────────
    function createSender(opts) {
        const send = opts && opts.send;
        if (typeof send !== 'function') throw new Error('PulseAxisControl: send 함수가 필요합니다');
        const slewPerS = (opts && opts.slewPerS) || SLEW_PER_S;
        let interp = (opts && opts.interp) || 100;

        const target = {};          // axis → 목표 pos (마지막 값만 남는다)
        const current = {};         // axis → 마지막으로 보낸 pos
        let timer = null, lastTick = 0, sentCount = 0;

        function tick() {
            const now = performance.now();
            const dt = lastTick ? (now - lastTick) / 1000 : TICK_MS / 1000;
            lastTick = now;
            const maxStep = Math.max(1, slewPerS * dt);

            const tokens = [];
            for (const axis of Object.keys(target)) {
                const want = target[axis];
                const have = (axis in current) ? current[axis] : want;   // 첫 값은 바로
                if (have === want && axis in current) continue;
                let next = want;
                const d = want - have;
                if (Math.abs(d) > maxStep) next = have + Math.sign(d) * maxStep;
                next = Math.round(clamp99(next));
                current[axis] = next;
                tokens.push(token(axis, next, interp));
            }
            if (!tokens.length) return;
            try { send(tokens.join(' ')); sentCount++; } catch (_) {}
        }
        function ensureTimer() { if (!timer) { lastTick = 0; timer = setInterval(tick, TICK_MS); } }

        return {
            set(axis, pos) {
                const p = Math.round(Number(pos));
                if (isNaN(p)) return;
                target[axis] = clamp99(p);
                ensureTimer();
            },
            setInterp(ms) { const v = parseInt(ms, 10); if (!isNaN(v) && v > 0) interp = v; },
            get interp() { return interp; },
            stop() {
                if (timer) { clearInterval(timer); timer = null; }
                for (const k of Object.keys(target)) delete target[k];
                for (const k of Object.keys(current)) delete current[k];
            },
            get sentCount() { return sentCount; },
        };
    }

    // ── 슬라이더·키보드 바인딩 ────────────────────────────────
    function bind(opts) {
        const axes = (opts && opts.axes) || {};
        const sender = createSender({
            send: opts.send,
            interp: opts.interpEl ? parseInt(opts.interpEl.value, 10) : (opts.interp || 100),
            slewPerS: opts.slewPerS,
        });
        const enabled = typeof opts.enabled === 'function' ? opts.enabled : () => true;
        const ignoreTags = ['INPUT', 'SELECT', 'TEXTAREA'];

        function setAxis(k, v) {
            const a = axes[k]; if (!a || !a.el) return;
            v = clamp99(parseInt(v, 10));
            a.el.value = v;
            if (a.val) a.val.textContent = v;
            sender.set(k, v);
        }
        for (const k of Object.keys(axes)) {
            const a = axes[k]; if (!a || !a.el) continue;
            a.el.addEventListener('input', () => setAxis(k, a.el.value));
        }
        if (opts.interpEl) {
            opts.interpEl.addEventListener('input', () => {
                sender.setInterp(opts.interpEl.value);
                if (opts.interpVal) opts.interpVal.textContent = sender.interp;
            });
        }
        const onKey = (e) => {
            if (!enabled()) return;
            const ae = document.activeElement;
            if (ae && ignoreTags.includes(ae.tagName)) return;
            const m = KEYS[e.code]; if (!m) return;
            const a = axes[m[0]]; if (!a || !a.el) return;
            e.preventDefault();
            setAxis(m[0], parseInt(a.el.value, 10) + m[1]);
        };
        document.addEventListener('keydown', onKey);

        return {
            sender,
            set: setAxis,
            stop() { document.removeEventListener('keydown', onKey); sender.stop(); },
        };
    }

    // ── 수신: 검증 → 기기 ────────────────────────────────────
    // 원격 입력은 반드시 PulseDevice.sendRemote 로 검증한다 (축 명령만, 최대 6토큰).
    // 게이트는 페이지가 넘긴다 — 통화의 mode/ctrl, 콘솔의 '사용자 제어 허용' 같은 것.
    const AXIS_LINE = /^[LR][0-9]/;
    function receive(line, opts) {
        const text = String(line == null ? '' : line).trim();
        if (!AXIS_LINE.test(text)) return 0;
        if (opts && typeof opts.gate === 'function' && !opts.gate()) return 0;
        const D = window.PulseDevice;
        if (!D || !D.isConnected) return 0;
        const n = D.sendRemote(text);
        if (n && opts && typeof opts.onCount === 'function') opts.onCount(n);
        return n;
    }

    window.PulseAxisControl = { KEYS, createSender, bind, receive, token, TICK_MS, SLEW_PER_S };
})();
