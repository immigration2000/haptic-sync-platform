/* ICE 연결 진단 — 1:1 통화(사용자/콘솔) 공용
 *
 * 왜 있는가:
 *   데이터채널이 안 열리면 화면에는 "통화 중"만 남고 카메라 버튼·세션 컨트롤이
 *   잠긴 채 아무 메시지도 안 나왔다 (2026-09-27 실사이트 제보). simple-peer 는
 *   ICE 실패를 30초쯤 뒤에야 error 로 뱉고, 그마저 console.warn 으로만 끝났다.
 *   → 실패 지점이 시그널링인지 NAT(릴레이 필요)인지 원격에서 가릴 수가 없었다.
 *
 * 무엇을 보여주는가:
 *   1) ICE 상태 (경로 탐색 중 / 연결됨 / 실패) + 상대 SDP 도착 여부
 *   2) 내가 수집한 후보 종류 — srflx 가 하나도 없으면 STUN 자체가 막힌 것
 *   3) **상대 후보 종류와 후보쌍 성적** — SDP 는 왔는데 상대 후보가 0이면 trickle 후보가
 *      중간에 날아간 것(시그널링), 후보는 왔는데 쌍이 전부 실패면 경로 문제(릴레이 필요)
 *   4) 연결되면 실제로 선택된 후보쌍 (로컬망 ↔ 로컬망 / 공인IP / 릴레이)
 *   콘솔에서 `PulseIceDiag.report()` 로 아무 때나 현재 상태를 뽑을 수 있다.
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

    let last = null;                      // 마지막으로 붙은 peer — report() 가 쓴다

    function candName(c) {
        if (!c) return '?';
        return (CAND_TXT[c.candidateType] || c.candidateType || '?');
    }

    /**
     * 시그널 계수기 — offer/answer/candidate 를 **몇 개 보냈고 몇 개 받았는지** 센다.
     *
     * 왜 필요한가: 상대 SDP 는 왔는데 상대 후보가 0개인 상태를 만났다 (2026-09-27).
     *   후보는 SDP 와 같은 통로(socket 'signal')로 오는데 SDP 만 오고 후보는 안 온다면
     *   ① 상대가 애초에 안 보냈거나 ② 중간(서버 릴레이)에서 버려지는 것이다.
     *   양쪽 화면의 '송신/수신' 숫자를 맞춰보면 어느 쪽인지 한 번에 갈린다.
     */
    function sigKind(d) {
        if (!d) return '?';
        if (d.type) return d.type;                       // offer · answer · pranswer · rollback
        if (d.candidate !== undefined) return 'cand';
        if (d.renegotiate) return 'renego';
        if (d.transceiverRequest) return 'tr';
        return '?';
    }
    function fmtCount(o) {
        const ks = Object.keys(o);
        return ks.length ? ks.map((k) => k + ' ' + o[k]).join(' ') : '0';
    }
    /**
     * 후보 문자열의 주소 형태. mDNS(`xxxx.local`) 인지 실제 주소인지 가른다.
     *
     * ⚠ 크롬은 페이지에 마이크·카메라 권한이 없으면 로컬 IP 를 `<uuid>.local` 로 가린다.
     *   상대가 그 이름을 멀티캐스트로 못 풀면 `addIceCandidate` 가 거부되고,
     *   simple-peer 는 그걸 **조용히 무시**한다(`.local` 이면 warn 만). 그래서 후보를
     *   20개 받고도 '상대 후보 없음' 이 된다. 이 구분이 없으면 원인을 못 본다.
     */
    function candShape(d) {
        const s = d && d.candidate && d.candidate.candidate;
        if (!s) return 'eoc';                                 // end-of-candidates
        const typ = (s.match(/ typ (\w+)/) || [])[1] || '?';
        const addr = s.split(' ')[4] || '';
        return typ + (/\.local$/i.test(addr) ? '(.local)' : '');
    }

    function counter() {
        const c = { out: {}, in: {}, shape: { out: {}, in: {} } };
        const bump = (o, k) => { o[k] = (o[k] || 0) + 1; };
        const note = (dir, d) => {
            const k = sigKind(d);
            bump(c[dir], k);
            if (k === 'candidate' || k === 'cand') bump(c.shape[dir], candShape(d));
        };
        const shapeTxt = (o) => { const ks = Object.keys(o); return ks.length ? ' ' + ks.map((k) => k + ' ' + o[k]).join(' ') : ''; };
        return {
            out(d) { note('out', d); },
            in(d)  { note('in', d); },
            text() {
                return '시그널 송신 [' + fmtCount(c.out) + shapeTxt(c.shape.out) + ']'
                     + ' 수신 [' + fmtCount(c.in) + shapeTxt(c.shape.in) + ']';
            },
            raw: c,
        };
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

    /**
     * 현재 후보·후보쌍 현황.
     *
     * ⚠ **상대 후보가 0개인지**가 갈림길이다 — SDP(상대응답 ✓)는 왔는데 상대 후보가 0이면
     *   trickle 후보가 중간에 날아간 것(시그널링 문제)이고, 후보는 왔는데 쌍이 전부
     *   실패면 경로 문제(릴레이 필요)다. 이 둘을 섞으면 엉뚱한 곳을 판다.
     */
    async function snapshot(pc) {
        const local = new Set(), remote = new Set();
        const pairs = { total: 0, succeeded: 0, failed: 0, waiting: 0 };
        try {
            const stats = await pc.getStats();
            stats.forEach((r) => {
                if (r.type === 'local-candidate'  && r.candidateType) local.add(candName(r));
                if (r.type === 'remote-candidate' && r.candidateType) remote.add(candName(r));
                if (r.type === 'candidate-pair') {
                    pairs.total++;
                    if (r.state === 'succeeded') pairs.succeeded++;
                    else if (r.state === 'failed') pairs.failed++;
                    else pairs.waiting++;                       // frozen · waiting · in-progress
                }
            });
        } catch (_) {}
        return { local: Array.from(local), remote: Array.from(remote), pairs };
    }

    /** 실패했을 때 콘솔에 붙일 상세 (IP 는 안 찍는다 — 종류·프로토콜·포트만) */
    async function dump(pc) {
        const rows = [];
        try {
            const stats = await pc.getStats();
            stats.forEach((r) => {
                if (r.type === 'local-candidate' || r.type === 'remote-candidate') {
                    rows.push(`${r.type === 'local-candidate' ? 'L' : 'R'} ${r.candidateType}/${r.protocol}:${r.port}`);
                } else if (r.type === 'candidate-pair') {
                    rows.push(`PAIR ${r.state}${r.nominated ? ' (nominated)' : ''}`);
                }
            });
        } catch (_) {}
        return rows;
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
     * @param {object} opts   { after: 줄을 꽂을 기준 엘리먼트, id: 줄 id, label: 앞에 붙일 이름,
     *                          sig: counter() — 있으면 시그널 송·수신 개수도 같이 보여준다 }
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

        // 후보 '투입' 결과를 가로채 센다.
        // simple-peer 는 addIceCandidate 실패를 조용히 삼키므로(.local 이면 warn 만),
        // 여기서 세지 않으면 "20개 받았는데 0개 들어감" 의 이유를 볼 수 없다. 던지는 건 그대로 던진다.
        const add = { ok: 0, bad: 0, err: '' };
        try {
            const p = pc();
            if (p && typeof p.addIceCandidate === 'function' && !p.__iceDiagPatched) {
                const orig = p.addIceCandidate.bind(p);
                p.addIceCandidate = function (c) {
                    return orig(c).then((r) => { add.ok++; return r; },
                                        (e) => { add.bad++; if (!add.err) add.err = (e && e.message) || String(e);
                                                 console.warn('[ICE] 후보 투입 거부:', add.err, c && c.candidate);
                                                 throw e; });
                };
                p.__iceDiagPatched = true;
            }
        } catch (_) {}

        put('ICE 준비');
        console.log('[ICE] attach', opts.label || '');

        // 연결될 때까지 2초마다 상태를 보여준다.
        //   · 상대응답 ✗ 로 멈춰 있으면 → SDP 가 안 왔다 = 시그널링 문제 (NAT 이전)
        //   · 상대응답 ✓ 인데 탐색만 계속되면 → 경로 문제 = 릴레이(TURN) 영역
        //   · 내 후보에 '공인IP' 가 끝내 안 뜨면 → STUN 자체가 막힌 것
        poll = setInterval(async () => {
            if (settled || !pc()) return;
            const s = await snapshot(pc());
            const st = pc().iceConnectionState;
            const rd = pc().remoteDescription ? '상대응답 ✓' : '상대응답 ✗';
            // ⚠ gather 가 'new' 로 멈춰 있으면 **브라우저가 후보 수집을 시작조차 안 한 것**이다.
            //   (VPN·정책으로 후보가 억제되는 경우 — 내 후보를 0개 내보내는 이유가 여기서 보인다)
            const states = 'sdp=' + pc().signalingState + ' gather=' + pc().iceGatheringState
                         + ' conn=' + pc().connectionState + ' local=' + (pc().localDescription ? 'Y' : 'N');
            put('ICE ' + (STATE_TXT[st] || st) + ' · ' + states + ' · ' + rd
                + ' · 내 후보 [' + (s.local.join(', ') || '수집 중') + ']'
                + ' · 상대 후보 [' + (s.remote.join(', ') || '없음') + ']'
                + ' · 쌍 ' + s.pairs.total + '(성공 ' + s.pairs.succeeded + '/실패 ' + s.pairs.failed + '/대기 ' + s.pairs.waiting + ')'
                + ' · 후보투입 ' + add.ok + '/거부 ' + add.bad + (add.err ? ' (' + add.err + ')' : '')
                + (opts.sig ? ' · ' + opts.sig.text() : ''));
        }, 2000);

        const stop = () => { if (poll) { clearInterval(poll); poll = null; } };

        peer.on('iceStateChange', (ice, gather) => {
            console.log('[ICE]', opts.label || '', ice, '/ gathering', gather);
            if (ice === 'connected' || ice === 'completed') return;   // 성공 표기는 connect 에서
            if (ice === 'failed') {
                settled = true; stop();
                put('ICE 실패 — 직결 경로를 못 찾았습니다 (릴레이 필요)', 'var(--c-pink)');
                if (opts.sig) console.warn('[ICE] ' + opts.sig.text());
                if (pc()) dump(pc()).then((rows) => console.warn('[ICE] 실패 상세\n' + rows.join('\n')));
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
        last = { peer, pc, sig: opts.sig || null };
        return { stop };
    }

    // 사람이 콘솔에서 아무 때나 현재 상태를 뽑을 수 있게 — `PulseIceDiag.report()`
    async function report() {
        if (!last || !last.pc()) return '(붙은 peer 없음)';
        const s = await snapshot(last.pc());
        const rows = await dump(last.pc());
        const out = 'state=' + last.pc().iceConnectionState
            + ' remoteDesc=' + (last.pc().remoteDescription ? 'Y' : 'N')
            + (last.sig ? '\n' + last.sig.text() : '')
            + '\n내 후보 [' + s.local.join(', ') + '] 상대 후보 [' + s.remote.join(', ') + ']'
            + '\n쌍 ' + JSON.stringify(s.pairs) + '\n' + rows.join('\n');
        console.log('[ICE] report\n' + out);
        return out;
    }

    window.PulseIceDiag = { attach, report, counter };
})();
