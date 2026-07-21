/* Content player — 영상 + funscript 다축 + 디바이스 송신 */
(function () {
    const CFG = window.__PLAYER__;
    if (!CFG) return;

    const video = document.getElementById('player-video');
    const fsAxesLbl = document.getElementById('fs-axes');
    const devStatusEl = document.getElementById('player-dev-status');
    const intensitySlider = document.getElementById('intensity-slider');
    const intensityValue  = document.getElementById('intensity-value');

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

    intensitySlider.addEventListener('input', () => {
        intensity = parseInt(intensitySlider.value, 10) / 100;
        intensityValue.textContent = intensitySlider.value + '%';
    });

    if (!CFG.fsPath) {
        fsAxesLbl.textContent = '스크립트 없음';
        return;
    }

    FS.loadMultiAxis(CFG.fsPath).then((axes) => {
        const present = Object.keys(axes);
        if (!present.length) { fsAxesLbl.textContent = '로드 실패'; return; }
        fsAxesLbl.textContent = present.join(' · ');
        engine = new FS.MultiAxisEngine({
            video,
            axes,
            intensityGetter: () => intensity,
            sendOnce: true,
            onCommand: (cmd) => Dev.send(cmd),
        });
        engine.start();
    });

    video.addEventListener('seeking', () => { engine && engine.resync(); });
    video.addEventListener('pause',   () => Dev.send('L050I300'));
    video.addEventListener('ended',   () => Dev.send('L050I500'));

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
