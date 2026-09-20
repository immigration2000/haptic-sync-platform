/* BJ Call — 통화 세션 룸 (사용자측)
 * 통화 허브: BJ가 데이터채널로 모드/영상/제어를 주도. 사용자는 따라감.
 *
 * BJ → 사용자 데이터채널 프로토콜:
 *   MODE:call            통화 전용 (영상 숨김, 디바이스=BJ 수동)
 *   MODE:video           영상 시청 모드
 *   VIDEO:<path>|<fs>    이 영상 재생 (fs=funscript 경로, 없으면 빈값)
 *   CTRL:script          영상 모드 디바이스 = funscript 자동
 *   CTRL:manual          디바이스 = BJ 수동(TCode)
 *   L0xxIyyy ...         TCode (BJ 수동 조작)
 */
(function () {
    const CFG = window.__BJ_CALL__;
    if (!CFG) return;

    const $ = (id) => document.getElementById(id);
    const stateEl   = $('call-state');
    const modeEl    = $('call-mode');
    const ctrlEl    = $('call-ctrl');
    const elapsedEl = $('call-elapsed');
    const recvEl    = $('call-recv-count');
    const devEl     = $('call-device');
    const actsStart = $('call-actions-start');
    const actsLive  = $('call-actions-live');
    const btnStart  = $('btn-start');
    const btnMic    = $('btn-mic');
    const btnCam    = $('btn-cam');
    const myCam     = $('my-cam');
    const btnHangup = $('btn-hangup');

    const callView  = $('session-call-view');
    const videoView = $('session-video-view');
    const video     = $('session-video');
    const videoBadge= $('session-video-badge');

    const Dev = window.PulseDevice;
    const FS  = window.PulseFunscript;
    let socket = null, peer = null, micStream = null, micOn = false;
    let recvCount = 0, startMs = 0, elapsedTimer = null, session = null;
    let mode = 'call';        // call | video
    let ctrl = 'manual';      // script | manual
    let fsEngine = null;      // funscript 자동 엔진
    let fsLoadSeq = 0;        // 비동기 로드 취소 토큰
    let streamerStream = null; // 스트리머 캠 영상 스트림 (캠 모드)

    const AUDIO = { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 };

    function renderDev(s) { devEl.textContent = s.connected ? `연결됨 (${s.kind === 'serial' ? 'USB' : 'BLE'})` : '미연결'; }
    if (Dev) { renderDev(Dev.getStatus()); Dev.onChange(renderDev); }

    btnStart.addEventListener('click', async () => {
        try {
            micStream = await navigator.mediaDevices.getUserMedia({ audio: AUDIO });
            for (const t of micStream.getAudioTracks()) t.enabled = false;
        } catch (e) { console.warn('mic denied', e); }
        socket = io();
        let attempted = false;
        socket.emit('user-enter');
        socket.on('bj-list', (list) => {
            if (attempted) return;
            const bj = list.find(b => b.userId === CFG.bjId);
            if (!bj) return;
            attempted = true;
            const tierEl = document.querySelector('input[name=tier]:checked');
            const tier = tierEl ? tierEl.value : 'voice_1on1';
            socket.emit('user-call', { bjSocketId: bj.id, bjUserIdTarget: CFG.bjId, kind: 'call', context: { tier } });
            stateEl.textContent = '연결 중…';
        });
        setTimeout(() => {
            if (!attempted && !peer) {
                stateEl.innerHTML = '<span style="color: var(--c-pink);">⚠ 해당 BJ가 현재 오프라인입니다</span>';
                actsStart.classList.add('hidden');
            }
        }, 3000);
        socket.on('paired', ({ peerId, peerName, initiator }) => {
            actsStart.classList.add('hidden');
            actsLive.classList.remove('hidden');
            stateEl.innerHTML = `<span style="color: var(--c-green); font-weight:600;">● 통화 중</span> — ${peerName}`;
            modeEl.textContent = '통화 전용';
            startPeer(peerId, initiator);
        });
        socket.on('signal', ({ from, data }) => peer && peer.signal(data));
        socket.on('peer-hangup', () => endCall(true));
        socket.on('call-failed', ({ reason }) => {
            const msg = reason === 'BJ_BUSY' ? '⚠ 다른 통화 중입니다. 잠시 후 다시.'
                      : reason === 'BJ_OFFLINE' ? '⚠ 해당 스트리머가 오프라인입니다.'
                      : reason === 'SERVICE_NOT_OFFERED' ? '⚠ 이 스트리머는 해당 통화를 제공하지 않습니다.'
                      : '⚠ 통화 실패';
            stateEl.innerHTML = `<span style="color: var(--c-pink);">${msg}</span>`;
            actsStart.classList.add('hidden');
        });
    });

    function startPeer(peerId, initiator) {
        peer = new SimplePeer({ initiator, trickle: true, stream: micStream || undefined });
        peer.on('signal', (data) => socket.emit('signal', { to: peerId, data }));
        peer.on('connect', () => {
            if (btnCam) btnCam.disabled = false;
            startMs = Date.now();
            elapsedTimer = setInterval(() => {
                const s = Math.floor((Date.now() - startMs) / 1000);
                elapsedEl.textContent = `${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;
            }, 1000);
            if (window.PulseSession) {
                session = window.PulseSession.create({
                    bjUserId: CFG.bjId, peerName: CFG.bjName, kind: 'call',
                    onTerminate: () => endCall(false),
                });
                session.startFreePreview();
            }
        });
        peer.on('data', (chunk) => handleBJData(chunk.toString()));
        peer.on('stream', (stream) => {
            if (stream.getVideoTracks().length) {            // 스트리머 캠 영상
                streamerStream = stream; if (mode === 'cam') attachCam();
            } else {                                          // 음성(마이크)
                const a = new Audio(); a.srcObject = stream; a.autoplay = true;
            }
        });
        peer.on('track', (track, stream) => {                 // 재협상으로 추가된 캠 트랙
            if (track.kind === 'video') { streamerStream = stream; if (mode === 'cam') attachCam(); }
        });
        peer.on('close', () => endCall(false));
        peer.on('error', (e) => { console.warn('peer error', e); endCall(false); });
    }

    // ── BJ 신호 처리 ──
    function handleBJData(text) {
        for (const line of text.split('\n')) {
            const t = line.trim();
            if (!t) continue;
            if (t.startsWith('MODE:'))      setMode(t.slice(5));
            else if (t.startsWith('VIDEO:')) loadVideo(t.slice(6));
            else if (t.startsWith('CTRL:'))  setCtrl(t.slice(5));
            else if (t.startsWith('ALLOW:')) setCtlAllowed(t.slice(6) === '1');
            else if (/^[LR][0-9]/.test(t)) {
                // 스트리머 수동 TCode. 검증·기기 전달은 공용 receive (토큰별 sendRemote).
                // 통화만 있는 조건 — 통화모드 또는 영상 manual 일 때만 — 은 게이트로 넘긴다.
                if (window.PulseAxisControl) window.PulseAxisControl.receive(t, {
                    gate: () => (mode === 'call' || ctrl === 'manual'),
                    onCount: (n) => { recvCount += n; recvEl.textContent = recvCount.toLocaleString() + ' cmd'; },
                });
            }
        }
    }

    function attachCam() {
        if (!streamerStream || !video) return;
        try {
            video.pause();
            video.removeAttribute('src');
            video.srcObject = streamerStream;   // 스트리머 캠 영상 표시
            video.muted = true;                 // 스트리머 음성은 별도 마이크 스트림으로 재생
            video.play().catch(() => {});
        } catch (_) {}
    }

    function setMode(m) {
        mode = (m === 'video') ? 'video' : (m === 'cam') ? 'cam' : 'call';
        modeEl.textContent = (mode === 'video') ? '영상 시청' : (mode === 'cam') ? '스트리머 캠 (1:1)' : '통화 전용';
        if (mode === 'video' || mode === 'cam') {
            callView.classList.add('hidden');
            videoView.classList.remove('hidden');
            if (mode === 'cam') {
                stopFsEngine();
                videoBadge.textContent = '📷 스트리머 캠';
                videoBadge.classList.remove('hidden');
                attachCam();
            }
        } else {
            videoView.classList.add('hidden');
            callView.classList.remove('hidden');
            stopFsEngine();
            if (video) { try { video.pause(); } catch(_){} }
        }
    }

    function loadVideo(payload) {
        const [path, fsPath] = payload.split('|');
        if (!path) return;
        setMode('video');
        videoBadge.textContent = '🎬 스트리머가 재생 중';
        videoBadge.classList.remove('hidden');
        if (video.srcObject) { try { video.srcObject = null; } catch(_){} }   // 캠 → 파일영상 전환 시 정리
        video.src = path;
        video.currentTime = 0;
        video.play().catch(() => {});
        // funscript 준비 (CTRL:script일 때 사용)
        video.dataset.fs = fsPath || '';
        if (ctrl === 'script') startFsEngine();
    }

    function setCtrl(c) {
        ctrl = (c === 'script') ? 'script' : 'manual';
        ctrlEl.textContent = (ctrl === 'script') ? '영상 스크립트(자동)' : 'BJ 수동';
        if (ctrl === 'script' && mode === 'video') startFsEngine();
        else stopFsEngine();
    }

    function startFsEngine() {
        stopFsEngine();
        const fsPath = video.dataset.fs;
        if (!fsPath || !FS) return;
        const myLoad = ++fsLoadSeq;
        FS.loadMultiAxis(fsPath).then((axes) => {
            if (myLoad !== fsLoadSeq) return;   // 로드 중 정지/재시작됨 → 고아 엔진 방지
            if (!Object.keys(axes).length) return;
            fsEngine = new FS.MultiAxisEngine({
                video, axes, intensityGetter: () => 1, sendOnce: true,
                onCommand: (cmd) => { if (ctrl === 'script' && Dev && Dev.isConnected) Dev.send(cmd); },
            });
            fsEngine.start();
        });
    }
    function stopFsEngine() { fsLoadSeq++; if (fsEngine) { try { fsEngine.stop(); } catch(_){} fsEngine = null; } }
    video.addEventListener('seeking', () => { if (fsEngine) fsEngine.resync(); });

    // ── 스트리머 기기 제어 (사용자 → 스트리머 기기) ──
    // 스트리머가 ALLOW:1 을 보내야만 패널이 열린다. 하드웨어를 몸에 연결한 쪽이 통제권을 가진다.
    // 송신은 PulseAxisControl 이 33ms 병합 + 변화율 제한으로 내보낸다 (노트북이 실기기로 검증한 수치).
    const ctlPanel = $('ctl-panel'), ctlState = $('ctl-state'), sendCountEl = $('call-send-count');
    let ctlAllowed = false;

    // 슬라이더·키보드·속도제한·명령 조립은 PulseAxisControl (방송·콘솔과 같은 코드).
    // 사용자 화면이 다른 부분은 전송로(P2P 데이터채널)와 게이트(스트리머 허용)뿐.
    const axisCtl = window.PulseAxisControl && window.PulseAxisControl.bind({
        axes: { L0: { el: $('ctl-L0'), val: $('ctl-L0-v') },
                R0: { el: $('ctl-R0'), val: $('ctl-R0-v') },
                R2: { el: $('ctl-R2'), val: $('ctl-R2-v') } },
        interpEl: $('ctl-interp'), interpVal: $('ctl-interp-v'),
        send: (line) => {
            if (!peer || !ctlAllowed) return;
            try { peer.send(line); } catch (_) { return; }
            if (sendCountEl && axisCtl) sendCountEl.textContent = axisCtl.sender.sentCount.toLocaleString() + ' cmd';
        },
        enabled: () => ctlAllowed,
    });
    function setCtlAllowed(on) {
        ctlAllowed = !!on;
        if (ctlPanel) ctlPanel.classList.toggle('hidden', !ctlAllowed);
        if (ctlState) ctlState.textContent = ctlAllowed ? '허용됨' : '스트리머가 꺼둠';
        if (!ctlAllowed && axisCtl) axisCtl.sender.stop();
    }

    // ── 내 카메라 → 스트리머 ──
    // 마이크와 **다른 스트림**으로 보낸다. 같은 스트림에 트랙을 얹으면 스트리머 쪽에서
    // 이미 Audio 요소에 물린 스트림이라 영상이 안 보인다. 별도 스트림이면 'stream' 이벤트가
    // 새로 뜨고 비디오 트랙 유무로 분기할 수 있다 (스트리머 캠을 받는 쪽과 같은 규칙).
    // 기본 OFF — 사용자가 직접 눌러야만 켜진다.
    let camStream = null, camOn = false;
    async function setCam(on) {
        if (!peer) return;
        if (on) {
            try { camStream = await navigator.mediaDevices.getUserMedia({ video: true }); }
            catch (_) { stateEl.textContent = '카메라 권한이 없습니다'; return; }
            try { peer.addStream(camStream); } catch (e) { console.warn('addStream', e); }
            if (myCam) { myCam.srcObject = camStream; myCam.classList.remove('hidden'); }
            camOn = true;
        } else {
            if (camStream) {
                try { peer.removeStream(camStream); } catch (_) {}
                for (const t of camStream.getTracks()) t.stop();
                camStream = null;
            }
            if (myCam) { myCam.srcObject = null; myCam.classList.add('hidden'); }
            camOn = false;
        }
        if (btnCam) {
            btnCam.classList.toggle('btn-primary', camOn);
            btnCam.classList.toggle('btn-secondary', !camOn);
            btnCam.textContent = camOn ? '📷 ON' : '📷 카메라';
        }
    }
    if (btnCam) btnCam.addEventListener('click', () => setCam(!camOn));

    btnMic.addEventListener('click', () => {
        if (!micStream) return;
        micOn = !micOn;
        for (const t of micStream.getAudioTracks()) t.enabled = micOn;
        btnMic.classList.toggle('btn-primary', micOn);
        btnMic.classList.toggle('btn-secondary', !micOn);
        btnMic.textContent = micOn ? '🎤 ON' : '🎤 마이크';
    });

    btnHangup.addEventListener('click', () => endCall(false));

    let ending = false;
    function endCall(remote) {
        if (ending) return; ending = true;
        stopFsEngine();
        if (session)     { try { session.destroy(); } catch (_) {} session = null; }
        if (peer)        { try { peer.destroy(); } catch (_) {} peer = null; }
        if (micStream)   { for (const t of micStream.getTracks()) t.stop(); micStream = null; }
        if (camStream)   { for (const t of camStream.getTracks()) t.stop(); camStream = null; }
        if (axisCtl)     { try { axisCtl.stop(); } catch (_) {} }
        if (elapsedTimer){ clearInterval(elapsedTimer); elapsedTimer = null; }
        if (socket)      { socket.emit('hangup'); socket.disconnect(); socket = null; }
        stateEl.textContent = remote ? 'BJ가 종료했습니다' : '종료됨';
        if (Dev && Dev.isConnected) Dev.send('L050I500');
        setTimeout(() => location.href = '/bj', 1500);
    }
})();
