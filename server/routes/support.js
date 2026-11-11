const express = require('express');
const router = express.Router();
const { stmts } = require('../db');
const { requireLogin } = require('../middleware/auth');
const cfg = require('../config');

const REPORT_TARGETS = ['content', 'bj', 'user', 'post', 'comment', 'other'];
const REPORT_REASONS = ['illegal', 'underage', 'abuse', 'spam', 'copyright', 'other'];
function isEmail(s) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s || ''); }

// 고객센터 안내
router.get('/', (req, res) => {
    res.render('support/index', { title: '고객센터' });
});

// 문의 작성 (로그인 필수 아님)
router.get('/contact', (req, res) => {
    res.render('support/contact', { title: '문의하기', sent: req.query.sent === '1' });
});

router.post('/contact', express.urlencoded({ extended: false }), (req, res) => {
    const { subject, body, email } = req.body;
    if (!subject || !body) return res.redirect('/support/contact');
    // 로그인 상태면 본인 이메일로 고정(사칭 방지), 비로그인은 입력 이메일 형식 검증
    const contactEmail = req.user ? req.user.email : (isEmail(email) ? email : null);
    if (!req.user && !contactEmail) return res.redirect('/support/contact');
    stmts.insertTicket.run(req.user ? req.user.id : null, contactEmail, subject.slice(0, 200), body.slice(0, 2000));
    res.redirect('/support/contact?sent=1');
});

// 신고 (콘텐츠/BJ/사용자) — 로그인 필수(허위신고 추적성) + 화이트리스트 검증
router.get('/report', requireLogin, (req, res) => {
    res.render('support/report', { title: '신고하기', sent: req.query.sent === '1' });
});

router.post('/report', requireLogin, express.urlencoded({ extended: false }), (req, res) => {
    const { target_type, target_id, reason_code, detail } = req.body;
    if (!REPORT_TARGETS.includes(target_type) || !REPORT_REASONS.includes(reason_code)) {
        return res.redirect('/support/report');
    }
    const tid = parseInt(target_id, 10);
    stmts.insertReport.run(
        req.user.id,
        target_type,
        Number.isInteger(tid) ? tid : null,
        reason_code,
        (detail || '').slice(0, 500),
    );
    res.redirect('/support/report?sent=1');
});

/**
 * 쿠키 정리 — **이 사이트(출처) 쿠키만** 지운다. 다른 사이트는 건드릴 수 없다(브라우저 보안).
 *
 * ⚠ 왜 서버 라우트인가: 우리 쿠키 둘(`pulse.sid`, `pulse-csrf`)이 **HttpOnly** 라
 *   자바스크립트에서 보이지도, 지워지지도 않는다. 서버가 만료시켜야 한다.
 *
 * 세 겹으로 지운다 — 브라우저마다 지원이 달라서:
 *   ① `Clear-Site-Data` 헤더 — 크롬·엣지·파이어폭스. 출처의 쿠키를 통째로 비운다.
 *      **HTTPS 에서만 동작**하므로 LAN http 테스트에서는 무시된다.
 *   ② `res.clearCookie()` — 우리가 아는 쿠키를 명시적으로 만료 (사파리·http 대비)
 *   ③ 완료 페이지의 JS — HttpOnly 가 아닌 잔여 쿠키 정리
 *
 * 로그인 필수 아님 — **세션이 깨진 사람이 쓰는 기능**이다.
 */
router.get('/cookies', (req, res) => {
    res.render('support/cookies', { title: '쿠키 정리' });
});

router.post('/cookies', express.urlencoded({ extended: false }), (req, res) => {
    // 기본은 '전부' 다. 이 버튼을 누르는 사람은 이미 뭔가 깨진 상태이고,
    //   2026-11-12 제보처럼 **캐시에 남은 옛 JS** 가 범인인 경우가 많다
    //   (카메라 송출 불가 → 사이트 데이터 삭제 + Ctrl+Shift+R 로만 정상화).
    // 'keep=1' 이면 장치·재생 설정(localStorage)만 남긴다.
    const keepSettings = req.body.keep === '1';

    const finish = () => {
        // ② 우리가 아는 쿠키를 명시적으로 만료. 설정이 다르면 브라우저가 다른 쿠키로 보므로
        //    세션/CSRF 를 심을 때와 **같은 옵션**으로 지워야 한다.
        const opts = { path: '/', httpOnly: true, sameSite: 'lax', secure: cfg.behindProxy };
        res.clearCookie('pulse.sid', opts);
        res.clearCookie('pulse-csrf', opts);

        // ① 표준 헤더 (HTTPS 전용).
        //    'cache' 가 Ctrl+Shift+R 의 역할을 한다 — 한 번 비우는 것이라 더 확실하다.
        //    'storage' 는 localStorage(장치 선택 등) · IndexedDB · Cache API.
        const parts = keepSettings ? ['"cookies"', '"cache"'] : ['"cookies"', '"storage"', '"cache"'];
        res.set('Clear-Site-Data', parts.join(', '));
        // 이 응답 자체가 캐시에 남으면 안 된다
        res.set('Cache-Control', 'no-store, max-age=0');
        res.render('support/cookies_done', { title: '정리 완료', keepSettings });
    };

    if (req.session) req.session.destroy(() => finish());
    else finish();
});

// FAQ / 디바이스 가이드
router.get('/faq',          (req, res) => res.render('support/faq',    { title: 'FAQ' }));
router.get('/device-guide', (req, res) => res.render('support/device', { title: '디바이스 연결 가이드' }));

module.exports = router;
