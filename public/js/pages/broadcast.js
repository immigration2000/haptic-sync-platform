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
        // 방송 모드 — voice(음성방송·스푼형) | video(영상방송). 화면에서 고른 값.
        // 최종 확정은 서버가 서비스 태그로 검증해서 broadcast-ready로 돌려준다.
        const sel = document.querySelector('input[name="bcast-mode"]:checked');
        const wantMode = sel ? sel.value : 'video';

        if (wantMode === 'voice') {
            // 음성 방송은 카메라를 아예 요청하지 않는다 (불필요한 권한 요청 방지)
            try { stream = await navigator.mediaDevices.getUserMedia({ audio: AUDIO }); }
            catch (e) { stream = null; }
        } else {
            // 카메라 → 실패 시 음성만 → 그것도 실패면 미디어 없이(디바이스 전용 송출).
            try {
                stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: AUDIO });
                myVideo.srcObject = stream;
            } catch (e) {
                try { stream = await navigator.mediaDevices.getUserMedia({ audio: AUDIO }); if (stream) myVideo.srcObject = stream; }
                catch (e2) { stream = null; }
            }
        }
        socket = io();
        socket.emit('broadcast-start', { mode: wantMode });
        socket.on('broadcast-ready', (info) => {
            const mode = (info && info.mode) || wantMode;
            if (mode === 'voice') {
                myVideo.style.display = 'none';
                const ph = document.getElementById('voice-placeholder');
                if (ph) ph.style.display = 'flex';
            }
            bcStatus.innerHTML = '<span style="color: var(--c-green);">● 송출 중</span> — '
                + (mode === 'voice' ? '📻 음성 방송' : '📺 영상 방송') + ' · 시청자 대기 중';
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
        if (typeof bsPlay !== 'undefined' && bsPlay) bsPlay.disabled = !scriptAxes;
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

    // ── 스크립트 재생 ─────────────────────────────────────────
    // 슬라이더를 손으로 움직이는 대신 funscript가 값을 만든다.
    // **나가는 경로는 슬라이더와 완전히 같다** — sendTcode() → bcast-tcode.
    // 그래서 시청자 쪽은 아무것도 안 바꿔도 된다.
    const bsFile = $('bs-file'), bsPlay = $('bs-play'), bsStop = $('bs-stop');
    const bsState = $('bs-state'), bsTime = $('bs-time');
    let scriptAxes = null, scriptEngine = null, scriptEndMs = 0, bsTimer = null;

    // 엔진은 <video>의 currentTime으로 시간을 읽는다. 라이브에는 영상이 없으므로
    // 같은 모양의 시계를 만들어 넣는다 (엔진은 이 세 가지만 본다).
    const clock = {
        _startedAt: 0, _pausedAt: 0, _paused: true,
        get paused() { return this._paused; },
        get ended()  { return false; },
        get currentTime() {
            return this._paused ? this._pausedAt : (performance.now() - this._startedAt) / 1000;
        },
        start() { this._startedAt = performance.now(); this._paused = false; },
        stop()  { this._pausedAt = 0; this._paused = true; },
    };

    function readFileText(f) {
        return new Promise((resolve) => {
            const r = new FileReader();
            r.onload  = () => resolve(String(r.result || ''));
            r.onerror = () => resolve('');
            r.readAsText(f);
        });
    }

    if (bsFile) bsFile.addEventListener('change', async () => {
        const FS = window.PulseFunscript;
        stopScript();
        scriptAxes = null; scriptEndMs = 0;
        const files = Array.from(bsFile.files || []);
        if (!files.length || !FS) { bsState.textContent = '파일 없음'; bsPlay.disabled = true; return; }

        const axes = {};
        for (const f of files) {
            let json = null;
            try { json = JSON.parse(await readFileText(f)); } catch (_) { continue; }
            // 축 판정·진폭 계산은 엔진 쪽 함수를 그대로 쓴다 (따로 구현하면 갈라진다)
            const ax = FS.buildAxis(json && json.actions, f.name);
            if (!ax) continue;
            axes[FS.axisFromFilename(f.name)] = ax;
            const last = ax.actions[ax.actions.length - 1];
            if (last && last.at > scriptEndMs) scriptEndMs = last.at;
        }
        const keys = Object.keys(axes);
        if (!keys.length) { bsState.textContent = '읽을 수 없는 파일'; bsPlay.disabled = true; return; }
        scriptAxes = axes;
        bsState.textContent = keys.join('·') + ' · ' + Math.round(scriptEndMs / 1000) + '초';
        bsPlay.disabled = !broadcasting;
    });

    function playScript() {
        const FS = window.PulseFunscript;
        if (!FS || !scriptAxes || !broadcasting) return;
        stopScript();
        for (const k of Object.keys(scriptAxes)) scriptAxes[k].index = 0;
        clock.start();
        scriptEngine = new FS.MultiAxisEngine({
            video: clock,
            axes: scriptAxes,
            sendOnce: true,
            // 성형은 하지 않는다 — 시청자마다 자기 강도·범위 설정이 따로 있다.
            // (shape 없이 intensity 1이면 shapeStroke가 원본 값을 그대로 돌려준다)
            onCommand: (cmd) => sendTcode(cmd),
        });
        scriptEngine.start();
        bsPlay.classList.add('hidden');
        bsStop.classList.remove('hidden');
        bsTimer = setInterval(() => {
            const t = clock.currentTime;
            bsTime.textContent = t.toFixed(1) + 's / ' + (scriptEndMs / 1000).toFixed(1) + 's';
            if (scriptEndMs && t * 1000 > scriptEndMs) stopScript();
        }, 200);
    }

    function stopScript() {
        if (bsTimer) { clearInterval(bsTimer); bsTimer = null; }
        if (scriptEngine) { try { scriptEngine.stop(); } catch (_) {} scriptEngine = null; }
        clock.stop();
        if (bsPlay) { bsPlay.classList.remove('hidden'); bsPlay.disabled = !(scriptAxes && broadcasting); }
        if (bsStop) bsStop.classList.add('hidden');
        if (bsTime) bsTime.textContent = '';
    }

    if (bsPlay) bsPlay.addEventListener('click', playScript);
    if (bsStop) bsStop.addEventListener('click', () => { stopScript(); sendTcode('L050I500'); });

    function cleanup() {
        stopScript();                     // 송출을 끊으면 스크립트도 멈춘다
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
