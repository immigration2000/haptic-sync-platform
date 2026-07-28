const express = require('express');
const router = express.Router();
const { stmts, getSettingBool, getSetting, setSetting } = require('../db');
const vrConfig = require('../vr_config');
const { requireRole } = require('../middleware/auth');
const tagEngine = require('../tags');

router.use(requireRole('admin'));

// Dashboard
router.get('/', (req, res) => {
    const stats = {
        users:        stmts.countUsers.get().c,
        bjs:          stmts.countBJs.get().c,
        contents:     stmts.countContents.get().c,
        sumCharges:   stmts.sumCharges.get().s,
        sumSpends:    -stmts.sumSpends.get().s,
        dummyRooms:   stmts.listDummyRooms.all().length,
        pendingApps:  stmts.countPendingApps.get().c,
        openReports:  stmts.countOpenReports.get().c,
    };
    res.render('admin/dashboard', {
        title: '관리자', stats,
        dummyEnabled: getSettingBool('dummy_bj_enabled', true),
        siteMessage:  getSetting('site_message', ''),
        maintMode:    getSettingBool('maintenance_mode', false),
        vrReproject:  vrConfig.get(),
    });
});

router.get('/users', (req, res) => res.render('admin/users', { title: '회원 관리', users: stmts.recentUsers.all() }));
router.get('/transactions', (req, res) => res.render('admin/transactions', { title: '거래 내역', txs: stmts.recentTxs.all() }));

// 더미 BJ 방
router.get('/dummy', (req, res) => {
    res.render('admin/dummy', {
        title: '더미 스트리머 방',
        rooms: stmts.listDummyRooms.all(),
        enabled: getSettingBool('dummy_bj_enabled', true),
    });
});
router.post('/dummy/toggle/:id', (req, res) => {
    const id = parseInt(req.params.id, 10);
    const room = stmts.listDummyRooms.all().find(r => r.id === id);
    if (room) stmts.toggleDummyRoom.run(room.is_active ? 0 : 1, id);
    res.redirect('/admin/dummy');
});

// 설정
router.post('/settings', (req, res) => {
    const { dummy_bj_enabled, site_message, maintenance_mode,
            vr_hfov, vr_fisheye, vr_pitch, vr_yaw } = req.body;
    setSetting('dummy_bj_enabled',  dummy_bj_enabled === 'on'  ? '1' : '0');
    setSetting('maintenance_mode',  maintenance_mode === 'on' ? '1' : '0');
    setSetting('site_message',      (site_message || '').slice(0, 200));
    // VR 재투영 기본값 (관리자 설정 — 사용자 미조정 시 적용)
    vrConfig.set({ hFovDeg: vr_hfov, fisheyeFovDeg: vr_fisheye, pitchDeg: vr_pitch, yawDeg: vr_yaw });
    res.redirect('/admin?saved=1');
});

// BJ 신청 심사
router.get('/bj-apps', (req, res) => {
    res.render('admin/bj_apps', { title: '스트리머 신청 심사', apps: stmts.listBJApps.all() });
});

router.post('/bj-apps/:id/approve', (req, res) => {
    const id = parseInt(req.params.id, 10);
    const app = stmts.findBJApp.get(id);
    if (!app || app.status !== 'pending') return res.redirect('/admin/bj-apps');
    stmts.approveBJApp.run(req.user.id, id);
    // 사용자를 BJ 역할로 + bj_profile 생성
    stmts.updateUserRole.run('bj', app.user_id);
    try {
        stmts.insertBJProfile.run(app.user_id, app.stage_name, app.description || '', 100, '#신규');
    } catch (_) { /* 이미 있으면 무시 */ }
    res.redirect('/admin/bj-apps');
});

router.post('/bj-apps/:id/reject', (req, res) => {
    const id = parseInt(req.params.id, 10);
    stmts.rejectBJApp.run(req.user.id, id);
    res.redirect('/admin/bj-apps');
});

// 신고
router.get('/reports', (req, res) => {
    res.render('admin/reports', { title: '신고 내역', reports: stmts.listReports.all() });
});

router.post('/reports/:id/resolve', (req, res) => {
    stmts.updateReportStatus.run('resolved', parseInt(req.params.id, 10));
    res.redirect('/admin/reports');
});

// 컨텐츠 (메타 추가)
router.get('/contents', (req, res) => {
    const contents = stmts.listAllContents.all().map(c => {
        let t = [];
        try { t = stmts.listVideoTags.all('content', c.id).map(x => x.name); } catch (_) {}
        return Object.assign({}, c, { tagStr: t.join(',') });
    });
    res.render('admin/contents', {
        title: '콘텐츠 관리', contents,
        approvedTags: stmts.listApprovedTags.all().slice(0, 30),
        ok: req.session.flashOk,
    });
    req.session.flashOk = null;
});

// 사이트 콘텐츠 영상별 태그 — 스트리머 영상과 같은 태그 마스터를 공유
router.post('/contents/:id/tags', (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (stmts.findContent.get(id)) {
        tagEngine.submitForVideo('content', id, req.body.tags, req.user.id);
        req.session.flashOk = '콘텐츠 태그를 저장했습니다.';
    }
    res.redirect('/admin/contents');
});

router.post('/contents/add', (req, res) => {
    const { type, title, description, creator, video_path, script_path, thumbnail_path, duration_sec, price, tags, multi_axis } = req.body;
    if (!type || !title || !video_path) {
        return res.redirect('/admin/contents?error=missing');
    }
    stmts.insertContent.run(
        type, title, description || '', creator || '',
        video_path, script_path || null, thumbnail_path || null,
        parseInt(duration_sec || '0', 10), parseInt(price || '0', 10),
        tags || '', multi_axis === 'on' ? 1 : 0,
    );
    res.redirect('/admin/contents?added=1');
});

// 고객센터 문의 내역
// ─── 커스텀 태그 관리 (운영 모드 전환 · 승인/차단 · 금지어) ───

router.get('/tags', (req, res) => {
    res.render('admin/tags', {
        title: '태그 관리',
        mode: tagEngine.getMode(),
        modes: tagEngine.MODES,
        banned: tagEngine.getBannedWords().join(', '),
        coreBlock: tagEngine.CORE_BLOCK,
        pending: stmts.listTagsByStatus.all('pending'),
        approved: stmts.listTagsByStatus.all('approved'),
        rejected: stmts.listTagsByStatus.all('rejected'),
        ok: req.session.flashOk,
    });
    req.session.flashOk = null;
});

router.post('/tags/mode', (req, res) => {
    tagEngine.setMode(req.body.mode);
    req.session.flashOk = `태그 운영 모드를 '${req.body.mode}'로 변경했습니다.`;
    res.redirect('/admin/tags');
});

router.post('/tags/banned', (req, res) => {
    tagEngine.setBannedWords(req.body.banned);
    req.session.flashOk = '금지어 목록을 저장했습니다.';
    res.redirect('/admin/tags');
});

router.post('/tags/:id/:action', (req, res) => {
    const id = parseInt(req.params.id, 10);
    const act = req.params.action;
    if (act === 'approve')      stmts.setTagStatus.run('approved', id);
    else if (act === 'reject')  stmts.setTagStatus.run('rejected', id);
    else if (act === 'delete')  stmts.deleteTag.run(id);
    req.session.flashOk = '처리 완료.';
    res.redirect('/admin/tags');
});

router.get('/tickets', (req, res) => {
    res.render('admin/tickets', { title: '고객센터 문의', tickets: stmts.listTickets.all() });
});

module.exports = router;
