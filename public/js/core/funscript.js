/* PULSE Multi-axis Funscript Engine
 * 다축 funscript (.funscript / .roll.funscript / .pitch.funscript) 로딩·동기·송신 공통 모듈
 *
 * TCode 매핑:
 *   메인 (.funscript)         → L0 (스트로크)
 *   .roll.funscript           → R0 (롤/트위스트)
 *   .pitch.funscript          → R2 (피치)
 *   .surge.funscript          → L1 (옵션)
 *   .sway.funscript           → L2 (옵션)
 *   .twist.funscript          → R1 (옵션, .roll의 별칭)
 */
(function () {
    const AXIS_DEFS = [
        { ext: '',         tcode: 'L0' },
        { ext: '.roll',    tcode: 'R0' },
        { ext: '.twist',   tcode: 'R1' },
        { ext: '.pitch',   tcode: 'R2' },
        { ext: '.surge',   tcode: 'L1' },
        { ext: '.sway',    tcode: 'L2' },
    ];

    // 경로에서 확장자 분리: "/vrs/vr_x.funscript" → ["/vrs/vr_x", ".funscript"]
    function splitFunscriptPath(p) {
        const m = p.match(/^(.+?)(\.funscript|\.json)$/);
        return m ? { base: m[1], ext: m[2] } : { base: p, ext: '.funscript' };
    }

    async function tryFetch(url) {
        try {
            const r = await fetch(url);
            if (!r.ok) return null;
            const j = await r.json();
            const acts = (j.actions || []).slice().sort((a, b) => a.at - b.at);
            return acts.length ? acts : null;
        } catch (_) {
            return null;
        }
    }

    // 메인 경로 하나로 모든 축 자동 탐색
    async function loadMultiAxis(mainPath) {
        const { base, ext } = splitFunscriptPath(mainPath);
        const axes = {};
        await Promise.all(AXIS_DEFS.map(async (def) => {
            const url = base + def.ext + ext;
            const acts = await tryFetch(url);
            if (!acts) return;
            // 스크립트가 실제로 쓰는 진폭을 재둔다. 이걸 알아야 "원본이 좁아서 안 움직이는 것"과
            // "사용자가 강도를 줄인 것"을 구분할 수 있고, 좁은 스크립트를 넓게 펴줄 수 있다.
            let lo = 100, hi = 0;
            for (const a of acts) {
                const v = Math.max(0, Math.min(100, Number(a.pos) || 0));
                if (v < lo) lo = v;
                if (v > hi) hi = v;
            }
            axes[def.tcode] = { actions: acts, index: 0, url, lo, hi, span: hi - lo };
        }));
        return axes;
    }

    // 강도 슬라이더 범위(%). 관리자가 설정으로 조정한다 (layout이 window.PULSE_TUNING 으로 심는다).
    // 0% = 원본 그대로. 음수는 진폭 축소, 양수는 확대.
    const GAIN_MIN_DEFAULT = -80, GAIN_MAX_DEFAULT = 80;
    function gainRange() {
        const t = window.PULSE_TUNING || {};
        let lo = parseFloat(t.gainMin), hi = parseFloat(t.gainMax);
        if (isNaN(lo)) lo = GAIN_MIN_DEFAULT;
        if (isNaN(hi)) hi = GAIN_MAX_DEFAULT;
        if (hi < lo) { const x = lo; lo = hi; hi = x; }
        return { min: lo, max: hi };
    }

    // 타이머 루프 주기(ms). 화면이 가려져 rAF가 멈춘 동안의 예비 경로다.
    // ⚠ 브라우저는 숨겨진 탭의 타이머를 1초 이상으로 늦춘다(오디오 재생 중이면 완화).
    //   즉 백그라운드에서는 정밀도가 떨어진다 — 완전히 멈추는 것보다 낫다는 수준이다.
    const TIMER_MS = 40;

    // 진폭이 이보다 좁으면 '펴기'를 하지 않는다.
    // 거의 정지된 스크립트를 억지로 늘리면 미세한 흔들림이 풀스트로크로 증폭돼 위험하다.
    const MIN_EXPAND_SPAN = 10;

    /**
     * 스크립트 위치(0~100) → 실제 출력 위치
     *
     *   center = (최소 + 최대) / 2        ← 최소·최대는 '움직임의 중심'을 정한다
     *   out    = center + (pos - 50) * (1 + gain)
     *   → [최소, 최대] 클램프 → [0, 99]
     *
     * - `pos`는 50을 중립으로 보는 편차로 해석한다. 기본값(0~100 · 강도 0%)이면
     *   center = 50, 배율 1 → **out = pos** 즉 스크립트 원본 그대로다.
     * - 강도는 그 중심을 기준으로 편차를 키우거나(+) 줄인다(−). 0% = 1배.
     * - 자동 확장이 꺼져 있으면 강도를 쓰지 않는다(배율 1). 중심 이동만 적용된다.
     * - `interp`(이동시간)는 절대 건드리지 않는다.
     */
    function shapeStroke(pos, ax, shape, intensity) {
        if (!shape) return Math.round(50 + (pos - 50) * intensity);   // 구버전 호출부 호환

        const outMin = Math.max(0, Math.min(100, shape.outMin));
        const outMax = Math.max(outMin, Math.min(100, shape.outMax));
        const center = (outMin + outMax) / 2;
        const gain   = shape.expand ? (shape.gain == null ? 0 : shape.gain) : 0;

        const out = center + (pos - 50) * (1 + gain);
        return Math.round(Math.max(outMin, Math.min(outMax, out)));
    }

    /**
     * MultiAxisEngine
     *   - 영상 currentTime 기반 다축 funscript 동기
     *   - 각 축의 다음 키프레임 도달 시 onCommand 콜백 호출
     *   - sendOnce(true): 한 tick에 여러 축이 동시 트리거되면 단일 TCode 라인으로 합쳐 송신
     */
    class MultiAxisEngine {
        constructor({ video, axes, onCommand, intensityGetter, shapeGetter, sendOnce = true }) {
            this.video = video;
            this.axes  = axes;             // { L0: {actions, index}, R0: {...}, ... }
            this.onCommand = onCommand;    // (tcodeStr, perAxisDetails[]) => void
            this.getIntensity = intensityGetter || (() => 1);
            // 출력 성형 설정. 없으면 기존 동작과 완전히 동일하게 둔다.
            //   outMin/outMax : 장치가 실제로 오갈 범위 (0~100)
            //   gain          : 그 범위 안에서의 진폭 배율 (강도)
            //   expand        : 스크립트 자체 진폭을 outMin~outMax로 펴줄지
            this.getShape = shapeGetter || null;
            this.sendOnce = sendOnce;
            this._running = false;
            this._lastMs = -1;
        }

        start() {
            if (this._running) return;
            this._running = true;

            // rAF는 화면이 보일 때만 부드럽지만, **페이지가 렌더링되지 않으면 아예 멈춘다**
            // (다른 탭·최소화·화면 꺼짐 등). 그동안 영상은 계속 재생되므로
            // 엔진만 멈춰 기기가 죽은 것처럼 보인다. 그래서 타이머 루프를 함께 돌린다.
            // 두 경로가 같은 _tick()을 불러도 안전하다 — 인덱스가 이미 지나가면 아무것도 안 보낸다.
            const tick = () => {
                if (!this._running) return;
                this._tick();
                requestAnimationFrame(tick);
            };
            requestAnimationFrame(tick);
            this._timer = setInterval(() => { if (this._running) this._tick(); }, TIMER_MS);

            // 화면으로 돌아오면 인덱스를 현재 재생시간에 맞춰 다시 잡는다 (밀린 것 몰아보내기 방지)
            this._onVis = () => { if (!document.hidden) this.resync(); };
            document.addEventListener('visibilitychange', this._onVis);
        }

        stop() {
            this._running = false;
            if (this._timer) { clearInterval(this._timer); this._timer = null; }
            if (this._onVis) { document.removeEventListener('visibilitychange', this._onVis); this._onVis = null; }
        }

        resync() {
            const ms = this.video.currentTime * 1000;
            for (const k of Object.keys(this.axes)) {
                const ax = this.axes[k];
                ax.index = 0;
                for (let i = 0; i < ax.actions.length - 1; i++) {
                    if (ms > ax.actions[i].at) ax.index++;
                    else break;
                }
            }
        }

        _tick() {
            if (this.video.paused || this.video.ended) return;
            const ms = this.video.currentTime * 1000;
            if (ms < this._lastMs - 1000) {
                // 큰 되감기 — 인덱스 재계산
                this.resync();
            }
            this._lastMs = ms;

            const intensity = this.getIntensity();
            const shape = this.getShape ? this.getShape() : null;
            const triggered = [];   // 이번 tick에서 트리거된 축

            for (const k of Object.keys(this.axes)) {
                const ax = this.axes[k];
                // ⚠ 한 tick에서 같은 축의 키프레임이 여러 개 지나갈 수 있다.
                //   (탭이 가려져 rAF가 멈췄다가 돌아온 경우 수십 개가 한꺼번에 밀린다)
                //   예전에는 그걸 전부 triggered에 넣어 한 줄로 합쳐 보냈다 →
                //   'L090I250 L010I250 …' 처럼 같은 축이 반복되는 수백 자 명령이 나가고,
                //   릴레이 64자 제한에 잘리거나 원격 검증기(토큰 6개)에서 통째로 거부됐다.
                //   위치 기반 프로토콜이라 **지나간 목표는 의미가 없다** → 축마다 마지막 것만 보낸다.
                let latest = null, skipped = 0;
                while (ax.index < ax.actions.length - 1 && ms > ax.actions[ax.index].at) {
                    const cur  = ax.actions[ax.index];
                    const next = ax.actions[ax.index + 1];
                    const interp = Math.max(1, next.at - cur.at);
                    // 출력 성형 (L0만 — 회전축은 그대로)
                    const isStroke = (k === 'L0');
                    const scaled = isStroke
                        ? shapeStroke(next.pos, ax, shape, intensity)
                        : next.pos;
                    const pos = Math.max(0, Math.min(99, scaled));
                    if (latest) skipped++;
                    latest = { axis: k, pos, interp, atMs: next.at, skipped: 0 };
                    ax.index++;
                }
                if (latest) {
                    // 많이 밀렸으면 원래 보간시간(수십 ms)으로 튀지 않게 최소 이동시간을 준다
                    if (skipped > 0) latest.interp = Math.max(latest.interp, 120);

                    latest.skipped = skipped;
                    triggered.push(latest);
                }
            }

            if (!triggered.length) return;

            if (this.sendOnce) {
                // 한 라인에 다축 동시 송신: "L065I100 R055I100 R260I100"
                const cmd = triggered
                    .map(t => `${t.axis}${t.pos.toString().padStart(2, '0')}I${t.interp}`)
                    .join(' ');
                this.onCommand(cmd, triggered);
            } else {
                for (const t of triggered) {
                    const cmd = `${t.axis}${t.pos.toString().padStart(2, '0')}I${t.interp}`;
                    this.onCommand(cmd, [t]);
                }
            }
        }
    }

    window.PulseFunscript = {
        loadMultiAxis,
        MultiAxisEngine,
        // UI 미리보기가 엔진과 **같은 계산**을 쓰도록 노출한다.
        // 따로 구현하면 공식이 바뀔 때 미리보기만 조용히 어긋난다.
        shapeStroke,
        MIN_EXPAND_SPAN,
        gainRange,                // 관리자가 정한 강도 범위 (%)
        splitFunscriptPath,
        AXIS_DEFS,
    };
})();
