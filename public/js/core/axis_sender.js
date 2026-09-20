/**
 * 축 명령 송신기 — 슬라이더·키 입력을 기기가 감당할 수 있는 속도로 내보낸다.
 *
 * 왜 필요한가:
 *   슬라이더 `input` 이벤트는 드래그 중 초당 60회 넘게 온다. 그걸 그대로 기기에 쓰면
 *   MiraBot(CP210x)이 포트에서 사라지고 재연결이 안 되는 P0가 난다.
 *   노트북 Codex가 데스크톱 앱에서 실기기로 재현·수정했다 (haptic-relay-desktop 997e4de):
 *     ① 33.3ms(30Hz) 간격으로 **마지막 값만** 보낸다 (latest-value 병합)
 *     ② 한 tick 에 움직일 수 있는 거리를 제한한다 (slew, 정규화 기준 초당 2.0 = 200 pos/s)
 *   같은 하드웨어를 쓰므로 검증된 수치를 그대로 가져온다. 새로 발명하지 않는다.
 *
 * 사용:
 *   const tx = PulseAxisSender.create({ send: (line) => peer.send(line) });
 *   tx.set('L0', 72);        // 목표만 갱신. 실제 전송은 tick 이 한다.
 *   tx.setInterp(100);
 *   tx.stop();               // 페이지 떠날 때
 *
 * 출력 형식은 콘솔·방송과 같다: `L072I100` (다축이면 공백으로 이어붙여 한 줄).
 */
(function () {
    const TICK_MS  = 33.3;     // 30Hz — 데스크톱 앱과 같은 값
    const SLEW_PER_S = 200;    // pos 단위/초. 정규화 2.0/s × 100

    function create(opts) {
        const send = opts && opts.send;
        if (typeof send !== 'function') throw new Error('PulseAxisSender: send 함수가 필요합니다');
        const slewPerS = (opts && opts.slewPerS) || SLEW_PER_S;
        let interp = (opts && opts.interp) || 100;

        const target = {};          // axis → 목표 pos (마지막 값만 남는다)
        const current = {};         // axis → 마지막으로 보낸 pos
        let timer = null, lastTick = 0, sentCount = 0;

        function tick() {
            const now = performance.now();
            const dt = lastTick ? (now - lastTick) / 1000 : TICK_MS / 1000;
            lastTick = now;
            const maxStep = Math.max(1, slewPerS * dt);   // 이번 tick 에 허용되는 최대 이동

            const tokens = [];
            for (const axis of Object.keys(target)) {
                const want = target[axis];
                const have = (axis in current) ? current[axis] : want;   // 첫 값은 바로
                if (have === want && axis in current) continue;           // 변화 없음
                let next = want;
                const d = want - have;
                if (Math.abs(d) > maxStep) next = have + Math.sign(d) * maxStep;   // slew 제한
                next = Math.round(Math.max(0, Math.min(99, next)));
                current[axis] = next;
                tokens.push(`${axis}${String(next).padStart(2, '0')}I${interp}`);
            }
            if (!tokens.length) return;
            try { send(tokens.join(' ')); sentCount++; } catch (_) {}
        }

        function ensureTimer() {
            if (timer) return;
            lastTick = 0;
            timer = setInterval(tick, TICK_MS);
        }

        return {
            /** 목표 위치만 갱신한다. 전송은 다음 tick 에. */
            set(axis, pos) {
                const p = Math.round(Number(pos));
                if (isNaN(p)) return;
                target[axis] = Math.max(0, Math.min(99, p));
                ensureTimer();
            },
            setInterp(ms) { const v = parseInt(ms, 10); if (!isNaN(v) && v > 0) interp = v; },
            /** 안전 위치로 보내고 멈춘다 */
            stop() {
                if (timer) { clearInterval(timer); timer = null; }
                for (const k of Object.keys(target)) delete target[k];
                for (const k of Object.keys(current)) delete current[k];
            },
            get sentCount() { return sentCount; },
        };
    }

    window.PulseAxisSender = { create, TICK_MS, SLEW_PER_S };
})();
