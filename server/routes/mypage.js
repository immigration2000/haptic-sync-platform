const express = require('express');
const bcrypt  = require('bcryptjs');
const router  = express.Router();
const { stmts, adjustCredits } = require('../db');
const { requireLogin } = require('../middleware/auth');

router.use(requireLogin);

router.get('/', (req, res) => {
    res.render('mypage/home', { title: '마이페이지' });
});

// 계정 설정
router.get('/settings', (req, res) => {
    res.render('mypage/settings', { title: '계정 설정', error: req.session.flash, ok: req.session.flashOk });
    req.session.flash = null; req.session.flashOk = null;
});

router.post('/settings/password', async (req, res) => {
    const { current, password, password2 } = req.body;
    const user = stmts.findUserById.get(req.user.id);
    const ok = await bcrypt.compare(current || '', user.password_hash);
    if (!ok) { req.session.flash = '현재 비밀번호가 틀렸습니다.'; return res.redirect('/mypage/settings'); }
    if (!password || password.length < 8) { req.session.flash = '새 비밀번호 8자 이상.'; return res.redirect('/mypage/settings'); }
    if (password !== password2) { req.session.flash = '비밀번호 불일치.'; return res.redirect('/mypage/settings'); }
    const hash = await bcrypt.hash(password, 10);
    stmts.updatePassword.run(hash, req.user.id);
    req.session.flashOk = '비밀번호가 변경되었습니다.';
    res.redirect('/mypage/settings');
});

router.post('/settings/nickname', (req, res) => {
    const nickname = (req.body.nickname || '').trim();
    if (nickname.length < 2 || nickname.length > 20) {
        req.session.flash = '닉네임 2~20자.'; return res.redirect('/mypage/settings');
    }
    if (stmts.findUserByNick.get(nickname) && nickname !== req.user.nickname) {
        req.session.flash = '이미 사용 중인 닉네임.'; return res.redirect('/mypage/settings');
    }
    stmts.updateNickname.run(nickname, req.user.id);
    req.session.flashOk = '닉네임 변경 완료.';
    res.redirect('/mypage/settings');
});

router.post('/settings/delete', async (req, res) => {
    const { password, confirm } = req.body;
    if (confirm !== '계정삭제') {
        req.session.flash = '"계정삭제" 정확히 입력.'; return res.redirect('/mypage/settings');
    }
    const user = stmts.findUserById.get(req.user.id);
    const ok = await bcrypt.compare(password || '', user.password_hash);
    if (!ok) { req.session.flash = '비밀번호 확인 실패.'; return res.redirect('/mypage/settings'); }
    stmts.deleteUser.run(req.user.id);
    req.session.destroy(() => res.redirect('/'));
});

// BJ 신청
router.get('/bj-apply', (req, res) => {
    if (req.user.role === 'bj' || req.user.role === 'admin') return res.redirect('/bj/console');
    const existing = stmts.findBJAppByUser.get(req.user.id);
    res.render('mypage/bj_apply', { title: '스트리머 신청', existing, error: req.session.flash });
    req.session.flash = null;
});

router.post('/bj-apply', (req, res) => {
    const { stage_name, description, intro_message } = req.body;
    if (!stage_name || stage_name.length < 2) {
        req.session.flash = '활동명 2자 이상.'; return res.redirect('/mypage/bj-apply');
    }
    const existing = stmts.findBJAppByUser.get(req.user.id);
    if (existing && existing.status === 'pending') {
        req.session.flash = '이미 심사 중인 신청이 있습니다.'; return res.redirect('/mypage/bj-apply');
    }
    stmts.insertBJApp.run(req.user.id, stage_name, description || '', intro_message || '');
    res.redirect('/mypage/bj-apply?submitted=1');
});

router.get('/billing', requireLogin, (req, res) => {
    const txs = stmts.listTx.all(req.user.id);
    const subs = stmts.listSubs.all(req.user.id);
    res.render('mypage/billing', { title: '결제 / 충전', txs, subs });
});

router.get('/history', requireLogin, (req, res) => {
    const items = stmts.listWatchHistory.all(req.user.id);
    res.render('mypage/history', { title: '시청 기록', items });
});

// Ruby 충전 (mock — 실제 PG 없이 즉시 충전)
router.post('/charge', requireLogin, express.urlencoded({ extended: false }), (req, res) => {
    const amount = parseInt(req.body.amount || '0', 10);
    if (amount <= 0 || amount > 100000) {
        return res.status(400).send('Invalid amount');
    }
    adjustCredits(req.user.id, amount, 'charge', `Ruby 충전 (mock): +${amount}`);
    res.redirect('/mypage/billing?charged=1');
});

// 구독 (mock)
router.post('/subscribe', requireLogin, express.urlencoded({ extended: false }), (req, res) => {
    const tier = req.body.tier;
    const tiers = { basic: 9900, premium: 19900, vip: 39900 };
    const price = tiers[tier];
    if (!price) return res.status(400).send('Invalid tier');

    // 30일 구독
    const endAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    try {
        adjustCredits(req.user.id, -price, 'spend', `${tier.toUpperCase()} 구독 30일`);
    } catch (e) {
        return res.redirect('/mypage/billing?error=insufficient');
    }
    stmts.insertSub.run(req.user.id, tier, endAt);
    stmts.updateSubscription.run(endAt, req.user.id);
    res.redirect('/mypage/billing?subscribed=1');
});

module.exports = router;
