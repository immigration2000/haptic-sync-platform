/**
 * CSRF 보호 (csrf-csrf double-submit) — app.js와 멀티파트 라우트(bj_studio)에서 공유
 *
 * 토큰 소스: x-csrf-token 헤더(JS fetch) 또는 폼 필드 _csrf(HTML form)
 * 세션 식별자는 req.session.id를 쓰며, app.js에서 세션을 강제 초기화해 id를 안정화한다.
 */
const { doubleCsrf } = require('csrf-csrf');
const cfg = require('../config');

// csrf-csrf v3: 반환 함수는 generateToken. req.cookies 필요 → app.js에서 cookie-parser 적용.
const { generateToken, doubleCsrfProtection } = doubleCsrf({
    getSecret: () => cfg.csrfSecret,
    getSessionIdentifier: (req) => (req.session && req.session.id) || req.ip || 'anon',
    cookieName: 'pulse-csrf',
    cookieOptions: { httpOnly: true, sameSite: 'lax', secure: cfg.behindProxy, path: '/' },
    size: 32,
    ignoredMethods: ['GET', 'HEAD', 'OPTIONS'],
    getTokenFromRequest: (req) =>
        req.headers['x-csrf-token'] || (req.body && req.body._csrf),
});

module.exports = { generateCsrfToken: generateToken, doubleCsrfProtection };
