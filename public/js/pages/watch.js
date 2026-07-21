/* 공개 라이브 시청자 측 */
(function () {
    const CFG = window.__WATCH__;
    if (!CFG) return;
    const $ = (id) => document.getElementById(id);
    const bjVideo = $('bj-video');
    const stateEl = $('w-state');
    const elapsedEl = $('w-elapsed');
    const viewerCntEl = $('w-viewer-count');
    const chatLog = $('chat-log');
    const chatInp = $('chat-input');
    const chatSend = $('chat-send');
    const btnLeave = $('btn-leave');

    const socket = io();
    let peer = null;
    let startMs = 0;
    let elapsedTimer = null;

    // ── 디바이스: 스트리머 제어 수신 ──
    const Dev = window.PulseDevice;
    const devStatusEl = $('w-dev-status');
    const devRecvEl = $('w-dev-recv');
    let devRecv = 0;
    function renderDev(s) {
        if (!devStatusEl) return;
        devStatusEl.innerHTML = s.connected
            ? `<span style="color: var(--c-green); font-weight:600;">● 연결됨</span> · ${s.kind === 'serial' ? 'USB' : 'BLE'} — 스트리머 제어 수신 중`
            : '우상단 메뉴에서 디바이스를 연결하면 스트리머의 실시간 제어를 받습니다.';
    }
    if (Dev) { renderDev(Dev.getStatus()); Dev.onChange(renderDev); }
    socket.on('bcast-tcode', ({ cmd }) => {
        if (Dev && Dev.isConnected) Dev.send(cmd);
        devRecv++; if (devRecvEl) devRecvEl.textContent = devRecv.toLocaleString();
    });

    socket.emit('viewer-join', { broadcasterUserId: CFG.bjUserId });

    socket.on('viewer-ready', ({ broadcasterId, broadcasterName }) => {
        stateEl.innerHTML = `<span style="color: var(--c-green); font-weight:600;">● LIVE</span> — ${broadcasterName}`;
        peer = new SimplePeer({ initiator: false, trickle: true });
        peer.on('signal', (d) => socket.emit('bcast-signal', { to: broadcasterId, data: d }));
        peer.on('stream', (stream) => {
            bjVideo.srcObject = stream;
            bjVideo.play().catch(()=>{});
            startMs = Date.now();
            elapsedTimer = setInterval(() => {
                const s = Math.floor((Date.now() - startMs) / 1000);
                elapsedEl.textContent = `${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;
            }, 1000);
        });
        peer.on('close', () => endWatch(true));
        peer.on('error', (e) => console.warn(e));
    });

    socket.on('bcast-signal', ({ data }) => peer && peer.signal(data));
    socket.on('viewer-count', ({ count }) => viewerCntEl.textContent = count);
    socket.on('broadcast-ended', () => endWatch(true));
    socket.on('viewer-failed', () => { stateEl.innerHTML = '<span style="color: var(--c-pink);">⚠ BJ 오프라인</span>'; });
    socket.on('chat-msg', ({ text, sender, ts }) => {
        const div = document.createElement('div');
        div.style.marginBottom = '4px';
        const nameEl = document.createElement('span');
        nameEl.style.cssText = 'color: var(--c-pink); font-weight: 600;';
        nameEl.textContent = sender;          // textContent — XSS 차단
        const txtEl = document.createElement('span');
        txtEl.className = 'text-dim';
        txtEl.textContent = ' ' + text;
        div.append(nameEl, txtEl);
        chatLog.appendChild(div);
        chatLog.scrollTop = chatLog.scrollHeight;
    });

    chatSend.addEventListener('click', sendChat);
    chatInp.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendChat(); });
    function sendChat() {
        const text = chatInp.value.trim();
        if (!text) return;
        socket.emit('chat-msg', { broadcasterUserId: CFG.bjUserId, text, sender: CFG.myName });
        chatInp.value = '';
    }

    btnLeave.addEventListener('click', () => endWatch(false));

    function endWatch(remote) {
        if (peer) { try { peer.destroy(); } catch(_){} peer = null; }
        if (elapsedTimer) clearInterval(elapsedTimer);
        socket.emit('viewer-leave');
        socket.disconnect();
        stateEl.textContent = remote ? '방송이 종료되었습니다' : '시청 종료';
        setTimeout(() => location.href = '/bj/live-lobby', 1500);
    }
})();
