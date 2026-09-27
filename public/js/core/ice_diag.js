/* ICE 연결 진단 — 1:1 통화(사용자/콘솔) 공용
 *
 * 왜 있는가:
 *   데이터채널이 안 열리면 화면에는 "통화 중"만 남고 카메라 버튼·세션 컨트롤이
 *   잠긴 채 아무 메시지도 안 나왔다 (2026-09-27 실사이트 제보). simple-peer 는
 *   ICE 실패를 30초쯤 뒤에야 error 로 뱉고, 그마저 console.warn 으로만 끝났다.
 *   → 실패 지점이 시그널링인지 NAT(릴레이 필요)인지 원격에서 가릴 수가 없었다.
 *
 * 무엇을 보여주는가:
 *   1) ICE 상태 (경로 탐색 중 / 연결됨 / 실패)
 *   2) 내가 수집한 후보 종류 — srflx 가 하나도 없으면 STUN 자체가 막힌 것
 *   3) 연결되면 실제로 선택된 후보쌍 (로컬망 ↔ 로컬망 / 공인IP / 릴레이)
 *
 * 후보 종류 읽는 법:
 *   host   로컬망 직결 (같은 와이파이)
 *   srflx  공인 IP (STUN 으로 알아낸 내 바깥 주소)
 *   relay  TURN 릴레이 경유  ← 현재 이 프로젝트엔 TURN 이 없어서 절대 안 나온다
 *
 * 1:다수 방송에는 붙이지 않는다. 1:1 경로에서만 쓴다.
 */
(function () {
    'use strict';

    const STATE_TXT = {
        new: '준비', checking: '경로 탐색 중', connected: '연결됨', completed: '연결됨',
        failed: '실패', disconnected: '끊김', closed: '닫힘',
    };
    const CAND_TXT = { host: '로컬망', srflx: '공인IP', prflx: '공인IP(추정)', relay: '릴레이' };

    function candName(c) {
        if (!c) return '?';
        return (CAND_TXT[c.candidateType] || c.candidateType || '?');
    }

    /** 진단 줄을 붙일 엘리먼트를 만든다 (없으면 생성, 있으면 재사용) */
    function ensureLine(after, id) {
        let el = document.getElementById(id);
        if (el) return el;
        el = document.createElement('div');
        el.id = id;
        el.className = 'mono';
        el.style.cssText = 'font-size:11px; line-height:1.5; margin:6px 0; color:var(--tx-2); word-break:break-all;';
        if (after && after.parentNode) after.parentNode.insertBefore(el, after.nextSibling);
        else document.body.appendChild(el);
        return el;
    }

    /** 지금까지 수집된 내 후보 종류 (중복 제거) */
    async function localTypes(pc) {
        const seen = new Set();
        try {
            const stats = await pc.getStats();
            stats.forEach((r) => { if (r.type === 'local-candidate' && r.candidateType) seen.add(candName(r)); });
        } catch (_) {}
        return Array.from(seen);
    }

    /** 실제로 선택된 후보쌍 — 없으면 null */
    async function selectedPair(pc) {
        try {
            const stats = await pc.getStats();
            const byId = new Map();
            let pair = null;
            stats.forEach((r) => {
                if (r.type === 'local-candidate' || r.type === 'remote-candidate') byId.set(r.id, r);
                if (r.type === 'candidate-pair' && r.state === 'succeeded' && (r.nominated || r.selected)) pair = r;
            });
            if (!pair) return null;
            return candName(byId.get(pair.localCandidateId)) + ' ↔ ' + candName(byId.get(pair.remoteCandidateId));
        } catch (_) { return null; }
    }

    /**
     * peer 에 진단을 붙인다.
     * @param {object} peer   simple-peer 인스턴스
     * @param {object} opts   { after: 이 엘리먼트 뒤에 줄을 꽂는다, id: 줄 id, label: 앞에 붙일 이름 }
     */
    function attach(peer, opts) {
        opts = opts || {};
        const el = ensureLine(opts.after, opts.id || 'ice-diag');
        const tag = opts.label ? opts.label + ' · ' : '';
        let poll = null, settled = false;

        const put = (text, color) => {
            el.textContent = tag + text;
            el.style.color = color || 'var(--tx-2)';
        };
        const pc = () => peer._pc || null;

        put('ICE 준비');
        console.log('[ICE] attach', opts.label || '');

        // 연결될 때까지 2초마다 상태를 보여준다.
        //   · 상대응답 ✗ 로 멈춰 있으면 → SDP 가 안 왔다 = 시그널링 문제 (NAT 이전)
        //   · 상대응답 ✓ 인데 탐색만 계속되면 → 경로 문제 = 릴레이(TURN) 영역
        //   · 내 후보에 '공인IP' 가 끝내 안 뜨면 → STUN 자체가 막힌 것
        poll = setInterval(async () => {
            if (settled || !pc()) return;
            const types = await localTypes(pc());
            const st = pc().iceConnectionState;
            const rd = pc().remoteDescription ? '상대응답 ✓' : '상대응답 ✗';
            put('ICE ' + (STATE_TXT[st] || st) + ' · ' + rd + ' · 내 후보 [' + (types.join(', ') || '수집 중') + ']');
        }, 2000);

        const stop = () => { if (poll) { clearInterval(poll); poll = null; } };

        peer.on('iceStateChange', (ice, gather) => {
            console.log('[ICE]', opts.label || '', ice, '/ gathering', gather);
            if (ice === 'connected' || ice === 'completed') return;   // 성공 표기는 connect 에서
            if (ice === 'failed') {
                settled = true; stop();
                put('ICE 실패 — 직결 경로를 못 찾았습니다 (릴레이 필요)', 'var(--c-pink)');
            }
            if (ice === 'disconnected') put('ICE 끊김 — 재연결 시도 중', 'var(--c-yellow)');
        });

        peer.on('connect', async () => {
            settled = true; stop();
            const pair = pc() ? await selectedPair(pc()) : null;
            console.log('[ICE] connected via', pair);
            put('연결됨 · 경로 ' + (pair || '?'), 'var(--c-green)');
        });

        peer.on('error', (e) => {
            stop();
            const msg = (e && e.message) || String(e);
            console.warn('[ICE] error', msg);
            put('연결 실패 — ' + msg, 'var(--c-pink)');
        });

        peer.on('close', () => { stop(); });
        return { stop };
    }

    window.PulseIceDiag = { attach };
})();
