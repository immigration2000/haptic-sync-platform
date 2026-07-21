/* BJ 비공개 라이브 — 사용자 측 (1:1 영상+음성+디바이스)
 */
(function () {
    const CFG = window.__LIVE_PRIV__;
    if (!CFG) return;

    const $ = (id) => document.getElementById(id);
    const bjVideo  = $('bj-video');
    const myVideo  = $('my-video');
    const stateEl  = $('lp-state');
    const elapsedEl= $('lp-elapsed');
    const chargeEl = $('lp-charge');
    const recvEl   = $('lp-recv');
    const actsEl   = $('lp-actions');
    const btnMic   = $('btn-mic');
    const btnCam   = $('btn-cam');
    const btnHang  = $('btn-hangup');
    const devStatusEl = $('player-dev-status');

    const Dev = window.PulseDevice;
    if (Dev) {
        const render = (s) => {
            devStatusEl.innerHTML = s.connected
                ? `<span style="color: var(--c-green);">● 연결됨</span> · ${s.kind === 'serial' ? 'USB' : 'BLE'}`
                : '<span class="text-faint">미연결 — 우상단에서 연결</span>';
        };
        render(Dev.getStatus()); Dev.onChange(render);
    }

    const AUDIO = { echoCancellation:true, noiseSuppression:true, autoGainControl:true, channelCount:1 };
    let socket = io();
    let peer = null;
    let micStream = null;
    let camStream = null;
    let micOn = false;
    let camOn = false;
    let recvCount = 0;
    let session = null;
    let startMs = 0;
    let elapsedTimer = null;

    (async () => {
        try {
            micStream = await navigator.mediaDevices.getUserMedia({ audio: AUDIO });
            for (const t of micStream.getAudioTracks()) t.enabled = false;
        } catch (e) {}
        socket.emit('user-enter');
    })();

    let attempted = false;
    socket.on('bj-list', (list) => {
        if (attempted) return;
        const bj = list.find(b => b.userId === CFG.bjUserId);
        if (!bj) return;
        attempted = true;
        socket.emit('user-call', { bjSocketId: bj.id, bjUserIdTarget: CFG.bjUserId, kind: 'live-priv', context: {} });
        stateEl.textContent = '연결 중…';
    });
    setTimeout(() => {
        if (!attempted && !peer) {
            stateEl.innerHTML = '<span style="color: var(--c-pink);">⚠ 해당 BJ가 현재 오프라인입니다</span>';
        }
    }, 3000);

    socket.on('paired', ({ peerId, peerName, initiator }) => {
        actsEl.classList.remove('hidden');
        stateEl.innerHTML = `<span style="color: var(--c-green); font-weight:600;">● 비공개 라이브 중</span> — ${peerName}`;
        startPeer(peerId, initiator);
    });
    socket.on('signal', ({ data }) => peer && peer.signal(data));
    socket.on('peer-hangup', () => endCall(true));
    socket.on('call-failed', ({ reason }) => {
        const msg = reason === 'BJ_BUSY' ? '⚠ 다른 통화 중입니다. 잠시 후 다시 시도해주세요.'
                  : reason === 'BJ_OFFLINE' ? '⚠ 해당 BJ가 오프라인입니다.'
                  : '⚠ 통화 실패';
        stateEl.innerHTML = `<span style="color: var(--c-pink);">${msg}</span>`;
    });

    function startPeer(peerId, initiator) {
        peer = new SimplePeer({ initiator, trickle: true, stream: micStream || undefined });
        peer.on('signal', (d) => socket.emit('signal', { to: peerId, data: d }));
        peer.on('connect', () => {
            startMs = Date.now();
            elapsedTimer = setInterval(() => {
                const s = Math.floor((Date.now() - startMs) / 1000);
                elapsedEl.textContent = `${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;
            }, 1000);
            if (chargeEl) chargeEl.textContent = '무료 체험 중';
            // 무료 체험 → 결제 시퀀스
            if (window.PulseSession) {
                session = window.PulseSession.create({
                    bjUserId: CFG.bjUserId, peerName: CFG.bjName, kind: 'live-priv',
                    onTerminate: () => endCall(false),
                });
                session.startFreePreview();
            }
        });
        peer.on('data', (chunk) => {
            const text = chunk.toString();
            for (const cmd of text.trim().split(/\s+/)) {
                if (!cmd) continue;
                if (/^[LR][0-9]\d{1,3}I\d+/.test(cmd)) {
                    if (Dev && Dev.isConnected) Dev.send(cmd);
                    recvCount++;
                    recvEl.textContent = recvCount.toLocaleString() + ' cmd';
                }
            }
        });
        peer.on('stream', (stream) => {
            // BJ 카메라 + 음성
            bjVideo.srcObject = stream;
            bjVideo.play().catch(() => {});
        });
        peer.on('track', (track, stream) => {
            // 추가 트랙 (예: BJ 비디오 트랙)
            if (track.kind === 'video') {
                bjVideo.srcObject = stream;
            }
        });
        peer.on('close', () => endCall(false));
        peer.on('error', (e) => console.warn('peer err', e));
    }

    btnMic.addEventListener('click', () => {
        if (!micStream) return;
        micOn = !micOn;
        for (const t of micStream.getAudioTracks()) t.enabled = micOn;
        btnMic.classList.toggle('btn-primary', micOn);
        btnMic.classList.toggle('btn-secondary', !micOn);
        btnMic.textContent = micOn ? '🎤 ON' : '🎤';
    });

    btnCam.addEventListener('click', async () => {
        if (camOn) {
            for (const t of camStream.getTracks()) t.stop();
            camStream = null;
            camOn = false;
            myVideo.style.display = 'none';
            btnCam.textContent = '📹 내 카메라';
            btnCam.classList.replace('btn-primary', 'btn-secondary');
            return;
        }
        try {
            camStream = await navigator.mediaDevices.getUserMedia({ video: true });
            myVideo.srcObject = camStream;
            myVideo.style.display = 'block';
            camOn = true;
            btnCam.textContent = '📹 ON';
            btnCam.classList.replace('btn-secondary', 'btn-primary');
            if (peer) for (const t of camStream.getVideoTracks()) peer.addTrack(t, camStream);
        } catch (e) { console.warn(e); }
    });

    btnHang.addEventListener('click', () => { socket && socket.emit('hangup'); endCall(false); });

    let ending = false;
    function endCall(remote) {
        if (ending) return; ending = true;
        if (session)     { try { session.destroy(); } catch (_) {} session = null; }
        if (peer)        { try { peer.destroy(); } catch (_) {} peer = null; }
        if (micStream)   { for (const t of micStream.getTracks()) t.stop(); micStream = null; }
        if (camStream)   { for (const t of camStream.getTracks()) t.stop(); camStream = null; }
        if (elapsedTimer){ clearInterval(elapsedTimer); }
        if (socket)      { socket.disconnect(); socket = null; }
        stateEl.textContent = remote ? 'BJ가 종료했습니다' : '종료됨';
        if (Dev && Dev.isConnected) Dev.send('L050I500');
        setTimeout(() => location.href = '/bj', 1500);
    }
})();
