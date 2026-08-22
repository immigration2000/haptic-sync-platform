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

    // 진폭이 이보다 좁으면 '펴기'를 하지 않는다.
    // 거의 정지된 스크립트를 억지로 늘리면 미세한 흔들림이 풀스트로크로 증폭돼 위험하다.
    const MIN_EXPAND_SPAN = 10;

    /**
     * 스크립트 위치(0~100) → 실제 출력 위치
     *   shape 없으면 기존 동작 그대로: 50 + (pos-50) * intensity
     */
    function shapeStroke(pos, ax, shape, intensity) {
        if (!shape) return Math.round(50 + (pos - 50) * intensity);

        const outMin = Math.max(0, Math.min(100, shape.outMin));
        const outMax = Math.max(outMin, Math.min(100, shape.outMax));
        const gain   = shape.gain == null ? 1 : shape.gain;

        // 1) 0~1 정규화. 펴기가 켜져 있고 스크립트 진폭이 충분하면 그 진폭 기준으로,
        //    아니면 원본 스케일(0~100) 그대로.
        const canExpand = shape.expand && ax && ax.span >= MIN_EXPAND_SPAN;
        const norm = canExpand ? (pos - ax.lo) / ax.span : pos / 100;

        // 2) 사용자 출력 범위로 매핑 + 강도 배율
        const center = (outMin + outMax) / 2;
        const out = center + (norm - 0.5) * (outMax - outMin) * gain;

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
            const tick = () => {
                if (!this._running) return;
                this._tick();
                requestAnimationFrame(tick);
            };
            requestAnimationFrame(tick);
        }

        stop() { this._running = false; }

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
                    triggered.push({ axis: k, pos, interp, atMs: next.at });
                    ax.index++;
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
        splitFunscriptPath,
        AXIS_DEFS,
    };
})();
