const express = require('express');
const router = express.Router();
const { stmts } = require('../db');
const { requireLogin } = require('../middleware/auth');

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

// FAQ / 디바이스 가이드
router.get('/faq',          (req, res) => res.render('support/faq',    { title: 'FAQ' }));
router.get('/device-guide', (req, res) => res.render('support/device', { title: '디바이스 연결 가이드' }));

module.exports = router;
