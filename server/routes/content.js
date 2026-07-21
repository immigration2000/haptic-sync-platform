const express = require('express');
const router = express.Router();
const { stmts } = require('../db');
const { requireAgeVerified } = require('../middleware/auth');
const { videoAccess } = require('../access');
const vrConfig = require('../vr_config');

// ── 영상 탭: VOD ──
router.get('/vod', requireAgeVerified, (req, res) => {
    const q = (req.query.q || '').toLowerCase();
    let items = stmts.listContents.all('vod');
    if (q) items = items.filter(c => (c.title + c.tags + c.description).toLowerCase().includes(q));
    res.render('content/list', { title: '영상 · VOD', tab: 'vod', kind: 'vod', items, query: q });
});

// ── 영상 탭: VR ──
router.get('/vr', requireAgeVerified, (req, res) => {
    const q = (req.query.q || '').toLowerCase();
    let items = stmts.listContents.all('vr');
    if (q) items = items.filter(c => (c.title + c.tags + c.description).toLowerCase().includes(q));
    res.render('content/list', { title: '영상 · VR', tab: 'vr', kind: 'vr', items, query: q });
});

// ── 영상 탭: 구독자전용 영상 (전체 스트리머 업로드 영상, 접근상태 표시) ──
router.get('/videos', requireAgeVerified, (req, res) => {
    const q = (req.query.q || '').toLowerCase();
    let rows = stmts.listAllBJVideos.all();
    if (q) rows = rows.filter(v => (v.title + ' ' + v.stage_name).toLowerCase().includes(q));
    const videos = rows.map(v => {
        const acc = videoAccess(req.user.id, v);
        return Object.assign({}, v, { locked: !acc.allowed, accessReason: acc.reason });
    });
    res.render('content/videos', { title: '영상 · 구독자전용', tab: 'videos', videos, query: q });
});

// ── 영상 탭: 스트리머 채널 (라이브러리 보유 스트리머) ──
router.get('/streamers', requireAgeVerified, (req, res) => {
    let libraries = [];
    try { libraries = stmts.listStreamerLibraries.all(); } catch (_) {}
    res.render('content/streamers', { title: '영상 · 스트리머 채널', tab: 'streamers', libraries });
});

// 플레이어
router.get('/play/:id', requireAgeVerified, (req, res) => {
    const id = parseInt(req.params.id, 10);
    const item = stmts.findContent.get(id);
    if (!item) return res.redirect('/content/vod');
    stmts.bumpViewCount.run(id);
    res.render('content/player', {
        title: item.title, item,
        vrDefaults: item.type === 'vr' ? vrConfig.get() : null,
    });
});

// 시청기록 저장 (영상 종료/이탈 시)
router.post('/track-watch', requireAgeVerified, express.json(), (req, res) => {
    const { contentId, position } = req.body;
    if (!contentId) return res.json({ ok: false });
    stmts.upsertWatch.run(req.user.id, contentId, Math.floor(position || 0));
    res.json({ ok: true });
});

module.exports = router;
