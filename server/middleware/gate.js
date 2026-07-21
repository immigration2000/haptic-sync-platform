/**
 * 사이트 출입 게이트 (HTTP Basic 인증)
 * 사이트 전체 앞단 관문 — 허가된 아이디/비번을 가진 사람만 진입.
 * 앱 내부 회원 로그인과는 별개. 자격은 data/gate.json 에서 관리(코드 수정 불필요).
 *
 * data/gate.json 예시:
 * {
 *   "enabled": true,
 *   "realm": "Syncra",
 *   "users": [ { "user": "syncra", "pass": "비번" } ]
 * }
 * enabled=false 또는 users 비면 게이트 통과(무가동).
 */
const fs   = require('fs');
const path = require('path');

const GATE_FILE = path.join(__dirname, '..', '..', 'data', 'gate.json');

function loadGate() {
    try {
        const j = JSON.parse(fs.readFileSync(GATE_FILE, 'utf8'));
        return {
            enabled: j.enabled !== false,
            realm:   j.realm || 'Syncra',
            users:   Array.isArray(j.users) ? j.users : [],
        };
    } catch (_) {
        return { enabled: false, realm: 'Syncra', users: [] };
    }
}

let gate = loadGate();
// gate.json 이 바뀌면 자동 재로딩 (재시작 없이 자격 변경 반영, 저트래픽이라 watch로 충분)
try { fs.watchFile(GATE_FILE, { interval: 5000 }, () => { gate = loadGate(); }); } catch (_) {}

// 게이트 없이 통과할 경로 — 헬스체크는 터널/모니터링용으로 항상 열어둠
const BYPASS = new Set(['/health', '/favicon.ico']);

function safeEqual(a, b) {
    a = String(a); b = String(b);
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
}

module.exports = function siteGate(req, res, next) {
    if (!gate.enabled || gate.users.length === 0) return next();
    if (BYPASS.has(req.path)) return next();

    const hdr = req.headers.authorization || '';
    if (hdr.startsWith('Basic ')) {
        let decoded = '';
        try { decoded = Buffer.from(hdr.slice(6), 'base64').toString('utf8'); } catch (_) {}
        const idx  = decoded.indexOf(':');
        const user = idx >= 0 ? decoded.slice(0, idx) : decoded;
        const pass = idx >= 0 ? decoded.slice(idx + 1) : '';
        const ok = gate.users.some(u => safeEqual(u.user, user) && safeEqual(u.pass, pass));
        if (ok) return next();
    }
    res.set('WWW-Authenticate', `Basic realm="${gate.realm}", charset="UTF-8"`);
    res.set('Cache-Control', 'no-store');
    return res.status(401).send('🔒 접근 권한이 필요합니다 — 허가된 계정만 입장할 수 있습니다.\nAuthorization required.');
};
