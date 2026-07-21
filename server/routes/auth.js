const express = require('express');
const bcrypt  = require('bcryptjs');
const crypto  = require('crypto');
const router  = express.Router();
const { stmts } = require('../db');
const mailer  = require('../mailer');
const { requireLogin } = require('../middleware/auth');

// ── 헬퍼 ─────────────────────────────────────────────────
function isValidEmail(email) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email); }
function makeToken() { return crypto.randomBytes(32).toString('hex'); }

// ── GET pages ────────────────────────────────────────────
router.get('/login', (req, res) => {
    if (req.user) return res.redirect('/');
    res.render('auth/login', { title: '로그인', next: req.query.next || '/', error: req.session.flash });
    req.session.flash = null;
});

router.get('/register', (req, res) => {
    if (req.user) return res.redirect('/');
    res.render('auth/register', { title: '회원가입', error: req.session.flash });
    req.session.flash = null;
});

router.get('/verify-age', (req, res) => {
    if (!req.user) return res.redirect('/auth/login');
    if (req.user.age_verified) return res.redirect('/');
    res.render('auth/verify_age', { title: '연령 인증' });
});

router.get('/forgot', (req, res) => {
    res.render('auth/forgot', { title: '비밀번호 찾기', error: req.session.flash, sent: req.query.sent === '1' });
    req.session.flash = null;
});

router.get('/reset/:token', (req, res) => {
    const row = stmts.findToken.get(req.params.token, 'reset_password');
    if (!row) return res.render('error', { title: '만료', message: '비밀번호 재설정 링크가 만료되었거나 잘못되었습니다.' });
    res.render('auth/reset', { title: '비밀번호 재설정', token: req.params.token, error: req.session.flash });
    req.session.flash = null;
});

router.get('/verify/:token', (req, res) => {
    const row = stmts.findToken.get(req.params.token, 'verify_email');
    if (!row) return res.render('error', { title: '만료', message: '이메일 확인 링크가 만료되었거나 잘못되었습니다.' });
    stmts.markTokenUsed.run(req.params.token);
    stmts.updateAgeVerified.run(row.user_id); // 데모상 19+ 같이 마킹
    res.render('auth/verify_done', { title: '이메일 확인 완료' });
});

router.get('/logout', (req, res) => {
    req.session.destroy(() => res.redirect('/'));
});

// ── POST handlers ────────────────────────────────────────
router.post('/register', async (req, res) => {
    const { email, password, password2, nickname, age_confirm } = req.body;

    if (!email || !password || !nickname) {
        req.session.flash = '모든 필드를 입력해주세요.'; return res.redirect('/auth/register');
    }
    if (!isValidEmail(email)) {
        req.session.flash = '올바른 이메일 형식이 아닙니다.'; return res.redirect('/auth/register');
    }
    if (password !== password2) {
        req.session.flash = '비밀번호가 일치하지 않습니다.'; return res.redirect('/auth/register');
    }
    if (password.length < 8) {
        req.session.flash = '비밀번호는 8자 이상이어야 합니다.'; return res.redirect('/auth/register');
    }
    if (nickname.length < 2 || nickname.length > 20) {
        req.session.flash = '닉네임은 2~20자.'; return res.redirect('/auth/register');
    }
    if (!age_confirm) {
        req.session.flash = '만 19세 이상 동의 필요.'; return res.redirect('/auth/register');
    }
    if (stmts.findUserByEmail.get(email)) {
        req.session.flash = '이미 사용 중인 이메일.'; return res.redirect('/auth/register');
    }
    if (stmts.findUserByNick.get(nickname)) {
        req.session.flash = '이미 사용 중인 닉네임.'; return res.redirect('/auth/register');
    }

    const hash = await bcrypt.hash(password, 10);
    // age_verified = 0 (이메일 인증 후 1로)
    const r = stmts.insertUser.run(email, hash, nickname, 'user', 0);
    const newId = r.lastInsertRowid;
    stmts.updateCredits.run(1000, newId);
    stmts.insertTx.run(newId, 'reward', 1000, 1000, '가입 보너스');

    // 이메일 인증 토큰
    const token = makeToken();
    const expires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    stmts.insertToken.run(token, newId, 'verify_email', expires);
    const verifyUrl = `${req.protocol}://${req.get('host')}/auth/verify/${token}`;
    await mailer.send({
        to: email,
        subject: '[PULSE] 이메일 인증',
        text: `PULSE 가입을 환영합니다!\n\n아래 링크를 24시간 안에 클릭해서 이메일을 확인해주세요:\n${verifyUrl}\n\n이 메일을 요청하지 않으셨다면 무시하세요.`,
    });

    req.session.userId = newId;
    req.session.save(() => res.redirect('/auth/verify-sent?email=' + encodeURIComponent(email)));
});

router.get('/verify-sent', (req, res) => {
    res.render('auth/verify_sent', { title: '이메일 확인', email: req.query.email });
});

router.post('/login', async (req, res) => {
    const { email, password, next: nextUrl } = req.body;
    const user = stmts.findUserByEmail.get(email);
    if (!user) {
        req.session.flash = '존재하지 않는 계정.'; return res.redirect('/auth/login');
    }
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) {
        req.session.flash = '비밀번호가 틀렸습니다.'; return res.redirect('/auth/login');
    }
    req.session.userId = user.id;
    req.session.save(() => res.redirect(nextUrl || '/'));
});

router.post('/verify-age', (req, res) => {
    if (!req.user) return res.redirect('/auth/login');
    if (req.body.confirm) stmts.updateAgeVerified.run(req.user.id);
    res.redirect('/');
});

router.post('/forgot', async (req, res) => {
    const { email } = req.body;
    const user = email ? stmts.findUserByEmail.get(email) : null;
    if (user) {
        const token = makeToken();
        const expires = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1시간
        stmts.insertToken.run(token, user.id, 'reset_password', expires);
        const url = `${req.protocol}://${req.get('host')}/auth/reset/${token}`;
        await mailer.send({
            to: email,
            subject: '[PULSE] 비밀번호 재설정',
            text: `비밀번호 재설정 링크 (1시간 유효):\n${url}\n\n요청하지 않으셨다면 이 메일을 무시하세요.`,
        });
    }
    // 이메일 노출 방지를 위해 항상 동일 응답
    res.redirect('/auth/forgot?sent=1');
});

router.post('/reset/:token', async (req, res) => {
    const row = stmts.findToken.get(req.params.token, 'reset_password');
    if (!row) return res.render('error', { title: '만료', message: '링크가 만료되었습니다.' });
    const { password, password2 } = req.body;
    if (!password || password.length < 8) {
        req.session.flash = '비밀번호 8자 이상.'; return res.redirect('/auth/reset/' + req.params.token);
    }
    if (password !== password2) {
        req.session.flash = '비밀번호 불일치.'; return res.redirect('/auth/reset/' + req.params.token);
    }
    const hash = await bcrypt.hash(password, 10);
    stmts.updatePassword.run(hash, row.user_id);
    stmts.markTokenUsed.run(req.params.token);
    res.render('auth/reset_done', { title: '비밀번호 변경 완료' });
});

module.exports = router;
