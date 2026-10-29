/* 카메라 선택 · 진단 공용 모듈 (2026-10-30)
 *
 * 왜 있는가:
 *   "내 PC 에서는 되는데 다른 PC 에서는 카메라가 화면에 안 뜬다" 는 제보.
 *   기존 코드는 실패 원인을 **전부 조용히 삼켰다**:
 *     · getUserMedia 거부 → catch 에서 '권한이 없습니다' 한 줄 (실제 사유 손실)
 *     · video.play() 거부  → `.catch(()=>{})`  (자동재생 차단이면 검은 화면)
 *     · 카메라가 여러 개면 **브라우저 기본값**이 잡힌다 → 가상캠(OBS)·IR 캠이 잡히면 검은 화면
 *     · http(LAN) 주소면 `navigator.mediaDevices` 자체가 없다 → TypeError
 *   그래서 ① 어느 카메라를 쓸지 고를 수 있게 하고 ② 실패 사유를 화면에 적는다.
 *
 * 쓰는 쪽: 1:1 통화 화면(사용자) · BJ 콘솔(스트리머). 둘이 같은 로직을 공유한다.
 */
(function () {
    'use strict';

    const KEY = 'pulse_cam_device';

    /** 보안 컨텍스트 점검 — 이것부터 걸러야 한다. http://192.168.x 는 카메라를 못 쓴다. */
    function unsupportedReason() {
        if (!window.isSecureContext) {
            return 'https 또는 localhost 에서만 카메라를 쓸 수 있습니다 (현재 주소: ' + location.protocol + '//' + location.host + ')';
        }
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            return '이 브라우저에서 카메라 API 를 쓸 수 없습니다';
        }
        return null;
    }

    /** getUserMedia 오류 → 사용자가 할 수 있는 조치로 번역 */
    function explain(err) {
        const n = (err && (err.name || err.code)) || '';
        const m = (err && err.message) || String(err);
        switch (n) {
            case 'NotAllowedError':
            case 'PermissionDeniedError':
                return '카메라 권한이 거부됐습니다 — 주소창 자물쇠 아이콘에서 카메라를 허용하고 새로고침하세요';
            case 'NotFoundError':
            case 'DevicesNotFoundError':
                return '카메라를 찾을 수 없습니다 — 연결 상태를 확인하거나 목록에서 다른 카메라를 고르세요';
            case 'NotReadableError':
            case 'TrackStartError':
                return '다른 프로그램이 카메라를 쓰고 있습니다 — Zoom·OBS·카메라 앱을 끄고 다시 시도하세요';
            case 'OverconstrainedError':
                return '선택한 카메라를 쓸 수 없습니다 — 목록에서 "자동" 또는 다른 카메라를 고르세요';
            case 'SecurityError':
                return '보안 설정 때문에 카메라가 막혔습니다 (' + m + ')';
            case 'AbortError':
                return '카메라를 여는 중 중단됐습니다 — 다시 시도하세요';
            default:
                return '카메라 열기 실패 — ' + (n ? n + ': ' : '') + m;
        }
    }

    function saved() { try { return localStorage.getItem(KEY) || ''; } catch (_) { return ''; } }
    function save(id) { try { localStorage.setItem(KEY, id || ''); } catch (_) {} }

    /** 카메라 목록. ⚠ 권한 전에는 label 이 빈 문자열이다 → 스트림을 한 번 연 뒤 다시 채워야 이름이 보인다. */
    async function listVideoInputs() {
        if (unsupportedReason() || !navigator.mediaDevices.enumerateDevices) return [];
        try {
            const all = await navigator.mediaDevices.enumerateDevices();
            return all.filter((d) => d.kind === 'videoinput')
                      .map((d, i) => ({ deviceId: d.deviceId, label: d.label || ('카메라 ' + (i + 1)) }));
        } catch (_) { return []; }
    }

    /** <select> 를 채운다. 저장된 선택을 복원하고, 바뀌면 저장한다. */
    async function fillSelect(sel, onChange) {
        if (!sel) return [];
        const list = await listVideoInputs();
        const cur = sel.value || saved();
        sel.innerHTML = '<option value="">자동 (브라우저 기본)</option>';
        for (const d of list) {
            const o = document.createElement('option');
            o.value = d.deviceId; o.textContent = d.label;
            sel.appendChild(o);
        }
        if (cur && list.some((d) => d.deviceId === cur)) sel.value = cur;
        if (!sel.dataset.pulseCamBound) {
            sel.dataset.pulseCamBound = '1';
            sel.addEventListener('change', () => { save(sel.value); if (onChange) onChange(sel.value); });
        }
        return list;
    }

    /**
     * 카메라 열기. 실패하면 **번역된 사유를 담은 Error** 를 던진다 (조용히 삼키지 않는다).
     * deviceId 를 줬는데 그 장치가 없으면 '자동' 으로 한 번 더 시도한다 —
     * 저장된 선택이 다른 PC 에서는 존재하지 않을 수 있기 때문이다.
     */
    async function open(opts) {
        opts = opts || {};
        const bad = unsupportedReason();
        if (bad) { const e = new Error(bad); e.pulseReason = bad; throw e; }

        const want = opts.deviceId || '';
        const base = { width: { ideal: 1280 }, height: { ideal: 720 } };
        try {
            const video = want ? Object.assign({ deviceId: { exact: want } }, base) : base;
            return await navigator.mediaDevices.getUserMedia({ video });
        } catch (err) {
            if (want && /OverconstrainedError|NotFoundError/.test(err && err.name)) {
                try { return await navigator.mediaDevices.getUserMedia({ video: base }); }
                catch (e2) { const e = new Error(explain(e2)); e.pulseReason = explain(e2); e.cause = e2; throw e; }
            }
            const e = new Error(explain(err)); e.pulseReason = explain(err); e.cause = err; throw e;
        }
    }

    /** 스트림 요약 — '로지텍 C920 · 1280x720 @30 · live' */
    function describe(stream) {
        const t = stream && stream.getVideoTracks && stream.getVideoTracks()[0];
        if (!t) return '영상 트랙 없음';
        const s = (t.getSettings && t.getSettings()) || {};
        const size = (s.width && s.height) ? s.width + 'x' + s.height : '해상도 ?';
        const fps = s.frameRate ? ' @' + Math.round(s.frameRate) : '';
        // 라벨은 길 수 있다(일부 트랙은 base64 식별자가 들어온다) → 한 줄을 넘기지 않게 자른다
        let label = t.label || '카메라';
        if (label.length > 36) label = label.slice(0, 33) + '…';
        return label + ' · ' + size + fps + ' · ' + t.readyState + (t.muted ? ' (muted)' : '');
    }

    /**
     * 비디오 요소에 스트림을 붙이고 **재생까지 확인**한다.
     * play() 가 거부되면(자동재생 차단) 그 사실을 알려주고, 화면을 한 번 누르면 재생되게 둔다.
     * @returns {Promise<string|null>} 문제가 있으면 안내 문구, 정상이면 null
     */
    async function attach(videoEl, stream) {
        if (!videoEl) return '영상 요소를 찾을 수 없습니다';
        videoEl.muted = true;                 // 자기 화면은 항상 음소거 (되먹임 방지)
        videoEl.playsInline = true;
        videoEl.autoplay = true;
        videoEl.srcObject = stream;
        try {
            await videoEl.play();
            return null;
        } catch (err) {
            const once = () => { videoEl.play().catch(() => {}); };
            videoEl.addEventListener('click', once, { once: true });
            document.addEventListener('click', once, { once: true });
            return '브라우저가 자동재생을 막았습니다 — 화면을 한 번 클릭하면 보입니다 (' + ((err && err.name) || 'play 실패') + ')';
        }
    }

    /** 진단 한 줄 출력 (없으면 콘솔만) */
    function diag(el, text, kind) {
        const color = kind === 'bad' ? 'var(--c-pink)' : kind === 'warn' ? 'var(--c-yellow)' : 'var(--tx-2)';
        if (el) { el.textContent = text; el.style.color = color; el.classList.remove('hidden'); }
        (kind === 'bad' ? console.warn : console.log)('[CAM]', text);
    }

    /** 지원 요청용 덤프 — 콘솔에서 `PulseCamera.report()` */
    async function report() {
        const lines = [
            'secureContext=' + window.isSecureContext + ' origin=' + location.origin,
            'unsupported=' + (unsupportedReason() || 'no'),
            'saved=' + (saved() || '(자동)'),
        ];
        for (const d of await listVideoInputs()) lines.push('cam: ' + d.label + ' [' + (d.deviceId || '').slice(0, 8) + '…]');
        const out = lines.join('\n');
        console.log('[CAM] report\n' + out);
        return out;
    }

    window.PulseCamera = { listVideoInputs, fillSelect, open, describe, attach, diag, report, explain, unsupportedReason, savedDeviceId: saved };
})();
