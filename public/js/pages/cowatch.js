/* BJ 함께보기 — 사용자 측
 * - 영상 재생
 * - WebRTC: 음성 + 데이터채널 (BJ→사용자 명령, 사용자→BJ 영상시간)
 * - 디바이스 모드 토글: script (funscript 자동) / manual (BJ가 보내는 명령만)
 */
(function () {
    const CFG = window.__COWATCH__;
    if (!CFG) return;

    const video = document.getElementById('player-video');
    const $ = (id) => document.getElementById(id);
    const stateEl   = $('cw-state');
    const elapsedEl = $('cw-elapsed');
    const dmodeEl   = $('cw-dmode');
    const recvEl    = $('cw-recv');
    const actsEl    = $('cw-actions');
    const btnMic    = $('btn-mic');
    const btnHang   = $('btn-hangup');
    const btnModeS  = $('btn-mode-script');
    const btnModeM  = $('btn-mode-manual');
    const devStatusEl = $('player-dev-status');
    const intensitySlider = $('intensity-slider');
    const intensityValue  = $('intensity-value');

    const Dev = window.PulseDevice;
    const FS  = window.PulseFunscript;

    let socket = io();
    let peer = null;
    let micStream = null;
    let micOn = false;
    let intensity = 1.0;
    let mode = 'script'; // 'script' | 'manual'
    let engine = null;
    let recvCount = 0;
    let session = null;
    let startMs = 0;
    let elapsedTimer = null;
    let timeSyncTimer = null;

    const AUDIO = { echoCancellation:true, noiseSuppression:true, autoGainControl:true, channelCount:1 };

    function renderDev(s) {
        devStatusEl.innerHTML = s.connected
            ? `<span style="color: var(--c-green); font-weight:600;">● 연결됨</span> · ${s.kind === 'serial' ? 'USB' : 'BLE'}`
            : '<span class="text-faint">미연결 — 우상단에서 연결</span>';
    }
    if (Dev) { renderDev(Dev.getStatus()); Dev.onChange(renderDev); }

    intensitySlider.addEventListener('input', () => {
        intensity = parseInt(intensitySlider.value, 10) / 100;
        intensityValue.textContent = intensitySlider.value + '%';
    });

    function setMode(m) {
        mode = m;
        btnModeS.classList.toggle('btn-primary', m === 'script');
        btnModeS.classList.toggle('btn-ghost',   m !== 'script');
        btnModeM.classList.toggle('btn-primary', m === 'manual');
        btnModeM.classList.toggle('btn-ghost',   m !== 'manual');
        dmodeEl.textContent = m === 'script' ? '자동 (스크립트)' : 'BJ 수동 조작';
        // 엔진 on/off
        if (engine) {
            if (m === 'script') engine.start();
            else engine.stop();
        }
        // BJ에게도 모드 전달
        if (peer && peer.connected) {
            try { peer.send(`MODE:${m}`); } catch(_){}
        }
    }
    btnModeS.addEventListener('click', () => setMode('script'));
    btnModeM.addEventListener('click', () => setMode('manual'));

    // funscript 로드
    if (CFG.fsPath && FS) {
        FS.loadMultiAxis(CFG.fsPath).then((axes) => {
            if (!Object.keys(axes).length) return;
            engine = new FS.MultiAxisEngine({
                video, axes,
                intensityGetter: () => intensity,
                sendOnce: true,
                onCommand: (cmd) => { if (mode === 'script') Dev && Dev.send(cmd); },
            });
            if (mode === 'script') engine.start();
        });
    }

    // ── 자동 통화 시작
    (async () => {
        try {
            micStream = await navigator.mediaDevices.getUserMedia({ audio: AUDIO });
            for (const t of micStream.getAudioTracks()) t.enabled = false;
        } catch (e) { console.warn('mic denied', e); }
        socket.emit('user-enter');
    })();

    let attempted = false;
    socket.on('bj-list', (list) => {
        if (attempted) return;
        const bj = list.find(b => b.userId === CFG.bjUserId);
        if (!bj) return;
        attempted = true;
        socket.emit('user-call', {
            bjSocketId: bj.id,
            bjUserIdTarget: CFG.bjUserId,
            kind: 'cowatch',
            context: {
                contentId: CFG.contentId,
                videoPath: video.src,
                title: document.querySelector('.player-title')?.textContent,
            },
        });
        stateEl.textContent = '연결 중…';
    });
    setTimeout(() => {
        if (!attempted && !peer) {
            stateEl.innerHTML = '<span style="color: var(--c-pink);">⚠ 해당 BJ가 현재 오프라인입니다</span>';
        }
    }, 3000);

    socket.on('paired', ({ peerId, peerName, initiator }) => {
        actsEl.classList.remove('hidden');
        stateEl.innerHTML = `<span style="color: var(--c-green); font-weight:600;">● 함께보기 중</span> — ${peerName}`;
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
            // 영상 시간 동기 (1초마다)
            timeSyncTimer = setInterval(() => {
                if (peer && peer.connected && !video.paused) {
                    try { peer.send(`TIME:${video.currentTime.toFixed(2)}`); } catch(_){}
                }
            }, 1000);
            // 모드 알림
            try { peer.send(`MODE:${mode}`); } catch(_){}
            // 무료 체험 → 결제 시퀀스
            if (window.PulseSession) {
                session = window.PulseSession.create({
                    bjUserId: CFG.bjUserId, peerName: CFG.bjName, kind: 'cowatch',
                    onTerminate: () => endCall(false),
                });
                session.startFreePreview();
            }
        });
        peer.on('data', (chunk) => {
            const text = chunk.toString();
            // BJ가 보낸 명령 — manual 모드에서만 디바이스에 전달
            for (const cmd of text.trim().split(/\s+/)) {
                if (!cmd) continue;
                if (/^[LR][0-9]\d{1,3}I\d+/.test(cmd)) {
                    if (mode === 'manual' && Dev && Dev.isConnected) Dev.send(cmd);
                    recvCount++;
                    recvEl.textContent = recvCount.toLocaleString() + ' cmd';
                }
            }
        });
        peer.on('stream', (stream) => {
            const audio = new Audio();
            audio.srcObject = stream;
            audio.autoplay = true;
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
        btnMic.textContent = micOn ? '🎤 ON' : '🎤 마이크';
    });
    btnHang.addEventListener('click', () => { if (socket) socket.emit('hangup'); endCall(false); });

    video.addEventListener('seeking', () => {
        engine && engine.resync();
        if (peer && peer.connected) try { peer.send(`TIME:${video.currentTime.toFixed(2)}`); } catch(_){}
    });
    video.addEventListener('pause', () => Dev && Dev.send('L050I300'));
    video.addEventListener('ended', () => Dev && Dev.send('L050I500'));

    let ending = false;
    function endCall(remote) {
        if (ending) return; ending = true;
        if (session)     { try { session.destroy(); } catch (_) {} session = null; }
        if (peer)        { try { peer.destroy(); } catch (_) {} peer = null; }
        if (micStream)   { for (const t of micStream.getTracks()) t.stop(); micStream = null; }
        if (elapsedTimer){ clearInterval(elapsedTimer); }
        if (timeSyncTimer){ clearInterval(timeSyncTimer); }
        if (socket)      { socket.disconnect(); socket = null; }
        stateEl.textContent = remote ? 'BJ가 종료했습니다' : '종료됨';
        if (Dev && Dev.isConnected) Dev.send('L050I500');
        setTimeout(() => location.href = `/content/play/${CFG.contentId}`, 1500);
    }
})();
