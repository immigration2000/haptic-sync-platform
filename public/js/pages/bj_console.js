/* BJ Console — 키보드/슬라이더로 동작 송신, 사용자와 1:1 WebRTC */
(function () {
    const CFG = window.__BJ_CONSOLE__;
    if (!CFG) return;

    const $ = (id) => document.getElementById(id);
    const socket = io();
    const peers = new Map();
    let micStream = null;
    let micOn = false;
    let monitorOn = true;
    let selectedInput = '';
    let selectedOutput = '';
    let startMs = 0;

    const AUDIO = (deviceId) => {
        const c = { echoCancellation:true, noiseSuppression:true, autoGainControl:true, channelCount:1 };
        if (deviceId) c.deviceId = { exact: deviceId };
        return c;
    };

    // ── Sliders / keys
    const axes = {
        L0: { el: $('ax-l0'), val: $('l0-val'), v: 50 },
        R0: { el: $('ax-r0'), val: $('r0-val'), v: 50 },
        R2: { el: $('ax-r2'), val: $('r2-val'), v: 50 },
    };
    const interpEl = $('ax-interp'), interpVal = $('interp-val');
    let interp = 100;
    interpEl.addEventListener('input', () => { interp = parseInt(interpEl.value,10); interpVal.textContent = interp; });
    for (const k of Object.keys(axes)) {
        const s = axes[k];
        s.el.addEventListener('input', () => { s.v = parseInt(s.el.value,10); s.val.textContent = s.v; broadcastAxis(k, s.v); });
    }
    const KEYS = { ArrowUp:['L0',+5], ArrowDown:['L0',-5], ArrowLeft:['R0',-5], ArrowRight:['R0',+5], KeyW:['R2',+5], KeyS:['R2',-5] };
    document.addEventListener('keydown', (e) => {
        if (document.activeElement && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'SELECT')) return;
        const m = KEYS[e.code]; if (!m) return;
        e.preventDefault();
        const [k, d] = m, s = axes[k];
        s.v = Math.max(0, Math.min(99, s.v + d));
        s.el.value = s.v; s.val.textContent = s.v;
        broadcastAxis(k, s.v);
    });

    function broadcastAxis(axis, pos) {
        const cmd = `${axis}${pos.toString().padStart(2,'0')}I${interp}`;
        pushLog(cmd, axis, pos);
        sendToPeers(cmd);
    }
    // 모든 페어에 임의 메시지 전송 (MODE/VIDEO/CTRL/TCode)
    function sendToPeers(msg) {
        for (const { peer, dataReady } of peers.values()) {
            if (peer && dataReady) { try { peer.send(msg); } catch(_){} }
        }
    }

    // ── 세션 컨트롤 (모드/영상/제어소스) ──
    const sessCtrl   = $('session-ctrl');
    const btnModeCall  = $('mode-call');
    const btnModeVideo = $('mode-video');
    const videoPick    = $('video-pick');
    const videoSelect  = $('video-select');
    const btnPushVideo = $('btn-push-video');
    const btnCtrlScript= $('ctrl-script');
    const btnCtrlManual= $('ctrl-manual');
    const btnModeCam   = $('mode-cam');
    const camHint      = $('cam-hint');
    let sessMode = 'call';   // call | video | cam
    let sessCtrlSrc = 'manual';
    let camStream = null;    // 스트리머 캠 (캠 모드)

    function activateSessionCtrl() {
        sessCtrl.style.opacity = '1';
        sessCtrl.style.pointerEvents = 'auto';
        loadVideoList();
    }
    function deactivateSessionCtrl() {
        sessCtrl.style.opacity = '0.5';
        sessCtrl.style.pointerEvents = 'none';
    }

    let videoListLoaded = false;
    function loadVideoList() {
        if (videoListLoaded) return;
        videoListLoaded = true;
        fetch('/bj/console/videos').then(r => r.json()).then(d => {
            if (!d.ok) return;
            for (const v of d.videos) {
                const opt = document.createElement('option');
                opt.value = JSON.stringify({ video: v.video, script: v.script });
                opt.textContent = (v.source === 'mine' ? '★ ' : '') + `[${v.type}] ${v.title}`;
                videoSelect.appendChild(opt);
            }
        }).catch(() => {});
    }

    // 캠 켜기 — 카메라 스트림을 모든 페어에 추가(없으면 시작) + 콘솔에 미리보기
    async function ensureCamera() {
        if (camStream) return camStream;
        try {
            camStream = await navigator.mediaDevices.getUserMedia({ video: true });
        } catch (e) {
            const sh = $('status-hint'); if (sh) sh.textContent = '⚠ 카메라 권한이 필요합니다 (캠 모드)';
            return null;
        }
        try {
            cowatchVideo.srcObject = camStream; cowatchVideo.muted = true; cowatchVideo.play().catch(()=>{});
            cowatchTitle.textContent = '내 캠 — 사용자에게 송출 중';
            cowatchPanel.classList.remove('hidden');
        } catch (_) {}
        for (const { peer } of peers.values()) {
            try { for (const t of camStream.getVideoTracks()) peer.addTrack(t, camStream); } catch (_) {}
        }
        return camStream;
    }

    function setSessMode(m) {
        sessMode = m;
        btnModeCall.classList.toggle('btn-primary', m === 'call');
        btnModeCall.classList.toggle('btn-ghost', m !== 'call');
        btnModeVideo.classList.toggle('btn-primary', m === 'video');
        btnModeVideo.classList.toggle('btn-ghost', m !== 'video');
        if (btnModeCam) { btnModeCam.classList.toggle('btn-primary', m === 'cam'); btnModeCam.classList.toggle('btn-ghost', m !== 'cam'); }
        videoPick.classList.toggle('hidden', m !== 'video');
        if (camHint) camHint.classList.toggle('hidden', m !== 'cam');
        if (m === 'cam') { ensureCamera().then(() => sendToPeers('MODE:cam')); }
        else { sendToPeers('MODE:' + m); }
    }
    btnModeCall.addEventListener('click', () => setSessMode('call'));
    btnModeVideo.addEventListener('click', () => setSessMode('video'));
    if (btnModeCam) btnModeCam.addEventListener('click', () => setSessMode('cam'));

    btnPushVideo.addEventListener('click', () => {
        if (!videoSelect.value) return;
        const { video, script } = JSON.parse(videoSelect.value);
        sendToPeers('VIDEO:' + video + '|' + (script || ''));
        sendToPeers('CTRL:' + sessCtrlSrc);
    });

    function setCtrlSrc(c) {
        sessCtrlSrc = c;
        btnCtrlScript.classList.toggle('btn-primary', c === 'script');
        btnCtrlScript.classList.toggle('btn-ghost', c !== 'script');
        btnCtrlManual.classList.toggle('btn-primary', c === 'manual');
        btnCtrlManual.classList.toggle('btn-ghost', c !== 'manual');
        sendToPeers('CTRL:' + c);
    }
    btnCtrlScript.addEventListener('click', () => setCtrlSrc('script'));
    btnCtrlManual.addEventListener('click', () => setCtrlSrc('manual'));

    const logEl = $('tcode-log');
    function pushLog(cmd, axis, pos) {
        const t = ((Date.now() - (startMs || Date.now())) / 1000).toFixed(2).padStart(6, ' ');
        const line = document.createElement('div');
        const colors = { L0: '#FF2D5E', R0: '#7B2DFF', R2: '#5EFFB0' };
        line.innerHTML = `<span style="color: var(--tx-3); min-width:60px; display:inline-block;">${t}s</span> ` +
                         `<span style="color: ${colors[axis] || '#fff'}; font-weight: 700;">${axis}</span>` +
                         `<span style="color: #5EFFB0;">${pos.toString().padStart(2,'0')}</span>` +
                         `<span style="color: #B395FF;">I${interp}</span>`;
        logEl.appendChild(line);
        while (logEl.children.length > 12) logEl.removeChild(logEl.firstChild);
    }

    // ── Device selectors
    const devInputSel  = $('dev-input');
    const devOutputSel = $('dev-output');
    async function loadDevices() {
        try {
            const devices = await navigator.mediaDevices.enumerateDevices();
            function fill(sel, list, current) {
                sel.innerHTML = '<option value="">자동</option>';
                list.forEach((d, i) => {
                    const opt = document.createElement('option');
                    opt.value = d.deviceId;
                    opt.textContent = d.label || `장비 ${i+1}`;
                    if (d.deviceId === current) opt.selected = true;
                    sel.appendChild(opt);
                });
            }
            fill(devInputSel,  devices.filter(d => d.kind === 'audioinput'),  selectedInput);
            fill(devOutputSel, devices.filter(d => d.kind === 'audiooutput'), selectedOutput);
            const probe = new Audio();
            devOutputSel.disabled = (typeof probe.setSinkId !== 'function');
        } catch (e) {}
    }
    devInputSel.addEventListener('change', async (e) => {
        selectedInput = e.target.value;
        if (!micStream) return;
        try {
            const newStream = await navigator.mediaDevices.getUserMedia({ audio: AUDIO(selectedInput) });
            for (const t of newStream.getAudioTracks()) t.enabled = micOn;
            const oldT = micStream.getAudioTracks()[0];
            const newT = newStream.getAudioTracks()[0];
            // replaceTrack 완료를 기다린 뒤 옛 트랙 정리 (음성 끊김 방지)
            await Promise.all(Array.from(peers.values()).map(({ peer }) => {
                try { return Promise.resolve(peer.replaceTrack(oldT, newT, micStream)).catch(() => {}); }
                catch (_) { return Promise.resolve(); }
            }));
            for (const t of micStream.getTracks()) t.stop();
            micStream = newStream;
        } catch(_) {}
    });
    devOutputSel.addEventListener('change', async (e) => {
        selectedOutput = e.target.value;
        for (const { audio } of peers.values()) {
            if (audio && audio.setSinkId) await audio.setSinkId(selectedOutput).catch(()=>{});
        }
    });
    if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
        navigator.mediaDevices.addEventListener('devicechange', loadDevices);
    }
    loadDevices();

    // ── Mic / monitor
    const btnMic = $('btn-mic'), btnMonitor = $('btn-monitor');
    btnMic.addEventListener('click', async () => {
        if (!micStream) {
            try { micStream = await navigator.mediaDevices.getUserMedia({ audio: AUDIO(selectedInput) }); }
            catch (e) { $('status-hint').textContent = '마이크 권한 거부'; return; }
            loadDevices();
        }
        micOn = !micOn;
        for (const t of micStream.getAudioTracks()) t.enabled = micOn;
        btnMic.textContent = micOn ? '🎤 마이크 켜짐' : '🎤 마이크 꺼짐';
    });
    btnMonitor.addEventListener('click', () => {
        monitorOn = !monitorOn;
        btnMonitor.textContent = monitorOn ? '🔊 사용자 음성 ON' : '🔇 사용자 음성 OFF';
        for (const { audio } of peers.values()) if (audio) audio.muted = !monitorOn;
    });

    // ── Online / Offline
    const btnOnline = $('btn-online'), btnOffline = $('btn-offline'), hint = $('status-hint');
    btnOnline.addEventListener('click', async () => {
        if (!micStream) {
            try {
                micStream = await navigator.mediaDevices.getUserMedia({ audio: AUDIO(selectedInput) });
                btnMic.disabled = false; btnMic.textContent = '🎤 마이크 꺼짐';
                loadDevices();
            } catch (e) { hint.textContent = '⚠ 마이크 권한 없음 — 음성 없이 진행'; }
        }
        if (micStream) for (const t of micStream.getAudioTracks()) t.enabled = false;
        micOn = false;
        socket.emit('bj-online', { userId: CFG.userId, name: CFG.name });
        btnOnline.classList.add('hidden');
        btnOffline.classList.remove('hidden');
        hint.innerHTML = '<span style="color: var(--c-green);">● 대기 풀에 등록됨</span> — 사용자 요청 대기 중';
    });
    btnOffline.addEventListener('click', () => location.reload());

    // ── Co-watch panel refs
    const cowatchPanel    = $('cowatch-panel');
    const cowatchVideo    = $('cowatch-video');
    const cowatchTitle    = $('cowatch-title');
    const cowatchContentT = $('cowatch-content-title');
    const cowatchUserTime = $('cowatch-user-time');

    // ── Socket events
    socket.on('paired', ({ peerId, peerName, initiator, kind, context }) => {
        if (!startMs) startMs = Date.now();
        startPeer(peerId, peerName, initiator, kind || 'call', context || {});
        renderUserList(kind);
    });
    socket.on('signal', ({ from, data }) => { const e = peers.get(from); if (e && e.peer) e.peer.signal(data); });
    socket.on('peer-hangup', () => {
        for (const e of peers.values()) { try { e.peer.destroy(); } catch(_){} }
        peers.clear();
        renderUserList();
        deactivateSessionCtrl();
    });

    function startPeer(userId, userName, initiator, kind, context) {
        const peer = new SimplePeer({ initiator, trickle: true, stream: micStream || undefined });
        const entry = { peer, dataReady: false, name: userName, kind, context };
        peers.set(userId, entry);
        // ⚠ 캠이 이미 켜져 있으면 **이 peer에도** 트랙을 넣어야 한다.
        //   ensureCamera()는 그 시점에 있던 peer에만 넣고, 두 번째 호출부터는 camStream이
        //   있다며 바로 빠진다. 그래서 사용자가 나갔다 다시 들어오면 새 peer는 영상을 못 받는데
        //   MODE:cam은 보내니까 사용자 화면이 빈 채로 남았다 (2026-09-18 실기기 제보).
        if (camStream) {
            try { for (const t of camStream.getVideoTracks()) peer.addTrack(t, camStream); } catch (_) {}
        }
        peer.on('signal', (d) => socket.emit('signal', { to: userId, data: d }));
        peer.on('connect', () => {
            entry.dataReady = true;
            renderUserList(kind);
            peer.send('L050I500');
            // 세션 컨트롤 활성화 + 현재 모드/제어 상태 전송
            activateSessionCtrl();
            try { peer.send('MODE:' + sessMode); peer.send('CTRL:' + sessCtrlSrc); peer.send('ALLOW:' + (allowDev ? '1' : '0')); } catch(_){}
            // 사용자가 '캠' 옵션으로 진입했으면 자동 캠 모드
            if (context && context.tier === 'cam') setSessMode('cam');
        });
        peer.on('data', (chunk) => {
            const text = chunk.toString();
            // 사용자 → 내 기기 (허용했을 때만). 원격 입력이므로 반드시 sendRemote 로 검증한다.
            if (/^[LR][0-9]/.test(text)) {
                if (!allowDev) return;
                const D = window.PulseDevice;
                if (!D || !D.isConnected) return;
                const n = D.sendRemote(text);
                if (n) { devRecv += n; if (devRecvEl) devRecvEl.textContent = devRecv.toLocaleString(); }
                return;
            }
            // 사용자가 보내는 메시지 — cowatch에서 영상 시간 동기용
            if (text.startsWith('TIME:')) {
                const sec = parseFloat(text.slice(5));
                if (!isNaN(sec) && cowatchVideo) {
                    cowatchUserTime.textContent = `${String(Math.floor(sec/60)).padStart(2,'0')}:${String(Math.floor(sec%60)).padStart(2,'0')}`;
                    // 시간 차이가 1.5초 이상이면 동기
                    if (Math.abs(cowatchVideo.currentTime - sec) > 1.5) cowatchVideo.currentTime = sec;
                }
            }
        });
        peer.on('stream', (stream) => {
            // 사용자 카메라 — 비디오 트랙이 있는 스트림. 마이크와 별도 스트림으로 오므로
            // 여기서 갈라진다 (사용자 쪽이 스트리머 캠을 받을 때와 같은 규칙).
            if (stream.getVideoTracks().length) { showUserCam(stream); return; }
            const audio = new Audio();
            audio.srcObject = stream;
            audio.autoplay = true;
            audio.muted = !monitorOn;
            if (selectedOutput && audio.setSinkId) audio.setSinkId(selectedOutput).catch(()=>{});
            entry.audio = audio;
        });
        peer.on('track', (track, stream) => {          // 재협상으로 나중에 추가된 카메라 트랙
            if (track.kind === 'video') showUserCam(stream);
        });
        peer.on('close', () => { peers.delete(userId); renderUserList(); cowatchPanel.classList.add('hidden'); hideUserCam(); if (peers.size === 0) deactivateSessionCtrl(); });
        peer.on('error', (e) => console.warn('peer err', e));

        // cowatch 모드면 영상 표시
        if (kind === 'cowatch' && context && context.videoPath) {
            cowatchVideo.src = context.videoPath;
            cowatchVideo.muted = true;
            cowatchVideo.play().catch(() => {});
            cowatchContentT.textContent = context.title || `Content #${context.contentId}`;
            cowatchTitle.textContent = 'CO-WATCH · 사용자가 보고 있는 영상';
            cowatchPanel.classList.remove('hidden');
        } else if (kind === 'live-priv') {
            cowatchTitle.textContent = '비공개 라이브 — 카메라 송출';
            cowatchPanel.classList.remove('hidden');
            // BJ 카메라 시작 (간단 버전 — 추가 처리)
            startBJCamera(peer);
        }
    }

    // ── 사용자 제어 허용 ──
    // 기본 ON. 끄면 그 즉시 사용자 명령을 버리고, 상대에게 ALLOW:0 을 보내 패널을 접게 한다.
    const allowDevEl = $('allow-dev'), devRecvEl = $('dev-recv-count');
    let allowDev = allowDevEl ? allowDevEl.checked : true;
    let devRecv = 0;
    if (allowDevEl) allowDevEl.addEventListener('change', () => {
        allowDev = allowDevEl.checked;
        sendToPeers('ALLOW:' + (allowDev ? '1' : '0'));
        // 끄는 순간 기기를 안전 위치로 — 사용자가 밀어둔 위치에 머물지 않게
        if (!allowDev) { const D = window.PulseDevice; if (D && D.isConnected) { try { D.send('L050I300'); } catch (_) {} } }
    });

    // ── 화면 배치 (반반 / 내 화면 크게 / 상대 화면 크게) ──
    // data-layout 하나로 CSS 가 배치한다. 선택은 브라우저에 저장.
    const stage = $('stage'), layoutPicker = $('layout-picker'), stageEmpty = $('stage-empty');
    const LAYOUT_KEY = 'pulse_console_layout';
    function setLayout(v) {
        if (!stage) return;
        const val = ['split', 'me', 'them'].includes(v) ? v : 'them';
        stage.setAttribute('data-layout', val);
        if (layoutPicker) for (const b of layoutPicker.querySelectorAll('[data-layout]')) {
            b.classList.toggle('is-active', b.getAttribute('data-layout') === val);
        }
        try { localStorage.setItem(LAYOUT_KEY, val); } catch (_) {}
    }
    if (layoutPicker) layoutPicker.addEventListener('click', (e) => {
        const b = e.target.closest('[data-layout]'); if (b) setLayout(b.getAttribute('data-layout'));
    });
    let savedLayout = null; try { savedLayout = localStorage.getItem(LAYOUT_KEY); } catch (_) {}
    setLayout(savedLayout || 'them');
    // :has() 를 지원하지 않는 브라우저용 — 상자 표시 상태가 바뀔 때 안내문을 직접 토글
    function syncStageEmpty() {
        if (!stage || !stageEmpty) return;
        const any = Array.from(stage.querySelectorAll('.stage-box')).some(b => !b.classList.contains('hidden'));
        stageEmpty.style.display = any ? 'none' : '';
    }
    if (stage && window.MutationObserver) {
        new MutationObserver(syncStageEmpty).observe(stage, { attributes: true, attributeFilter: ['class'], subtree: true });
    }
    syncStageEmpty();

    // ── 사용자 카메라 표시 ──
    // 사용자가 끄면(removeStream) 트랙이 ended 되므로 그때 패널을 접는다.
    const userCamPanel = $('user-cam-panel'), userCamVideo = $('user-cam-video');
    function showUserCam(stream) {
        if (!userCamPanel || !userCamVideo) return;
        userCamVideo.srcObject = stream;
        userCamVideo.muted = true;                    // 음성은 Audio 요소가 담당 — 겹치면 되먹임
        userCamVideo.play().catch(() => {});
        userCamPanel.classList.remove('hidden');
        for (const t of stream.getVideoTracks()) {
            t.addEventListener('ended', hideUserCam, { once: true });
            t.addEventListener('mute',  hideUserCam, { once: true });
        }
    }
    function hideUserCam() {
        if (!userCamPanel || !userCamVideo) return;
        userCamVideo.srcObject = null;
        userCamPanel.classList.add('hidden');
    }

    async function startBJCamera(peer) {
        try {
            const camStream = await navigator.mediaDevices.getUserMedia({ video: true });
            cowatchVideo.srcObject = camStream;
            cowatchVideo.muted = true;
            cowatchVideo.play().catch(() => {});
            // 비디오 트랙을 peer에 추가
            for (const t of camStream.getVideoTracks()) peer.addTrack(t, camStream);
        } catch (e) { console.warn('카메라 권한 거부', e); }
    }

    const userListEl = $('user-list');
    function renderUserList() {
        if (peers.size === 0) {
            userListEl.innerHTML = '<div class="text-faint text-center" style="padding: 32px; border: 1px dashed var(--border-soft); border-radius: 8px;">대기 중</div>';
            cowatchPanel.classList.add('hidden');
            return;
        }
        userListEl.innerHTML = '';
        for (const [id, e] of peers) {
            const kindBadge = { call: '📞 통화', cowatch: '🎬 함께보기', 'live-priv': '🔴 비공개' }[e.kind] || '📞';
            const div = document.createElement('div');
            div.className = 'card card-body';
            div.style.cssText = 'display:flex;align-items:center;gap:12px;margin-bottom:8px;background:rgba(0,220,130,0.08);border-color:rgba(0,220,130,0.3);padding:12px 16px;';
            div.innerHTML = `<span style="width:10px;height:10px;border-radius:50%;background:var(--c-green);"></span>
                             <span style="flex:1;">${e.name || '사용자'} (${id.slice(0,6)}) <span class="mono text-faint" style="font-size:11px;">${kindBadge}</span></span>
                             <span class="mono text-faint" style="font-size:11px;">${e.dataReady ? 'P2P' : '연결 중'}</span>`;
            userListEl.appendChild(div);
        }
    }
})();
