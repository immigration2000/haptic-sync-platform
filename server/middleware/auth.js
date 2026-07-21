/**
 * 인증/연령 미들웨어
 */
const { stmts } = require('../db');

// 세션에 user 정보 매번 새로 주입 (DB 변경분 즉시 반영)
function attachUser(req, res, next) {
    if (req.session && req.session.userId) {
        const user = stmts.findUserById.get(req.session.userId);
        if (user) {
            // password_hash는 응답에서 빼기
            delete user.password_hash;
            req.user = user;
            res.locals.user = user;
        } else {
            req.session.destroy(() => {});
        }
    }
    res.locals.path = req.path; // 네비 active 표시용
    res.locals.req  = req;       // EJS에서 req.query 등 접근 가능
    next();
}

function requireLogin(req, res, next) {
    if (req.user) return next();
    if (req.xhr || req.path.startsWith('/api/')) {
        return res.status(401).json({ error: 'login_required' });
    }
    return res.redirect(`/auth/login?next=${encodeURIComponent(req.originalUrl)}`);
}

function requireAgeVerified(req, res, next) {
    if (!req.user) return res.redirect('/auth/login');
    if (req.user.age_verified) return next();
    return res.redirect('/auth/verify-age');
}

function requireRole(role) {
    return (req, res, next) => {
        if (!req.user) return res.redirect('/auth/login');
        if (req.user.role !== role && req.user.role !== 'admin') {
            return res.status(403).render('error', {
                title: '권한 없음',
                message: `이 페이지는 ${role} 권한이 필요합니다.`
            });
        }
        next();
    };
}

module.exports = { attachUser, requireLogin, requireAgeVerified, requireRole };
