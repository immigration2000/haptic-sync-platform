const express = require('express');
const router = express.Router();
const { stmts, getSettingBool, adjustCredits } = require('../db');
const { requireAgeVerified, requireRole, requireLogin } = require('../middleware/auth');
const activeSessions = require('../signaling/active_sessions');
const { videoAccess } = require('../access');

// BJ(실제/더미) 요금 정보 조회 헬퍼
function resolveBJ(bjUserId) {
    if (typeof bjUserId === 'string' && bjUserId.startsWith('dummy_')) {
        const id = parseInt(bjUserId.slice(6), 10);
        const d = stmts.listDummyRooms.all().find(r => r.id === id);
        if (!d) return null;
        return {
            id: bjUserId, isDummy: true,
            stage_name: d.stage_name,
            rate_per_minute: d.rate_per_minute,
            rate_with_video: 0, rate_cam: 0,   // 더미는 추가 옵션 없음
            free_preview_sec: d.free_preview_sec,
            session_block_min: d.session_block_min,
        };
    }
    const b = stmts.findBJ.get(parseInt(bjUserId, 10));
    if (!b) return null;
    return {
        id: b.user_id, isDummy: false,
        stage_name: b.stage_name,
        rate_per_minute: b.rate_per_minute,
        rate_with_video: b.rate_with_video || 0,
        rate_cam: b.rate_cam || 0,
        free_preview_sec: b.free_preview_sec,
        session_block_min: b.session_block_min,
    };
}

// 활성 세션의 옵션(tier)에 맞는 분당요율 — 통화/모니터링(video)/캠(cam)
function tierRate(bj, tier) {
    if (tier === 'cam'   && bj.rate_cam > 0)        return bj.rate_cam;
    if (tier === 'video' && bj.rate_with_video > 0) return bj.rate_with_video;
    return bj.rate_per_minute;
}

// 세션 요금 정보 (무료체험·결제단위·가격·잔액)
// 활성 통화 세션이 있으면 그 BJ 기준으로 산정 (클라이언트 파라미터 신뢰 안 함)
router.get('/session/info/:bjUserId', requireLogin, (req, res) => {
    const sess = activeSessions.get(req.user.id);
    const bj = resolveBJ(sess ? sess.bjUserId : req.params.bjUserId);
    if (!bj) return res.status(404).json({ ok: false, reason: 'BJ_NOT_FOUND' });
    const tier = sess ? (sess.tier || 'call') : 'call';
    const ratePerMin = tierRate(bj, tier);
    const cost = bj.session_block_min * ratePerMin;
    res.json({
        ok: true,
        stageName: bj.stage_name,
        freePreviewSec: bj.free_preview_sec,
        blockMin: bj.session_block_min,
        ratePerMin,
        tier,
        withVideo: tier === 'video' && bj.rate_with_video > 0,
        cost,
        balance: req.user.credits,
        affordable: req.user.credits >= cost,
    });
});

// 시간제 결제 — 한 블록(N분) 차감
// 결제 대상 BJ는 클라이언트가 아니라 서버가 보관한 활성 통화 세션에서 결정한다 (요금 우회 방지)
router.post('/session/charge', requireLogin, express.json(), (req, res) => {
    const sess = activeSessions.get(req.user.id);
    if (!sess) return res.status(403).json({ ok: false, reason: 'NO_ACTIVE_SESSION' });
    const bj = resolveBJ(sess.bjUserId);
    if (!bj) return res.status(404).json({ ok: false, reason: 'BJ_NOT_FOUND' });
    const cost = bj.session_block_min * tierRate(bj, sess.tier || 'call');
    if (req.user.credits < cost) {
        return res.json({ ok: false, reason: 'INSUFFICIENT', balance: req.user.credits, needed: cost });
    }
    let balance;
    try {
        balance = adjustCredits(req.user.id, -cost, 'spend',
            `${bj.stage_name} ${bj.session_block_min}분 통화`);
    } catch (e) {
        return res.json({ ok: false, reason: 'CHARGE_FAILED', message: e.message });
    }
    // 실제 BJ면 call_log + 수익 기록 (더미는 생략)
    if (!bj.isDummy) {
        try {
            const r = stmts.insertCallLog.run(req.user.id, bj.id, sess.kind || 'call');
            stmts.closeCallLog.run(bj.session_block_min * 60, cost, r.lastInsertRowid);
        } catch (_) {}
    }
    res.json({
        ok: true,
        blockMin: bj.session_block_min,
        cost,
        balance,
    });
});

// BJ 목록 + (옵션) 더미 방 합치기
router.get('/', requireAgeVerified, (req, res) => {
    let bjs = stmts.listBJs.all();
    // 함께보기 진입이면 1:1 영상통화 제공 스트리머만 (함께보기는 영상통화의 기능으로 흡수됨)
    if (req.query.cowatchContent) {
        const svcTypes = require('../service_types');
        bjs = bjs.filter(b => svcTypes.has(b.services, 'video_1on1'));
    }
    let dummyRooms = [];
    if (getSettingBool('dummy_bj_enabled', true)) {
        dummyRooms = stmts.listActiveDummy.all().map(d => ({
            id: 'dummy_' + d.id,
            stage_name: d.stage_name,
            nickname: d.stage_name,
            description: d.description,
            tags: d.tags,
            rate_per_minute: d.rate_per_minute,
            rating_avg: d.rating_avg,
            is_online: 1,
            is_dummy: true,
            viewer_count: d.viewer_count,
        }));
    }
    const cowatchContent = req.query.cowatchContent
        ? stmts.findContent.get(parseInt(req.query.cowatchContent, 10))
        : null;
    res.render('bj/list', { title: '보이스', bjs, dummyRooms, cowatchContent });
});

// 더미 BJ 방 진입 (단순 데모 — 영상만 재생)
router.get('/dummy/:id', requireAgeVerified, (req, res) => {
    const id = parseInt(req.params.id, 10);
    const room = stmts.listDummyRooms.all().find(r => r.id === id);
    if (!room || !room.is_active) return res.redirect('/bj');
    if (!getSettingBool('dummy_bj_enabled', true)) return res.redirect('/bj');
    res.render('bj/dummy_room', { title: room.stage_name, room });
});

// 통화 시작 (사용자 측)
router.get('/call/:id', requireAgeVerified, (req, res) => {
    const bj = stmts.findBJ.get(parseInt(req.params.id, 10));
    if (!bj) return res.redirect('/bj');
    res.render('bj/call', { title: `${bj.stage_name} 통화`, bj });
});

// BJ 콘솔 (BJ 권한 필요)
router.get('/console', requireRole('bj'), (req, res) => {
    const profile = stmts.findBJ.get(req.user.id);
    res.render('bj/console', { title: '스트리머 콘솔', profile });
});

// BJ 콘솔용 영상 목록 (카탈로그 + 내 업로드)
router.get('/console/videos', requireRole('bj'), (req, res) => {
    const catalog = stmts.listAllContents.all().map(c => ({
        id: 'c' + c.id, title: c.title, type: c.type,
        video: c.video_path, script: c.script_path || '',
        source: 'catalog',
    }));
    let mine = [];
    if (stmts.listBJVideos) {
        try {
            mine = stmts.listBJVideos.all(req.user.id).map(v => ({
                id: 'b' + v.id, title: v.title, type: 'upload',
                video: v.video_path, script: v.script_path || '',
                source: 'mine',
            }));
        } catch (_) {}
    }
    res.json({ ok: true, videos: [...mine, ...catalog] });
});

// #03 BJ 함께보기 — 사용자가 영상 + BJ 선택 후 진입
router.get('/cowatch/:bjId/:contentId', requireAgeVerified, (req, res) => {
    const bj = stmts.findBJ.get(parseInt(req.params.bjId, 10));
    const content = stmts.findContent.get(parseInt(req.params.contentId, 10));
    if (!bj || !content) return res.redirect('/bj');
    res.render('bj/cowatch', { title: `${bj.stage_name}와 함께보기`, bj, content });
});

// #05 BJ 비공개 라이브 (1:1) — 영상+음성+디바이스 풀패키지
router.get('/live/:bjId', requireAgeVerified, (req, res) => {
    const bj = stmts.findBJ.get(parseInt(req.params.bjId, 10));
    if (!bj) return res.redirect('/bj');
    res.render('bj/live_priv', { title: `${bj.stage_name} 비공개 라이브`, bj });
});

// #05 BJ 공개 라이브 — broadcaster 페이지 (BJ 전용)
router.get('/broadcast', requireRole('bj'), (req, res) => {
    const profile = stmts.findBJ.get(req.user.id);
    res.render('bj/broadcast', { title: '공개 라이브 송출', profile });
});

// 공개 라이브 시청자 진입
router.get('/watch/:bjId', requireAgeVerified, (req, res) => {
    const bj = stmts.findBJ.get(parseInt(req.params.bjId, 10));
    if (!bj) return res.redirect('/bj');
    res.render('bj/watch', { title: `${bj.stage_name} LIVE`, bj });
});

// 공개 라이브 로비 (현재 송출 중인 BJ 목록 + 더미)
router.get('/live-lobby', requireAgeVerified, (req, res) => {
    const dummyRooms = getSettingBool('dummy_bj_enabled', true)
        ? stmts.listActiveDummy.all()
        : [];
    res.render('bj/live_lobby', { title: 'LIVE — 진행 중인 방송', dummyRooms });
});

// ─────────────────────────────────────────────────────────
// BJ 영상 라이브러리 (기간제 구독 + 영상별 PPV)
// ─────────────────────────────────────────────────────────

// 라이브러리 페이지 — 구독 상태 + 영상별 잠금/구매/시청
router.get('/:bjId/library', requireAgeVerified, (req, res) => {
    const bjId = parseInt(req.params.bjId, 10);
    if (!Number.isInteger(bjId)) return res.redirect('/bj');
    const bj = stmts.findBJ.get(bjId);
    if (!bj) return res.redirect('/bj');
    const videos = stmts.listBJVideos.all(bjId).map(v => {
        const acc = videoAccess(req.user.id, v);
        return Object.assign({}, v, { locked: !acc.allowed, accessReason: acc.reason });
    });
    const sub = stmts.activeBJSub.get(req.user.id, bjId);
    res.render('bj/library', {
        title: `${bj.stage_name} 영상`, bj, videos, sub,
        isOwner: req.user.id === bjId,
        error: req.session.flash, ok: req.session.flashOk,
    });
    req.session.flash = null; req.session.flashOk = null;
});

// 구독 (기간제) 결제 — Ruby 차감 + 만료일 설정/연장
router.post('/:bjId/subscribe', requireLogin, (req, res) => {
    const bjId = parseInt(req.params.bjId, 10);
    if (!Number.isInteger(bjId)) return res.redirect('/bj');
    const bj = stmts.findBJ.get(bjId);
    if (!bj) return res.redirect('/bj');
    const back = '/bj/' + bjId + '/library';
    if (bjId === req.user.id) return res.redirect(back);
    if (!bj.sub_price || bj.sub_price <= 0) { req.session.flash = '이 BJ는 구독을 제공하지 않습니다.'; return res.redirect(back); }
    try { adjustCredits(req.user.id, -bj.sub_price, 'spend', `${bj.stage_name} 구독 ${bj.sub_days}일`); }
    catch (e) { req.session.flash = '잔액이 부족합니다. 충전 후 다시 시도하세요.'; return res.redirect(back); }
    // 기존 활성 구독이 있으면 그 만료일부터 연장
    const now = new Date();
    let base = now;
    const cur = stmts.activeBJSub.get(req.user.id, bjId);
    if (cur && cur.end_at) { const e = new Date(cur.end_at.replace(' ', 'T') + 'Z'); if (e > now) base = e; }
    const end = new Date(base.getTime() + (bj.sub_days || 30) * 86400000);
    stmts.insertBJSub.run(req.user.id, bjId, end.toISOString().slice(0, 19).replace('T', ' '));
    req.session.flashOk = `구독 완료! ${bj.sub_days}일간 모든 영상을 자유롭게 시청하세요.`;
    res.redirect(back);
});

// 영상 시청 — 접근 게이트(소유자/구독자/구매자)
router.get('/vid/:videoId', requireAgeVerified, (req, res) => {
    const vid = parseInt(req.params.videoId, 10);
    if (!Number.isInteger(vid)) return res.redirect('/bj');
    const v = stmts.findBJVideoById.get(vid);
    if (!v) return res.redirect('/bj');
    const acc = videoAccess(req.user.id, v);
    if (!acc.allowed) return res.redirect('/bj/' + v.bj_user_id + '/library');
    const bj = stmts.findBJ.get(v.bj_user_id);
    const item = {
        id: 0, type: 'bjvideo', title: v.title, creator: bj ? bj.stage_name : 'BJ',
        description: '', video_path: v.video_path, script_path: v.script_path,
        thumbnail_path: null, multi_axis: 0, tags: '',
    };
    res.render('content/player', { title: v.title, item, vrDefaults: null });
});

// 영상 개별구매 (PPV) — 영구 열람
router.post('/vid/:videoId/purchase', requireLogin, (req, res) => {
    const vid = parseInt(req.params.videoId, 10);
    if (!Number.isInteger(vid)) return res.redirect('/bj');
    const v = stmts.findBJVideoById.get(vid);
    if (!v) return res.redirect('/bj');
    if (videoAccess(req.user.id, v).allowed) return res.redirect('/bj/vid/' + vid); // 이미 접근 가능
    const back = '/bj/' + v.bj_user_id + '/library';
    if (!v.price || v.price <= 0) { req.session.flash = '개별구매가 불가한 영상입니다(구독 전용).'; return res.redirect(back); }
    try { adjustCredits(req.user.id, -v.price, 'spend', `영상 구매: ${v.title}`); }
    catch (e) { req.session.flash = '잔액이 부족합니다. 충전 후 다시 시도하세요.'; return res.redirect(back); }
    stmts.insertVideoPurchase.run(req.user.id, vid);
    req.session.flashOk = '구매 완료! 자유롭게 시청하세요.';
    res.redirect('/bj/vid/' + vid);
});

module.exports = router;
