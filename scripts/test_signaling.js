/* 시그널링 통합 테스트:
 * BJ online → user1 통화 → hangup → user2 재통화 성공해야 (재연결 버그 검증)
 *
 * 소켓 세션 인증이 적용되어 있어, 실제 로그인 쿠키로 접속해야 한다.
 * (bj=sophia, 호출자=test@pulse.dev — seed 계정, 비번 1234)
 */
const { io } = require('socket.io-client');
const URL = 'http://localhost:5502';
const BJ_USER_ID = 3; // sophia
const wait = (ms) => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log('  ✓', m); };
const no = (m) => { fail++; console.log('  ✗', m); };

// HTTP 로그인으로 세션 쿠키 획득 (CSRF 토큰 포함)
function parseCookies(res) {
    const set = res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get('set-cookie')].filter(Boolean);
    return set.map(c => c.split(';')[0]);
}
async function login(email, password) {
    // 1) 로그인 페이지 GET → pulse.sid·pulse-csrf 쿠키 + 메타 토큰
    const g = await fetch(URL + '/auth/login', { redirect: 'manual' });
    const cookies = parseCookies(g);
    const html = await g.text();
    const m = html.match(/name="csrf-token" content="([^"]+)"/);
    const token = m ? m[1] : '';
    // 2) 토큰+쿠키로 로그인 POST
    const p = await fetch(URL + '/auth/login', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Cookie': cookies.join('; '),
            'x-csrf-token': token,
        },
        body: new URLSearchParams({ email, password }),
        redirect: 'manual',
    });
    const map = {};
    for (const c of cookies.concat(parseCookies(p))) map[c.split('=')[0]] = c;
    const sid = Object.values(map).join('; ');
    if (!sid) throw new Error('로그인 실패: 쿠키 없음 (' + email + ')');
    return sid;
}
const conn = (cookie) => io(URL, { extraHeaders: { Cookie: cookie } });

(async () => {
    const bjCookie   = await login('sophia@pulse.dev', '1234');
    const userCookie = await login('test@pulse.dev', '1234');

    // BJ 접속 + 대기 등록 (신원은 세션에서 — emit 인자는 무시됨)
    const bj = conn(bjCookie);
    let bjPaired = 0;
    bj.on('paired', () => bjPaired++);
    bj.on('peer-hangup', () => {});
    bj.on('connect_error', (e) => no('BJ 소켓 인증 실패: ' + e.message));
    await new Promise(r => bj.on('connect', r));
    bj.emit('bj-online');
    await wait(300);

    // ─── 1차 통화 ───
    const u1 = conn(userCookie);
    let u1Paired = false, u1Failed = null;
    u1.on('paired', () => u1Paired = true);
    u1.on('call-failed', (d) => u1Failed = d.reason);
    await new Promise(r => u1.on('connect', r));
    u1.emit('user-enter');
    await wait(200);
    u1.emit('user-call', { bjUserIdTarget: BJ_USER_ID, kind: 'call', context: {} });
    await wait(400);
    if (u1Paired) ok('1차 통화 매칭 성공'); else no('1차 통화 매칭 실패 ' + (u1Failed||''));

    // 종료 (user1 hangup)
    u1.emit('hangup');
    await wait(400);
    u1.disconnect();
    await wait(400);

    // ─── 2차 통화 (재연결) — 핵심 버그 ───
    const u2 = conn(userCookie);
    let u2Paired = false, u2Failed = null;
    u2.on('paired', () => u2Paired = true);
    u2.on('call-failed', (d) => u2Failed = d.reason);
    await new Promise(r => u2.on('connect', r));
    u2.emit('user-enter');
    await wait(200);
    u2.emit('user-call', { bjUserIdTarget: BJ_USER_ID, kind: 'call', context: {} });
    await wait(500);
    if (u2Paired) ok('2차 재통화 매칭 성공 (재연결 버그 해결)');
    else no('2차 재통화 실패 — reason: ' + (u2Failed || '(no response)'));

    // ─── 3차: busy 체크 — u2 통화중에 u3 시도 ───
    const u3 = conn(userCookie);
    let u3Failed = null;
    u3.on('call-failed', (d) => u3Failed = d.reason);
    u3.on('paired', () => u3Failed = 'WRONGLY_PAIRED');
    await new Promise(r => u3.on('connect', r));
    u3.emit('user-enter');
    await wait(200);
    u3.emit('user-call', { bjUserIdTarget: BJ_USER_ID, kind: 'call', context: {} });
    await wait(400);
    if (u3Failed === 'BJ_BUSY') ok('통화중 BJ → 3번째 사용자 BJ_BUSY 반환');
    else no('busy 처리 이상 — ' + (u3Failed || '(매칭됨/무응답)'));

    // ─── 4차: 오프라인 BJ ───
    const u4 = conn(userCookie);
    let u4Failed = null;
    u4.on('call-failed', (d) => u4Failed = d.reason);
    await new Promise(r => u4.on('connect', r));
    u4.emit('user-enter');
    await wait(200);
    u4.emit('user-call', { bjUserIdTarget: 999, kind: 'call', context: {} });
    await wait(400);
    if (u4Failed === 'BJ_OFFLINE') ok('없는 BJ → BJ_OFFLINE 반환');
    else no('offline 처리 이상 — ' + (u4Failed || '(무응답)'));

    console.log(`\n결과: ${pass} 통과 / ${fail} 실패`);
    [bj, u2, u3, u4].forEach(s => s.disconnect());
    process.exit(fail ? 1 : 0);
})();
