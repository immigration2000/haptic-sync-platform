/* 헤더 디바이스 버튼 — PulseDevice 전역에 바인딩 */
(function () {
    if (typeof window.PulseDevice === 'undefined') return;

    const $ = (id) => document.getElementById(id);
    const btn = $('pulse-device-btn');
    const popover = $('pulse-device-popover');
    if (!btn || !popover) return;

    const label = btn.querySelector('.pulse-device-label');
    const popDisc = $('pulse-pop-disc');
    const popConn = $('pulse-pop-conn');
    const btnUSB = $('pulse-btn-connect-usb');
    const btnBLE = $('pulse-btn-connect-ble');
    const btnDisc = $('pulse-btn-disconnect');
    const kindLbl = $('pulse-kind');
    const portLbl = $('pulse-port');
    const sentLbl = $('pulse-sent');
    const hintLbl = $('pulse-pop-hint');

    function setOpen(open) {
        popover.hidden = !open;
        btn.setAttribute('aria-expanded', String(open));
    }
    btn.addEventListener('click', (e) => { e.stopPropagation(); setOpen(popover.hidden); });
    document.addEventListener('click', (e) => {
        if (popover.hidden) return;
        if (popover.contains(e.target) || btn.contains(e.target)) return;
        setOpen(false);
    });

    async function tryConn(method) {
        hintLbl.textContent = '';
        try {
            if (method === 'serial')   await window.PulseDevice.connectSerial();
            if (method === 'bluetooth') await window.PulseDevice.connectBluetooth();
        } catch (e) {
            if (e && e.name === 'NotFoundError') return;
            hintLbl.textContent = (e && e.message) ? e.message : '연결 실패';
        }
    }
    btnUSB && btnUSB.addEventListener('click', () => tryConn('serial'));
    btnBLE && btnBLE.addEventListener('click', () => tryConn('bluetooth'));
    btnDisc && btnDisc.addEventListener('click', () => window.PulseDevice.disconnect());

    function render(status) {
        if (status.connected) {
            btn.classList.add('connected');
            label.textContent = '연결됨';
            popDisc.classList.add('pulse-hidden');
            popConn.classList.remove('pulse-hidden');
            kindLbl.textContent = status.kind === 'serial' ? 'USB Serial' :
                                  status.kind === 'bluetooth' ? 'Bluetooth LE' : '—';
            // 기기 응답이 오면 함께 표시 — 응답이 있다 = baud 맞고 실제 통신 중
            portLbl.textContent = (status.portLabel || '—')
                + (status.deviceInfo ? '  ↩ ' + String(status.deviceInfo).slice(0, 28) : '');
            sentLbl.textContent = status.sentCount.toLocaleString() + ' cmd';
        } else {
            btn.classList.remove('connected');
            label.textContent = '디바이스';
            btn.title = status.lastError || '';
            popDisc.classList.remove('pulse-hidden');
            popConn.classList.add('pulse-hidden');
            portLbl.textContent = status.lastError || '—';
            sentLbl.textContent = '0 cmd';
        }
        if (btnUSB) btnUSB.disabled = !status.serialSupported;
        if (btnBLE) btnBLE.disabled = !status.bluetoothSupported;
    }
    render(window.PulseDevice.getStatus());
    window.PulseDevice.onChange(render);
})();

/* 모바일 슬라이드 메뉴 (햄버거 드로어) 토글 */
(function () {
    var burger = document.getElementById('m-burger');
    var drawer = document.getElementById('m-drawer');
    var ov     = document.getElementById('m-drawer-ov');
    if (!burger || !drawer || !ov) return;
    var x = document.getElementById('m-drawer-x');
    function open()  { drawer.classList.add('open');    ov.classList.add('open');    document.body.style.overflow = 'hidden'; }
    function close() { drawer.classList.remove('open'); ov.classList.remove('open'); document.body.style.overflow = ''; }
    burger.addEventListener('click', open);
    ov.addEventListener('click', close);
    if (x) x.addEventListener('click', close);

    // 드로어 내 디바이스 연결 (모바일은 헤더 버튼 숨김 → 여기서 연결)
    var dev = document.getElementById('m-dev-connect');
    var devState = document.getElementById('m-dev-state');
    if (dev && window.PulseDevice) {
        function syncState(s) {
            if (!devState) return;
            devState.textContent = s.connected ? '● 연결됨' : '';
            devState.style.color = s.connected ? 'var(--c-green)' : 'var(--tx-3)';
        }
        syncState(window.PulseDevice.getStatus());
        window.PulseDevice.onChange(syncState);
        dev.addEventListener('click', function (e) {
            e.preventDefault();
            close();
            var st = window.PulseDevice.getStatus();
            if (st.connected) { window.PulseDevice.disconnect(); return; }
            // 모바일은 USB(Web Serial) 미지원 → BLE 우선, 없으면 Serial 시도
            var fn = st.bluetoothSupported ? window.PulseDevice.connectBluetooth
                   : st.serialSupported   ? window.PulseDevice.connectSerial : null;
            if (!fn) { alert('이 브라우저는 디바이스 연결을 지원하지 않습니다. (안드로이드 Chrome 또는 PC를 사용하세요)'); return; }
            fn().catch(function () {});
        });
    }
})();
