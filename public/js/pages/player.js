/* Content player — 영상 + funscript 다축 + 디바이스 송신 */
(function () {
    const CFG = window.__PLAYER__;
    if (!CFG) return;

    const video = document.getElementById('player-video');
    const fsAxesLbl = document.getElementById('fs-axes');
    const devStatusEl = document.getElementById('player-dev-status');

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

    // ─── 스트로크 제어 v2 — SR6 전 축, 축마다 같은 설정 ──────────────
    // 설정 구조·공식은 funscript.js (SHAPE_DEFAULT / shapeAxis / autoGain).
    // 여기서는 공식을 다시 구현하지 않는다 — 미리보기도 엔진과 같은 함수를 부른다.
    const $s = (id) => document.getElementById(id);
    const AXES = [
        { id: 'L0', label: '스트로크', color: '#FF2D5E' },
        { id: 'L1', label: '서지',     color: '#FF8A5E' },
        { id: 'L2', label: '스웨이',   color: '#FFD15E' },
        // ⚠ R0/R1 라벨은 현재 코드 매핑(funscript.js AXIS_DEFS)을 따른다. T-Code 표준과 반대일 수 있음 — 실기기 확인 전.
        { id: 'R0', label: '롤',       color: '#7B2DFF' },
        { id: 'R1', label: '트위스트', color: '#5EB0FF' },
        { id: 'R2', label: '피치',     color: '#5EFFB0' },
    ];
    const STROKE_KEY = 'pulse_stroke_cfg_v2';
    const MIN_SPAN = 10;                                  // 가동범위 두 손잡이 최소 간격
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
    const pct = (v) => clamp(v, 0, 100) + '%';

    let strokeCfg = {}; for (const a of AXES) strokeCfg[a.id] = Object.assign({}, FS.SHAPE_DEFAULT);
    try {
        const saved = JSON.parse(localStorage.getItem(STROKE_KEY) || 'null');
        if (saved) for (const k of Object.keys(saved)) if (strokeCfg[k]) strokeCfg[k] = Object.assign({}, FS.SHAPE_DEFAULT, saved[k]);
    } catch (_) {}
    function saveStroke() { try { localStorage.setItem(STROKE_KEY, JSON.stringify(strokeCfg)); } catch (_) {} }

    let loadedAxes = {};              // 스크립트 로드 후 채워진다 — 축별 원본 진폭(lo/hi/span)
    let activeAxis = 'L0';

    const el = {
        tabs: $s('ax-tabs'), summary: $s('ax-summary'),
        vizLimit: $s('viz-limit'), vizActual: $s('viz-actual'), vizCenter: $s('viz-center'), vizMarker: $s('viz-marker'),
        vizSrc: $s('viz-src'), vizSrcLbl: $s('viz-src-lbl'), vizText: $s('viz-text'),
        vRange: $s('v-range'), vFill: $s('v-fill'), tMin: $s('v-thumb-min'), tMax: $s('v-thumb-max'), hwMin: $s('hw-min'), hwMax: $s('hw-max'),
        vCenter: $s('v-center'), vcFill: $s('vc-fill'), tC: $s('v-thumb-c'), centerVal: $s('center-val'),
        auto: $s('auto-toggle'), gain: $s('gain'), gainVal: $s('gain-val'), gainRow: $s('gain-row'), hint: $s('ax-hint'),
    };
    const strokeUIReady = !!(el.tabs && el.vRange && el.vCenter && el.gain && el.auto);

    function renderTabs() {
        if (!el.tabs) return;
        el.tabs.innerHTML = '';
        for (const a of AXES) {
            const b = document.createElement('button');
            b.type = 'button'; b.className = 'ax-tab' + (a.id === activeAxis ? ' is-active' : '');
            b.style.setProperty('--ax', a.color);
            b.innerHTML = `<b>${a.id}</b><span>${a.label}</span>` + (loadedAxes[a.id] ? '' : '<i title="이 영상엔 이 축 스크립트가 없습니다">·</i>');
            b.addEventListener('click', () => { activeAxis = a.id; renderTabs(); renderStroke(); });
            el.tabs.appendChild(b);
        }
    }

    function renderStroke() {
        if (!strokeUIReady) return;
        const c = strokeCfg[activeAxis], ax = loadedAxes[activeAxis] || null, meta = AXES.find(a => a.id === activeAxis);
        document.documentElement.style.setProperty('--ax', meta.color);
        const { lo, hi, center } = FS.shapeCenter(c);
        el.vFill.style.bottom = pct(lo); el.vFill.style.height = pct(hi - lo);
        el.tMin.style.bottom = pct(lo);  el.tMax.style.bottom = pct(hi);
        el.hwMin.textContent = lo; el.hwMax.textContent = hi;
        el.vcFill.style.bottom = pct(lo); el.vcFill.style.height = pct(hi - lo);
        el.tC.style.bottom = pct(center); el.centerVal.textContent = Math.round(center);

        const g = FS.effectiveGain(ax, c);
        el.auto.checked = !!c.auto;
        el.gain.max = c.auto ? Math.max(300, Math.round(g * 100)) : 300;    // 자동값이 300 을 넘으면 눈금을 늘린다
        el.gain.value = Math.round(g * 100);
        el.gainVal.textContent = Math.round(g * 100) + '%' + (c.auto ? ' 자동' : '');
        el.gainRow.classList.toggle('is-off', !!c.auto); el.gain.disabled = !!c.auto;

        el.vizLimit.style.bottom = pct(lo); el.vizLimit.style.height = pct(hi - lo);
        el.vizCenter.style.bottom = pct(center);
        if (!ax) {
            el.vizActual.style.height = '0%'; el.vizSrc.style.height = '0%'; el.vizSrcLbl.textContent = '';
            el.vizText.textContent = `${meta.id} ${meta.label} — 이 영상엔 스크립트 없음 · 설정은 저장됩니다`;
            el.hint.textContent = '';
        } else {
            const a = FS.shapeAxis(ax.lo, ax, c), b = FS.shapeAxis(ax.hi, ax, c);
            const olo = Math.min(a, b), ohi = Math.max(a, b);
            el.vizActual.style.bottom = pct(olo); el.vizActual.style.height = pct(Math.max(ohi - olo, 1));
            el.vizSrc.style.bottom = pct(ax.lo); el.vizSrc.style.height = pct(ax.hi - ax.lo);
            el.vizSrcLbl.style.bottom = pct((ax.lo + ax.hi) / 2); el.vizSrcLbl.textContent = `원본 ${ax.lo}~${ax.hi}`;
            const ratio = ax.span ? (ohi - olo) / ax.span : 0;
            el.vizText.textContent = `실제 ${olo}~${ohi} · 중심 ${Math.round(center)} · 원본 대비 ${ratio.toFixed(2)}배`;
            const want = ax.span * g;
            el.hint.textContent = c.auto && ax.span < FS.MIN_EXPAND_SPAN
                ? '원본 진폭이 너무 좁아 자동 맞춤이 증폭하지 않습니다 (100% 유지).'
                : (ohi - olo) < want - 1 ? '가동범위에 걸려 일부가 잘립니다 — 범위를 넓히거나 중심을 옮기세요.' : '';
        }
        renderSummary(); saveStroke();
    }
    function renderSummary() {
        if (!el.summary) return;
        el.summary.innerHTML = '';
        for (const a of AXES) {
            const c = strokeCfg[a.id], ax = loadedAxes[a.id] || null;
            const d = document.createElement('div');
            d.className = 'ax-sum' + (a.id === activeAxis ? ' is-active' : '');
            d.style.setProperty('--ax', a.color);
            const { lo, hi, center } = FS.shapeCenter(c);
            const txt = ax ? `실제 ${Math.min(FS.shapeAxis(ax.lo,ax,c),FS.shapeAxis(ax.hi,ax,c))}~${Math.max(FS.shapeAxis(ax.lo,ax,c),FS.shapeAxis(ax.hi,ax,c))}` : '스크립트 없음';
            d.innerHTML = `<b>${a.id}</b> 범위 ${lo}~${hi} · 중심 ${Math.round(center)} · ${Math.round(FS.effectiveGain(ax,c)*100)}%${c.auto ? ' 자동' : ''} · <span>${txt}</span>`;
            d.addEventListener('click', () => { activeAxis = a.id; renderTabs(); renderStroke(); });
            el.summary.appendChild(d);
        }
    }

    // ── 세로 드래그 (가동범위 두 손잡이 · 중심 한 손잡이) ──
    if (strokeUIReady) {
        const valueAt = (track, clientY) => { const r = track.getBoundingClientRect(); return clamp(Math.round(((r.bottom - clientY) / r.height) * 100), 0, 100); };
        let drag = null;
        function applyDrag(kind, v) {
            const c = strokeCfg[activeAxis];
            // 민 쪽이 커서를 따라가고 상대를 밀어낸다 — 맞추면 겹쳐서 다시 못 잡는다
            if (kind === 'min')         { const lo = Math.min(v, 100 - MIN_SPAN); c.hwMin = lo; if (c.hwMax - lo < MIN_SPAN) c.hwMax = lo + MIN_SPAN; }
            else if (kind === 'max')    { const hi = Math.max(v, MIN_SPAN); c.hwMax = hi; if (hi - c.hwMin < MIN_SPAN) c.hwMin = hi - MIN_SPAN; }
            else if (kind === 'center') { c.centerFrac = (c.hwMax > c.hwMin) ? clamp((v - c.hwMin) / (c.hwMax - c.hwMin), 0, 1) : 0.5; }
            renderStroke();
        }
        const startDrag = (kind) => (e) => { drag = kind; e.preventDefault(); };
        el.tMin.addEventListener('mousedown', startDrag('min'));  el.tMin.addEventListener('touchstart', startDrag('min'), { passive: false });
        el.tMax.addEventListener('mousedown', startDrag('max'));  el.tMax.addEventListener('touchstart', startDrag('max'), { passive: false });
        el.tC.addEventListener('mousedown', startDrag('center')); el.tC.addEventListener('touchstart', startDrag('center'), { passive: false });
        el.vRange.addEventListener('mousedown', (e) => {          // 트랙 클릭 → 가까운 손잡이
            if (e.target === el.tMin || e.target === el.tMax) return;
            const v = valueAt(el.vRange, e.clientY), c = strokeCfg[activeAxis];
            drag = Math.abs(v - c.hwMin) <= Math.abs(v - c.hwMax) ? 'min' : 'max'; applyDrag(drag, v);
        });
        el.vCenter.addEventListener('mousedown', (e) => { if (e.target === el.tC) return; drag = 'center'; applyDrag('center', valueAt(el.vCenter, e.clientY)); });
        const onMove = (e) => {
            if (!drag) return; e.preventDefault();
            const y = e.touches ? e.touches[0].clientY : e.clientY;
            applyDrag(drag, valueAt(drag === 'center' ? el.vCenter : el.vRange, y));
        };
        document.addEventListener('mousemove', onMove); document.addEventListener('touchmove', onMove, { passive: false });
        document.addEventListener('mouseup', () => drag = null); document.addEventListener('touchend', () => drag = null);

        el.gain.addEventListener('input', () => { strokeCfg[activeAxis].gain = parseInt(el.gain.value, 10) / 100; renderStroke(); });
        el.auto.addEventListener('change', () => { strokeCfg[activeAxis].auto = el.auto.checked; renderStroke(); });
        $s('ax-reset').addEventListener('click', () => { strokeCfg[activeAxis] = Object.assign({}, FS.SHAPE_DEFAULT); renderStroke(); });
        $s('all-reset').addEventListener('click', () => { for (const a of AXES) strokeCfg[a.id] = Object.assign({}, FS.SHAPE_DEFAULT); renderStroke(); });

        renderTabs(); renderStroke();
    }

    if (!CFG.fsPath) {
        fsAxesLbl.textContent = '스크립트 없음';
        return;
    }

    FS.loadMultiAxis(CFG.fsPath).then((axes) => {
        const present = Object.keys(axes);
        if (!present.length) { fsAxesLbl.textContent = '로드 실패'; return; }
        fsAxesLbl.textContent = present.join(' · ');

        // 축별 원본 진폭을 위젯에 넘긴다 — "왜 조금만 움직이는지"가 여기서 드러난다
        loadedAxes = axes;
        renderTabs(); renderStroke();

        engine = new FS.MultiAxisEngine({
            video,
            axes,
            shapeGetter: (axisKey) => strokeCfg[axisKey] || null,   // 축별 설정 (v2)
            sendOnce: true,
            onCommand: (cmd, triggered) => {
                Dev.send(cmd);
                // 재생 중 현재 위치 표시 — 지금 보고 있는 축만
                if (!el.vizMarker) return;
                for (const t of triggered) {
                    if (t.axis !== activeAxis) continue;
                    el.vizMarker.style.bottom  = pct(t.pos);
                    el.vizMarker.style.opacity = '1';
                }
            },
        });
        engine.start();
    });

    video.addEventListener('seeking', () => { engine && engine.resync(); });
    video.addEventListener('pause',   () => { Dev.send('L050I300'); if (el.vizMarker) el.vizMarker.style.opacity = '0.3'; });
    video.addEventListener('ended',   () => { Dev.send('L050I500'); if (el.vizMarker) el.vizMarker.style.opacity = '0'; });

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
