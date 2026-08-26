/* Content player — 영상 + funscript 다축 + 디바이스 송신 */
(function () {
    const CFG = window.__PLAYER__;
    if (!CFG) return;

    const video = document.getElementById('player-video');
    const fsAxesLbl = document.getElementById('fs-axes');
    const devStatusEl = document.getElementById('player-dev-status');
    const intensitySlider = document.getElementById('intensity-slider');
    const intensityValue  = document.getElementById('intensity-value');
    const outMinSlider    = document.getElementById('out-min-slider');
    const outMinValue     = document.getElementById('out-min-value');
    const outMaxSlider    = document.getElementById('out-max-slider');
    const outMaxValue     = document.getElementById('out-max-value');
    const expandToggle    = document.getElementById('expand-toggle');
    const fsSpanLabel     = document.getElementById('fs-span-label');
    const strokeReset     = document.getElementById('stroke-reset');
    const vizLimit        = document.getElementById('viz-limit');
    const vizActual       = document.getElementById('viz-actual');
    const vizMarker       = document.getElementById('viz-marker');
    const vizSrc          = document.getElementById('viz-src');
    const vizSrcLbl       = document.getElementById('viz-src-lbl');
    const vizText         = document.getElementById('viz-text');
    const vizWarn         = document.getElementById('viz-warn');
    const rangeTrack      = document.getElementById('range-track');
    const rangeFill       = document.getElementById('range-fill');
    const thumbMin        = document.getElementById('thumb-min');
    const thumbMax        = document.getElementById('thumb-max');
    const gainRow         = document.getElementById('gain-row');
    const gainCapNote     = document.getElementById('gain-cap-note');

    // 관리자 기본값(서버 설정) + 사용자 개별 조정(localStorage)
    const VR_ADMIN = Object.assign({ hFovDeg: 100, fisheyeFovDeg: 100, pitchDeg: 30, yawDeg: 0, eye: 'left' }, CFG.vrDefaults || {});
    const VR_LS = 'pulse_vr_view';
    function vrLoadUser() { try { return JSON.parse(localStorage.getItem(VR_LS)) || null; } catch (_) { return null; } }
    function vrSaveUser(p) { try { localStorage.setItem(VR_LS, JSON.stringify(p)); } catch (_) {} }
    function vrClearUser() { try { localStorage.removeItem(VR_LS); } catch (_) {} }

    function initVRReproject(video) {
        const canvas = document.getElementById('vr-canvas');
        const stage  = document.getElementById('vr-stage');
        if (!canvas || !window.VRReproject) return vrFallback(canvas, video);
        const initOpts = Object.assign({}, VR_ADMIN, vrLoadUser() || {});
        const vr = window.VRReproject.create(video, canvas, initOpts);
        if (!vr.ok) return vrFallback(canvas, video);
        vr.start();
        window.addEventListener('resize', () => vr.resize());
        document.addEventListener('fullscreenchange', () => setTimeout(() => vr.resize(), 50));
        setupVRControls(video, stage, canvas);
        setupAdjustPanel(vr);
    }

    // 사용자 화면 조절 패널 — ⚙ 버튼으로 토글, 변경은 localStorage에 저장(다음에도 유지)
    function setupAdjustPanel(vr) {
        const btn = document.getElementById('vr-adjust');
        const p = vr.getParams();
        const box = document.createElement('div');
        box.style.cssText = 'position:absolute;right:12px;bottom:60px;z-index:6;background:rgba(18,12,28,.96);border:1px solid #7B2DFF;border-radius:10px;padding:12px 14px;width:250px;font:12px/1.5 system-ui,monospace;color:#fff;box-shadow:0 6px 24px rgba(0,0,0,.5);display:none';
        const row = (label, id, min, max, step, val) =>
            `<div style="margin:7px 0">
                <div style="display:flex;justify-content:space-between"><span>${label}</span><b id="${id}-v">${val}</b></div>
                <input id="${id}" type="range" min="${min}" max="${max}" step="${step}" value="${val}" style="width:100%;accent-color:#7B2DFF">
            </div>`;
        box.innerHTML =
            '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">'
            +  '<b style="color:#B388FF">화면 조절</b><button id="vr-adj-close" style="background:none;border:none;color:#aaa;font-size:16px;cursor:pointer">✕</button>'
            + '</div>'
            + row('확대 (작을수록 크게)', 'tn-h', 50, 160, 1, p.hFovDeg)
            + row('직선 보정', 'tn-f', 60, 230, 1, p.fisheyeFovDeg)
            + row('상하 시점', 'tn-p', -80, 80, 1, p.pitchDeg)
            + row('좌우 시점', 'tn-y', -80, 80, 1, p.yawDeg)
            + '<button id="tn-reset" style="width:100%;margin-top:6px;padding:6px;background:#2a1f3d;color:#fff;border:1px solid #7B2DFF;border-radius:6px;cursor:pointer">기본값으로</button>';
        const stage = document.getElementById('vr-stage');
        (stage || document.body).appendChild(box);
        const $ = (id) => box.querySelector('#' + id);
        const persist = () => vrSaveUser(vr.getParams());
        const bind = (id, key) => $(id).addEventListener('input', (e) => {
            $(id + '-v').textContent = e.target.value;
            vr.setParams({ [key]: +e.target.value });
            persist();
        });
        bind('tn-h', 'hFovDeg'); bind('tn-f', 'fisheyeFovDeg'); bind('tn-p', 'pitchDeg'); bind('tn-y', 'yawDeg');
        $('tn-reset').addEventListener('click', () => {
            vr.setParams({ hFovDeg: VR_ADMIN.hFovDeg, fisheyeFovDeg: VR_ADMIN.fisheyeFovDeg, pitchDeg: VR_ADMIN.pitchDeg, yawDeg: VR_ADMIN.yawDeg });
            const q = vr.getParams();
            $('tn-h').value = q.hFovDeg; $('tn-h-v').textContent = q.hFovDeg;
            $('tn-f').value = q.fisheyeFovDeg; $('tn-f-v').textContent = q.fisheyeFovDeg;
            $('tn-p').value = q.pitchDeg; $('tn-p-v').textContent = q.pitchDeg;
            $('tn-y').value = q.yawDeg; $('tn-y-v').textContent = q.yawDeg;
            vrClearUser();   // 사용자 조정 초기화 → 관리자 기본값 사용
        });
        $('vr-adj-close').addEventListener('click', () => { box.style.display = 'none'; });
        if (btn) btn.addEventListener('click', () => {
            box.style.display = (box.style.display === 'none') ? 'block' : 'none';
        });
    }
    function vrFallback(canvas, video) {
        // WebGL 미지원/실패 → 원본 영상 + 네이티브 컨트롤로 폴백
        if (canvas) canvas.style.display = 'none';
        const c = document.getElementById('vr-controls'); if (c) c.style.display = 'none';
        video.style.cssText = 'width:100%;height:100%;z-index:2;';
        video.setAttribute('controls', 'controls');
    }
    function setupVRControls(video, stage, canvas) {
        const btnPlay = document.getElementById('vr-play');
        const seek    = document.getElementById('vr-seek');
        const timeEl  = document.getElementById('vr-time');
        const btnMute = document.getElementById('vr-mute');
        const btnFs   = document.getElementById('vr-fs');
        const fmt = (s) => { s = Math.max(0, Math.floor(s || 0)); return `${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`; };
        let seeking = false;
        function sync() {
            btnPlay.textContent = video.paused ? '▶' : '⏸';
            btnMute.textContent = video.muted ? '🔇' : '🔊';
            if (!seeking && video.duration) {
                seek.value = (video.currentTime / video.duration) * 1000;
                timeEl.textContent = `${fmt(video.currentTime)} / ${fmt(video.duration)}`;
            }
        }
        const toggle = () => { video.paused ? video.play() : video.pause(); };
        btnPlay.addEventListener('click', toggle);
        if (canvas) canvas.addEventListener('click', toggle);
        btnMute.addEventListener('click', () => { video.muted = !video.muted; sync(); });
        btnFs.addEventListener('click', () => {
            if (document.fullscreenElement) document.exitFullscreen();
            else if (stage && stage.requestFullscreen) stage.requestFullscreen();
        });
        seek.addEventListener('input', () => { seeking = true; });
        seek.addEventListener('change', () => {
            if (video.duration) video.currentTime = (seek.value / 1000) * video.duration;
            seeking = false;
        });
        ['timeupdate', 'play', 'pause', 'loadedmetadata', 'volumechange'].forEach(ev => video.addEventListener(ev, sync));
        sync();
    }

    // VR 재투영 시작 — 위의 const/함수 정의가 모두 끝난 뒤 호출 (TDZ 회피)
    if (CFG.type === 'vr') initVRReproject(video);

    let intensity = 1.0;
    let engine = null;

    if (!window.PulseDevice || !window.PulseFunscript) return;
    const Dev = window.PulseDevice;
    const FS  = window.PulseFunscript;

    // 디바이스 상태 표시
    function renderDev(s) {
        if (s.connected) {
            devStatusEl.innerHTML = `<span style="color: var(--c-green); font-weight: 600;">● 연결됨</span> · ${s.kind === 'serial' ? 'USB' : 'BLE'} · <span class="mono" style="font-size:11px;">${s.sentCount.toLocaleString()} cmd</span>`;
        } else {
            devStatusEl.innerHTML = `<span class="text-faint">우상단 메뉴에서 디바이스를 연결하세요.</span>`;
        }
    }
    renderDev(Dev.getStatus());
    Dev.onChange(renderDev);

    // ─── 스트로크 제어 (최소·최대·강도·자동확장) ───────────────
    // 설정은 기기·취향에 묶이므로 브라우저에 저장한다 (VR 재투영 설정과 같은 방식)
    const STROKE_KEY = 'pulse_stroke_cfg';
    const STROKE_DEFAULT = { outMin: 0, outMax: 100, gain: 1.0, expand: true };
    let stroke = Object.assign({}, STROKE_DEFAULT);
    try {
        const saved = JSON.parse(localStorage.getItem(STROKE_KEY) || 'null');
        if (saved) stroke = Object.assign(stroke, saved);
    } catch (_) {}

    function saveStroke() {
        try { localStorage.setItem(STROKE_KEY, JSON.stringify(stroke)); } catch (_) {}
    }

    // 슬라이더 → 상태. 최소가 최대를 넘지 않도록 서로 밀어낸다.
    function pullFromUI(changed) {
        let lo = parseInt(outMinSlider.value, 10);
        let hi = parseInt(outMaxSlider.value, 10);
        if (lo >= hi) {
            if (changed === 'min') { lo = Math.max(0, hi - 5); outMinSlider.value = lo; }
            else                   { hi = Math.min(100, lo + 5); outMaxSlider.value = hi; }
        }
        stroke.outMin = lo;
        stroke.outMax = hi;
        stroke.gain   = parseInt(intensitySlider.value, 10) / 100;
        stroke.expand = !!expandToggle.checked;
        intensity = stroke.gain;           // 하위호환 경로에서도 같은 값을 쓰도록
        renderStroke();
        saveStroke();
    }

    function renderStroke() {
        if (!strokeUIReady) return;
        outMinValue.textContent   = stroke.outMin;
        outMaxValue.textContent   = stroke.outMax;
        intensityValue.textContent = Math.round(stroke.gain * 100) + '%';

        // 세로 이중 슬라이더 위치 (아래가 0)
        if (rangeFill) {
            rangeFill.style.bottom = stroke.outMin + '%';
            rangeFill.style.height = (stroke.outMax - stroke.outMin) + '%';
        }
        if (thumbMin) thumbMin.style.bottom = stroke.outMin + '%';
        if (thumbMax) thumbMax.style.bottom = stroke.outMax + '%';

        // 자동확장이 꺼지면 강도는 의미가 없다 → 함께 비활성
        const on = !!stroke.expand;
        if (gainRow) { gainRow.style.opacity = on ? '1' : '.45'; }
        intensitySlider.disabled = !on;

        applyGainCap();
        renderViz();
    }

    /* 강도 상한 — 속도 제한에 걸리면 아무리 올려도 그 이상 안 올라간다.
       필요속도 = 원본최대속도 × (출력폭 × 강도) / 기준폭
       이 값이 상한을 넘지 않는 최대 강도를 구해 슬라이더 max 로 건다. */
    function applyGainCap() {
        if (!strokeUIReady || !window.PulseFunscript) return;
        const FSx = window.PulseFunscript;
        const cap = FSx.maxSpeed ? FSx.maxSpeed() : 0.4;
        const outSpan = Math.max(1, stroke.outMax - stroke.outMin);

        // 원본 진폭 정보가 없으면(스크립트 로드 전) 제한하지 않는다
        if (!strokeAxis || !strokeAxis.maxSpeed) {
            intensitySlider.max = 100;
            if (gainCapNote) gainCapNote.style.display = 'none';
            return;
        }
        const base = (stroke.expand && strokeAxis.span >= FSx.MIN_EXPAND_SPAN) ? strokeAxis.span : 100;
        const perGain = strokeAxis.maxSpeed * (outSpan / base);      // 강도 1.0 일 때 필요속도
        let maxGain = perGain > 0 ? cap / perGain : 1;
        let maxPct = Math.floor(Math.min(1, maxGain) * 100 / 5) * 5; // 슬라이더 step(5)에 맞춤
        if (maxPct < 20) maxPct = 20;                                // 슬라이더 최소값 아래로는 못 내린다

        intensitySlider.max = String(maxPct);
        if (stroke.gain * 100 > maxPct) {                            // 이미 넘어 있으면 끌어내린다
            stroke.gain = maxPct / 100;
            intensity = stroke.gain;
            intensitySlider.value = String(maxPct);
            intensityValue.textContent = maxPct + '%';
        }

        if (gainCapNote) {
            const limited = maxPct < 100;
            const stillOver = (perGain * (maxPct / 100)) > cap + 1e-9;
            gainCapNote.style.display = limited ? 'block' : 'none';
            gainCapNote.textContent = !limited ? ''
                : stillOver
                    ? `⚠ 최소 강도에서도 기기 속도 한계(${cap} %/ms)를 넘습니다 — 최소~최대 범위를 좁혀주세요.`
                    : `⚠ 기기 속도 한계로 강도는 ${maxPct}%까지만 올라갑니다. 범위를 좁히면 더 올릴 수 있습니다.`;
        }
    }

    // 실제 움직임 범위 미리보기.
    // ⚠ 여기서 공식을 다시 구현하지 않는다. 엔진이 쓰는 shapeStroke를 그대로 호출해야
    //    공식이 바뀌어도 미리보기가 어긋나지 않는다.
    let strokeAxis = null;              // 로드된 L0 축 (진폭 lo/hi/span 보유)
    const pct = (v) => Math.max(0, Math.min(100, v)) + '%';

    function renderViz() {
        if (!vizLimit || !window.PulseFunscript) return;
        const FSx = window.PulseFunscript;

        // 세로 막대 — 아래가 0(얕음), 위가 100(깊음)이라 bottom/height로 배치한다
        vizLimit.style.bottom = pct(stroke.outMin);
        vizLimit.style.height = pct(stroke.outMax - stroke.outMin);

        if (!strokeAxis) {                       // 스크립트 로드 전
            vizActual.style.bottom = vizActual.style.height = '0%';
            if (vizSrc) vizSrc.style.height = '0%';
            if (vizSrcLbl) vizSrcLbl.textContent = '';
            if (vizText) vizText.textContent = '스크립트를 불러오면 실제 범위가 표시됩니다.';
            return;
        }

        // 원본의 최저·최고를 통과시키면 그게 곧 도달 가능한 양 끝이다.
        // (확장 ON/OFF, 안전 임계 미달까지 shapeStroke가 알아서 반영)
        const a = FSx.shapeStroke(strokeAxis.lo, strokeAxis, stroke, stroke.gain);
        const b = FSx.shapeStroke(strokeAxis.hi, strokeAxis, stroke, stroke.gain);
        const lo = Math.max(0, Math.min(99, Math.min(a, b)));
        const hi = Math.max(0, Math.min(99, Math.max(a, b)));

        vizActual.style.bottom = pct(lo);
        vizActual.style.height = pct(hi - lo);

        // 원본 진폭 (비교용) — 트랙 옆 별도 열이라 막대와 겹치지 않는다
        if (vizSrc) {
            vizSrc.style.bottom = pct(strokeAxis.lo);
            vizSrc.style.height = pct(strokeAxis.span);
        }
        if (vizSrcLbl) {
            vizSrcLbl.textContent  = `원본 ${strokeAxis.lo}~${strokeAxis.hi}`;
            vizSrcLbl.style.bottom = pct(strokeAxis.lo + strokeAxis.span / 2);   // 구간 중앙에
        }

        const ratio = strokeAxis.span > 0 ? (hi - lo) / strokeAxis.span : 0;
        const blocked = stroke.expand && strokeAxis.span < FSx.MIN_EXPAND_SPAN;

        // 진폭을 늘리면 같은 시간에 더 멀리 가야 하므로 요구 속도가 배율만큼 커진다.
        // 상한을 넘으면 엔진이 이동시간을 늘려 맞추므로, 실제로는 목표 진폭에 다 못 갈 수 있다.
        const needSpeed = (strokeAxis.maxSpeed || 0) * ratio;
        const over = FSx.MAX_SPEED && needSpeed > FSx.MAX_SPEED;

        if (vizText) {
            vizText.textContent = `실제 ${lo}~${hi} (폭 ${hi - lo}) · 원본 대비 ${ratio.toFixed(2)}배`
                + (blocked ? ' · ⚠ 원본 진폭이 좁아 확장 안 함' : '');
        }
        if (vizWarn) {
            vizWarn.textContent = over
                ? `⚠ 기기 속도 한계 초과 (필요 ${needSpeed.toFixed(2)} / 상한 ${FSx.MAX_SPEED} %/ms)`
                  + ` — 빠른 구간에서 이동시간이 늘어나 진폭이 목표보다 작아집니다.`
                  + ` 범위를 좁히거나 강도를 낮추면 원래 리듬에 가까워집니다.`
                : '';
            vizWarn.style.display = over ? 'block' : 'none';
        }
    }

    const strokeUIReady = !!(outMinSlider && outMaxSlider && intensitySlider && expandToggle);

    function pushToUI() {
        if (!strokeUIReady) return;
        outMinSlider.value    = stroke.outMin;
        outMaxSlider.value    = stroke.outMax;
        intensitySlider.value = Math.round(stroke.gain * 100);
        expandToggle.checked  = stroke.expand;
        intensity = stroke.gain;
        renderStroke();
    }
    pushToUI();

    if (strokeUIReady) {
        outMinSlider.addEventListener('input', () => pullFromUI('min'));
        outMaxSlider.addEventListener('input', () => pullFromUI('max'));
        intensitySlider.addEventListener('input', () => pullFromUI('gain'));
        expandToggle.addEventListener('change', () => pullFromUI('expand'));
    }

    /* 세로 이중 슬라이더 — 최소·최대 손잡이를 끌어 범위를 정한다.
       네이티브 range를 세로로 겹쳐 쓰는 건 브라우저별로 동작이 갈려서 직접 만들었다.
       실제 값은 숨겨둔 range 입력에 넣어 기존 pullFromUI 흐름을 그대로 쓴다. */
    if (rangeTrack && thumbMin && thumbMax) {
        let dragging = null;

        const valueAt = (clientY) => {
            const r = rangeTrack.getBoundingClientRect();
            const ratio = (r.bottom - clientY) / r.height;          // 아래가 0
            return Math.max(0, Math.min(100, Math.round(ratio * 100)));
        };
        const nearest = (v) => (Math.abs(v - stroke.outMin) <= Math.abs(v - stroke.outMax) ? 'min' : 'max');

        function applyDrag(which, v) {
            if (which === 'min') {
                outMinSlider.value = Math.min(v, stroke.outMax - 5);
                pullFromUI('min');
            } else {
                outMaxSlider.value = Math.max(v, stroke.outMin + 5);
                pullFromUI('max');
            }
        }

        const onMove = (e) => {
            if (!dragging) return;
            e.preventDefault();
            applyDrag(dragging, valueAt(e.touches ? e.touches[0].clientY : e.clientY));
        };
        const onUp = () => { dragging = null; };

        [thumbMin, thumbMax].forEach(function (el) {
            const start = (e) => { dragging = el.getAttribute('data-which'); e.preventDefault(); };
            el.addEventListener('mousedown', start);
            el.addEventListener('touchstart', start, { passive: false });
        });
        // 트랙을 직접 누르면 가까운 손잡이가 그쪽으로 온다
        rangeTrack.addEventListener('mousedown', (e) => {
            if (e.target === thumbMin || e.target === thumbMax) return;
            const v = valueAt(e.clientY);
            dragging = nearest(v);
            applyDrag(dragging, v);
        });
        document.addEventListener('mousemove', onMove);
        document.addEventListener('touchmove', onMove, { passive: false });
        document.addEventListener('mouseup', onUp);
        document.addEventListener('touchend', onUp);
    }
    strokeReset && strokeReset.addEventListener('click', () => {
        stroke = Object.assign({}, STROKE_DEFAULT);
        pushToUI();
        saveStroke();
    });

    if (!CFG.fsPath) {
        fsAxesLbl.textContent = '스크립트 없음';
        return;
    }

    FS.loadMultiAxis(CFG.fsPath).then((axes) => {
        const present = Object.keys(axes);
        if (!present.length) { fsAxesLbl.textContent = '로드 실패'; return; }
        fsAxesLbl.textContent = present.join(' · ');

        // 스크립트가 실제로 쓰는 폭을 보여준다 — "왜 조금만 움직이는지"가 여기서 드러난다
        const L0 = axes.L0;
        if (L0 && fsSpanLabel) {
            fsSpanLabel.textContent = L0.span >= 10 ? '' : '원본 진폭이 너무 좁아 자동 확장은 적용되지 않습니다.';
        } else if (fsSpanLabel) {
            fsSpanLabel.textContent = 'L0 스트로크 축 없음';
        }

        strokeAxis = L0 || null;
        // 원본 진폭·속도를 알게 된 시점이라 강도 상한을 여기서 다시 계산해야 한다
        renderStroke();

        engine = new FS.MultiAxisEngine({
            video,
            axes,
            intensityGetter: () => intensity,
            shapeGetter: () => stroke,
            sendOnce: true,
            onCommand: (cmd, triggered) => {
                Dev.send(cmd);
                // 재생 중 현재 위치 표시 — L0만
                if (!vizMarker) return;
                for (const t of triggered) {
                    if (t.axis !== 'L0') continue;
                    vizMarker.style.bottom  = pct(t.pos);
                    vizMarker.style.opacity = '1';
                }
            },
        });
        engine.start();
    });

    video.addEventListener('seeking', () => { engine && engine.resync(); });
    video.addEventListener('pause',   () => { Dev.send('L050I300'); if (vizMarker) vizMarker.style.opacity = '0.3'; });
    video.addEventListener('ended',   () => { Dev.send('L050I500'); if (vizMarker) vizMarker.style.opacity = '0'; });

    // 시청 위치 트래킹 (5초마다, 그리고 종료/이탈 시)
    let saveTimer = setInterval(saveProgress, 5000);
    function saveProgress() {
        if (!CFG.contentId) return;   // BJ 개인 영상 등 콘텐츠 ID 없으면 기록 안 함
        if (!video.currentTime) return;
        fetch('/content/track-watch', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-csrf-token': (document.querySelector('meta[name=csrf-token]') || {}).content || '',
            },
            body: JSON.stringify({ contentId: CFG.contentId, position: video.currentTime }),
            keepalive: true,
        }).catch(() => {});
    }
    window.addEventListener('beforeunload', saveProgress);
})();
