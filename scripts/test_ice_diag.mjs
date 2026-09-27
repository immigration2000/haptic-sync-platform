/**
 * ICE 진단 표시 테스트 — `public/js/core/ice_diag.js`
 *
 *   실행: node scripts/test_ice_diag.mjs
 *
 * 무엇을 지키는가 (2026-09-27 실사이트 제보에서 나온 요구):
 *   - ICE 실패가 화면 문구로 드러난다 (예전엔 console.warn 으로만 끝나 원인을 못 봤다)
 *   - 연결되면 **선택된 후보쌍**을 보여준다 — 로컬망 직결인지 릴레이인지 갈라야 하므로
 *   - 후보 수집 중에도 내가 가진 후보 종류를 보여준다 (srflx 가 없으면 STUN 차단)
 *   - 진단이 실패해도(peer 에 _pc 가 없다든가) 통화 로직을 절대 죽이지 않는다
 */
import fs from 'fs';
import vm from 'vm';

const SRC = fs.readFileSync(new URL('../public/js/core/ice_diag.js', import.meta.url), 'utf8');

// ── 최소 DOM ──
const els = new Map();
function mkEl(id) {
    const el = {
        id: id || '', className: '', _text: '', style: { cssText: '', color: '' },
        parentNode: null, children: [],
        set textContent(v) { this._text = String(v); },
        get textContent() { return this._text; },
        insertBefore(node) { node.parentNode = this; this.children.push(node); if (node.id) els.set(node.id, node); },
        remove() { els.delete(this.id); },
    };
    if (id) els.set(id, el);
    return el;
}
const body = mkEl('body');
const anchor = mkEl('call-state');
anchor.parentNode = body;

const ctx = {
    console: { log() {}, warn() {} },
    setInterval: (fn) => { ctx.__poll = fn; return 1; }, clearInterval() { ctx.__poll = null; },
    document: {
        getElementById: (id) => els.get(id) || null,
        createElement: () => mkEl(''),
        body,
    },
    Set, Map, Array, String, Promise,
};
ctx.window = ctx; ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(SRC, ctx);
const Diag = ctx.window.PulseIceDiag;

let pass = 0, fail = 0;
const ok = (n, c, e = '') => { c ? pass++ : fail++; console.log(`  ${c ? '✅' : '❌'} ${n}${e ? ' — ' + e : ''}`); };

// ── 가짜 peer (simple-peer 흉내) ──
function fakePeer(stats) {
    const hs = {};
    return {
        _pc: { iceConnectionState: 'checking', getStats: async () => stats },
        on(ev, fn) { (hs[ev] = hs[ev] || []).push(fn); },
        emit(ev, ...a) { return Promise.all((hs[ev] || []).map((f) => f(...a))); },
    };
}
// getStats 결과는 forEach 로 순회한다 (RTCStatsReport 와 같은 모양)
const statsOf = (rows) => ({ forEach: (f) => rows.forEach(f) });

console.log('\n1. 실패가 화면에 드러난다');
{
    const p = fakePeer(statsOf([]));
    Diag.attach(p, { after: anchor, id: 'ice-diag' });
    const line = els.get('ice-diag');
    ok('진단 줄이 생긴다', !!line);
    await p.emit('iceStateChange', 'failed', 'complete');
    ok('ICE 실패 문구', /실패/.test(line.textContent), line.textContent);
    ok('릴레이가 필요하다고 알려준다', /릴레이/.test(line.textContent), line.textContent);
    line.remove();
}

console.log('\n2. 연결되면 선택된 경로를 보여준다');
{
    const rows = [
        { id: 'L1', type: 'local-candidate',  candidateType: 'host' },
        { id: 'R1', type: 'remote-candidate', candidateType: 'srflx' },
        { id: 'P1', type: 'candidate-pair', state: 'succeeded', nominated: true, localCandidateId: 'L1', remoteCandidateId: 'R1' },
    ];
    const p = fakePeer(statsOf(rows));
    Diag.attach(p, { after: anchor, id: 'ice-diag' });
    const line = els.get('ice-diag');
    await p.emit('connect');
    ok('연결 표기', /연결됨/.test(line.textContent), line.textContent);
    ok('후보쌍 종류 (로컬망 ↔ 공인IP)', /로컬망 ↔ 공인IP/.test(line.textContent), line.textContent);
    line.remove();
}

console.log('\n3. 선택된 쌍이 없으면 ? 로 둔다 (거짓말하지 않는다)');
{
    const p = fakePeer(statsOf([{ id: 'L1', type: 'local-candidate', candidateType: 'srflx' }]));
    Diag.attach(p, { after: anchor, id: 'ice-diag' });
    const line = els.get('ice-diag');
    await p.emit('connect');
    ok('경로 ?', /경로 \?/.test(line.textContent), line.textContent);
    line.remove();
}

console.log('\n4. error 는 사유를 그대로 보여준다');
{
    const p = fakePeer(statsOf([]));
    Diag.attach(p, { after: anchor, id: 'ice-diag', label: '테스터' });
    const line = els.get('ice-diag');
    await p.emit('error', new Error('Ice connection failed.'));
    ok('사유 노출', /Ice connection failed/.test(line.textContent), line.textContent);
    ok('라벨이 앞에 붙는다', /^테스터 · /.test(line.textContent), line.textContent);
    line.remove();
}

console.log('\n5. 통화 로직을 죽이지 않는다');
{
    const p = fakePeer(statsOf([]));
    p._pc = null;                                   // pc 가 없는 상황
    let threw = false;
    try {
        Diag.attach(p, { after: anchor, id: 'ice-diag' });
        await p.emit('connect');
        await p.emit('iceStateChange', 'failed', 'complete');
    } catch (_) { threw = true; }
    ok('_pc 가 없어도 예외를 던지지 않는다', !threw);
    els.get('ice-diag') && els.get('ice-diag').remove();

    const p2 = fakePeer({ forEach() { throw new Error('boom'); } });
    let threw2 = false;
    try { Diag.attach(p2, { after: anchor, id: 'ice-diag' }); await p2.emit('connect'); }
    catch (_) { threw2 = true; }
    ok('getStats 가 터져도 삼킨다', !threw2);
}

console.log('\n6. 연결 전 상태 — 시그널링 문제와 경로 문제를 구분한다');
{
    const rows = [{ id: 'L1', type: 'local-candidate', candidateType: 'srflx' }];
    const p = fakePeer(statsOf(rows));
    Diag.attach(p, { after: anchor, id: 'ice-diag' });
    const line = els.get('ice-diag');

    p._pc.iceConnectionState = 'new';
    await ctx.__poll();                                   // 상대 SDP 가 아직 안 온 상태
    ok('상대응답 ✗ 로 시그널링 미완을 드러낸다', /상대응답 ✗/.test(line.textContent), line.textContent);
    ok('내 후보 종류를 보여준다', /공인IP/.test(line.textContent), line.textContent);

    p._pc.remoteDescription = { type: 'answer' };
    p._pc.iceConnectionState = 'checking';
    await ctx.__poll();
    ok('상대응답 ✓ + 경로 탐색 중', /경로 탐색 중 · 상대응답 ✓/.test(line.textContent), line.textContent);
    line.remove();
}

console.log('\n7. 시그널 계수기 — 누가 안 보내는지 / 누가 못 받는지');
{
    const c = Diag.counter();
    c.out({ type: 'offer' });
    c.out({ candidate: { candidate: 'a' } });
    c.out({ candidate: { candidate: 'b' } });
    c.in({ type: 'answer' });
    ok('offer/candidate 를 종류별로 센다', /송신 \[offer 1 cand 2\]/.test(c.text()), c.text());
    ok('수신은 answer 1 · 후보 0', /수신 \[answer 1\]/.test(c.text()), c.text());

    const c2 = Diag.counter();
    ok('아무것도 없으면 0', /송신 \[0\] 수신 \[0\]/.test(c2.text()), c2.text());

    // 화면 줄에도 함께 나온다
    const p = fakePeer(statsOf([]));
    p._pc.iceConnectionState = 'checking';
    p._pc.remoteDescription = { type: 'answer' };
    Diag.attach(p, { after: anchor, id: 'ice-diag', sig: c });
    const line = els.get('ice-diag');
    await ctx.__poll();
    ok('진단 줄에 시그널 수치가 붙는다', /시그널 송신 \[offer 1 cand 2\] 수신 \[answer 1\]/.test(line.textContent), line.textContent);
    line.remove();
}

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`);
process.exit(fail ? 1 : 0);
