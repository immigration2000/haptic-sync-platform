/* BJ 공개 라이브 송출 (BJ 측, mesh 토폴로지) */
(function () {
    const CFG = window.__BROADCAST__;
    if (!CFG) return;

    const $ = (id) => document.getElementById(id);
    const myVideo   = $('my-video');
    const btnStart  = $('btn-start');
    const btnStop   = $('btn-stop');
    const bcStatus  = $('bc-status');
    const viewerCnt = $('viewer-count');
    const viewerListEl = $('viewer-list');
    const chatLog   = $('chat-log');
    const chatInp   = $('chat-input');
    const chatSend  = $('chat-send');

    const AUDIO = { echoCancellation:true, noiseSuppression:true, autoGainControl:true };
    let stream = null;
    let socket = null;
    const viewerPeers = new Map(); // viewerId → peer

    btnStart.addEventListener('click', async () => {
        // 카메라 → 실패 시 음성만 → 그것도 실패면 미디어 없이(디바이스 전용 송출). 어떤 경우든 송출은 시작.
        try {
            stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: AUDIO });
            myVideo.srcObject = stream;
        } catch (e) {
            try { stream = await navigator.mediaDevices.getUserMedia({ audio: AUDIO }); if (stream) myVideo.srcObject = stream; }
            catch (e2) { stream = null; }
        }
        socket = io();
        socket.emit('broadcast-start', { userId: CFG.userId, name: CFG.name });
        socket.on('broadcast-ready', () => {
            bcStatus.innerHTML = '<span style="color: var(--c-green);">● 송출 중</span> — 시청자 대기 중';
            btnStart.classList.add('hidden');
            btnStop.classList.remove('hidden');
        });
        socket.on('viewer-incoming', ({ viewerId }) => addViewer(viewerId));
        socket.on('viewer-count', ({ count }) => viewerCnt.textContent = count);
        socket.on('bcast-signal', ({ from, data }) => {
            const p = viewerPeers.get(from);
            if (p) p.signal(data);
        });
        socket.on('viewer-left', ({ viewerId }) => removeViewer(viewerId));
        socket.on('chat-msg', ({ text, sender, ts }) => appendChat(sender, text, ts));

        // 후원 알림 — 서버가 결제 확정 후 방송 룸에 발송 (위조 불가)
        socket.on('donation', ({ from, amount, message }) => {
            appendChat('💎 후원', `${from} 님이 ${Number(amount).toLocaleString()} Ruby!` + (message ? ` — ${message}` : ''), Date.now());
        });
        socket.on('broadcast-ready', () => enableDeviceControl());
    });

    btnStop.addEventListener('click', () => {
        if (socket) socket.emit('broadcast-stop');
        cleanup();
    });

    function addViewer(viewerId) {
        const peer = new SimplePeer({ initiator: true, trickle: true, stream: stream || undefined });
        viewerPeers.set(viewerId, peer);
        peer.on('signal', (d) => socket.emit('bcast-signal', { to: viewerId, data: d }));
        peer.on('close', () => removeViewer(viewerId));
        peer.on('error', () => removeViewer(viewerId));
        renderViewerList();
    }
    function removeViewer(viewerId) {
        const p = viewerPeers.get(viewerId);
        if (p) try { p.destroy(); } catch(_){}
        viewerPeers.delete(viewerId);
        renderViewerList();
    }
    function renderViewerList() {
        if (!viewerPeers.size) { viewerListEl.textContent = '없음'; return; }
        viewerListEl.innerHTML = Array.from(viewerPeers.keys()).map(id => `• ${id.slice(0,8)}`).join('<br>');
    }

    // Chat
    chatSend.addEventListener('click', sendChat);
    chatInp.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendChat(); });
    function sendChat() {
        const text = chatInp.value.trim();
        if (!text || !socket) return;
        socket.emit('chat-msg', { broadcasterUserId: CFG.userId, text, sender: CFG.name });
        chatInp.value = '';
    }
    function appendChat(sender, text, ts) {
        const div = document.createElement('div');
        div.style.marginBottom = '6px';
        const nameEl = document.createElement('span');
        nameEl.style.cssText = 'color: var(--c-pink); font-weight: 600;';
        nameEl.textContent = sender;          // textContent — XSS 차단
        const txtEl = document.createElement('span');
        txtEl.className = 'text-dim';
        txtEl.textContent = ' ' + text;
        div.append(nameEl, txtEl);
        chatLog.appendChild(div);
        chatLog.scrollTop = chatLog.scrollHeight;
    }

    // ── 디바이스 제어 (시청자 전원에게 TCode 브로드캐스트) ──
    const devPanel = $('bcast-device');
    const bdLog = $('bd-log');
    const interpEl = $('bd-interp');
    const bdAxes = { L0: $('bd-L0'), R0: $('bd-R0'), R2: $('bd-R2') };
    let interp = 100, broadcasting = false;

    function enableDeviceControl() {
        broadcasting = true;
        if (devPanel) { devPanel.style.opacity = '1'; devPanel.style.pointerEvents = 'auto'; }
    }
    const Dev = window.PulseDevice;   // 스트리머 본인 디바이스 (우상단에서 연결)
    const bdDevEl = $('bd-dev');
    function renderBdDev(s) {
        if (!bdDevEl) return;
        bdDevEl.innerHTML = s.connected
            ? `<span style="color: var(--c-green); font-weight:600;">● 본인 디바이스 연결됨</span> · ${s.kind === 'serial' ? 'USB' : 'BLE'} — 송신이 본인 기기에도 재생됩니다.`
            : '💡 우상단에서 <strong>본인 디바이스를 연결</strong>하면 같은 동작이 본인 기기에도 재생됩니다(미리보기).';
    }
    if (Dev) { renderBdDev(Dev.getStatus()); Dev.onChange(renderBdDev); }
    function sendTcode(cmd) {
        if (!broadcasting || !socket) return;
        socket.emit('bcast-tcode', { cmd });                 // 시청자 전원
        if (Dev && Dev.isConnected) { try { Dev.send(cmd); } catch (_) {} }  // 본인 디바이스도 같이
        logCmd(cmd);
    }
    function broadcastAxis(axis, pos) { sendTcode(`${axis}${String(pos).padStart(2,'0')}I${interp}`); }
    function logCmd(cmd) {
        if (!bdLog) return;
        const line = document.createElement('div'); line.textContent = '→ ' + cmd;
        bdLog.appendChild(line);
        while (bdLog.children.length > 5) bdLog.removeChild(bdLog.firstChild);
    }
    if (interpEl) interpEl.addEventListener('input', () => { interp = parseInt(interpEl.value, 10); $('bd-interp-v').textContent = interp; });
    Object.keys(bdAxes).forEach(k => {
        const el = bdAxes[k]; if (!el) return;
        el.addEventListener('input', () => { const v = parseInt(el.value, 10); $('bd-' + k + '-v').textContent = v; broadcastAxis(k, v); });
    });
    const DKEYS = { ArrowUp:['L0',+5], ArrowDown:['L0',-5], ArrowLeft:['R0',-5], ArrowRight:['R0',+5], KeyW:['R2',+5], KeyS:['R2',-5] };
    document.addEventListener('keydown', (e) => {
        if (!broadcasting) return;
        if (document.activeElement && document.activeElement.tagName === 'INPUT') return;
        const m = DKEYS[e.code]; if (!m) return;
        e.preventDefault();
        const [k, d] = m, el = bdAxes[k]; if (!el) return;
        const v = Math.max(0, Math.min(99, parseInt(el.value, 10) + d));
        el.value = v; $('bd-' + k + '-v').textContent = v; broadcastAxis(k, v);
    });

    function cleanup() {
        for (const p of viewerPeers.values()) try { p.destroy(); } catch(_){}
        viewerPeers.clear();
        if (stream) for (const t of stream.getTracks()) t.stop();
        stream = null;
        if (socket) socket.disconnect();
        socket = null;
        broadcasting = false;
        if (devPanel) { devPanel.style.opacity = '0.5'; devPanel.style.pointerEvents = 'none'; }
        btnStart.classList.remove('hidden');
        btnStop.classList.add('hidden');
        bcStatus.textContent = '송출 종료';
        viewerCnt.textContent = '0';
        renderViewerList();
    }

    window.addEventListener('beforeunload', () => { if (socket) socket.emit('broadcast-stop'); });
})();
