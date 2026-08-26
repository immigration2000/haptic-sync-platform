const express = require('express');
const router = express.Router();
const { stmts, getSettingBool, getSetting, setSetting } = require('../db');
const vrConfig = require('../vr_config');
const { requireRole } = require('../middleware/auth');
const tagEngine = require('../tags');
const { provisionStreamer } = require('../services/account_provision');
const diskGuard = require('../disk_guard');
const fs   = require('fs');
const path = require('path');

/** 같은 base의 축 스크립트가 실제로 있는지 — 다축 배지는 이걸로 판단한다.
 *  스크립트가 있다는 것만으로 '다축'이라고 표시하면 단축 영상에 잘못된 배지가 붙는다. */
function hasMultiAxis(scriptPath) {
    if (!scriptPath) return false;
    const abs  = path.join(__dirname, '..', '..', 'public', scriptPath.replace(/^\//, ''));
    const base = abs.replace(/\.(funscript|json)$/i, '');
    const ext  = (abs.match(/\.(funscript|json)$/i) || ['.funscript'])[0];
    return ['.roll', '.twist', '.pitch', '.surge', '.sway']
        .some(a => { try { return fs.existsSync(base + a + ext); } catch (_) { return false; } });
}

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
        disk: diskGuard.status(),
        strokeGainMin: parseFloat(getSetting('stroke_gain_min', '-80')),
        strokeGainMax: parseFloat(getSetting('stroke_gain_max', '80')),
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
            vr_hfov, vr_fisheye, vr_pitch, vr_yaw,
            upload_max_file_mb, upload_quota_user_gb, upload_min_free_gb } = req.body;
    // 업로드 용량 가드 (server/disk_guard.js) — 0 이하/비숫자는 무시하고 기존값 유지
    const numSet = (key, v, min, max) => {
        const n = parseFloat(v);
        if (!isNaN(n) && n >= min && n <= max) setSetting(key, String(n));
    };
    numSet('upload_max_file_mb',   upload_max_file_mb,   50, 4000);
    numSet('upload_quota_user_gb', upload_quota_user_gb,  1,  500);
    numSet('upload_min_free_gb',   upload_min_free_gb,    1,  200);
    // 강도 슬라이더 범위(%). 0%가 원본 그대로이므로 음수~양수로 잡는다.
    numSet('stroke_gain_min', req.body.stroke_gain_min, -100, 0);
    numSet('stroke_gain_max', req.body.stroke_gain_max, 0, 500);
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
// ── 스트리머 계정 발급 (콘텐츠 작업자용) ──────────────────────────
router.get('/streamers', (req, res) => {
    res.render('admin/streamers', {
        title: '스트리머 계정',
        accounts: stmts.listStreamerAccounts.all(),
        ok:       req.session.flashOk || null,
        issued:   req.session.flashIssued || null,   // 발급 직후 1회만 표시
        err:      req.session.flashErr || null,
    });
    // 비밀번호는 화면에 한 번만 — 새로고침하면 사라진다
    req.session.flashIssued = null;
    req.session.flashErr = null;
    req.session.flashOk = null;
});

// 구독가 설정 — 이게 없으면 '구독 전용' 영상을 아무도 볼 수 없다.
// (가격 0 = 구독 전용인데 구독가도 0이면 구독할 방법 자체가 없다)
router.post('/streamers/:id/subscription', (req, res) => {
    const id = parseInt(req.params.id, 10);
    let price = parseInt(req.body.sub_price || '0', 10);
    let days  = parseInt(req.body.sub_days  || '30', 10);
    if (isNaN(price) || price < 0) price = 0;
    if (price > 1000000) price = 1000000;
    if (isNaN(days) || days < 1) days = 30;
    if (days > 3650) days = 3650;

    if (!id || !stmts.findBJ.get(id)) {
        req.session.flashErr = '스트리머를 찾을 수 없습니다.';
    } else {
        stmts.setBJSubscription.run(price, days, id);
        req.session.flashOk = price > 0
            ? `구독가를 ${price.toLocaleString()} Ruby / ${days}일로 설정했습니다.`
            : '구독을 사용하지 않도록 설정했습니다. (구독 전용 영상은 볼 수 없게 됩니다)';
    }
    res.redirect('/admin/streamers');
});

router.post('/streamers/create', (req, res) => {
    const r = provisionStreamer({
        loginId:   req.body.login_id,
        stageName: req.body.stage_name,
        password:  (req.body.password || '').trim() || undefined,
        subPrice:  req.body.sub_price,
        subDays:   req.body.sub_days,
    });
    if (!r.ok) {
        req.session.flashErr = r.error;
    } else {
        req.session.flashIssued = {
            loginId: r.loginId, stageName: r.stageName,
            password: r.password, generated: r.generated, created: r.created,
        };
    }
    res.redirect('/admin/streamers');
});

router.get('/contents', (req, res) => {
    const contents = stmts.listAllContents.all().map(c => {
        let t = [];
        try { t = stmts.listVideoTags.all('content', c.id).map(x => x.name); } catch (_) {}
        return Object.assign({}, c, { tagStr: t.join(',') });
    });
    // 스트리머가 올린 영상 — 카탈로그 승격 대상. 이미 올라간 건 표시해서 중복을 막는다.
    const bjVideos = stmts.listAllBJVideos.all().map(v => {
        const promoted = stmts.findContentByPath.get(v.video_path);
        return Object.assign({}, v, { promoted: promoted || null });
    });

    res.render('admin/contents', {
        title: '콘텐츠 관리', contents, bjVideos,
        approvedTags: stmts.listApprovedTags.all().slice(0, 30),
        ok: req.session.flashOk,
        err: req.session.flashErr || null,
    });
    req.session.flashOk = null;
    req.session.flashErr = null;
});

// ── 스트리머 업로드 → 플랫폼 카탈로그 승격 ────────────────────────
// 파일을 복사하지 않고 같은 경로를 참조한다. 폰 저장공간에서 2GB 영상을
// 복사하는 건 현실적이지 않고, 어차피 같은 정적 경로로 서빙된다.
// 대신 원본이 지워지면 카탈로그가 깨지므로 bj_studio 삭제 쪽에 가드를 뒀다.
router.post('/contents/promote', (req, res) => {
    const vid = parseInt(req.body.video_id, 10);
    const v = vid ? stmts.findBJVideoById.get(vid) : null;
    if (!v) {
        req.session.flashErr = '대상 영상을 찾을 수 없습니다.';
        return res.redirect('/admin/contents');
    }
    if (stmts.findContentByPath.get(v.video_path)) {
        req.session.flashErr = '이미 카탈로그에 등재된 영상입니다.';
        return res.redirect('/admin/contents');
    }

    const type  = ['vod', 'vr', 'volumetric'].includes(req.body.type) ? req.body.type : 'vod';
    const title = (req.body.title || v.title || '').trim().slice(0, 120);
    if (!title) {
        req.session.flashErr = '제목이 비어 있습니다.';
        return res.redirect('/admin/contents');
    }
    let price = parseInt(req.body.price || '0', 10);
    if (isNaN(price) || price < 0) price = 0;

    const r = stmts.insertContent.run(
        type, title, (req.body.description || '').trim(), (req.body.creator || '').trim(),
        v.video_path, v.script_path || null, v.thumb_key || null,
        0, price, '', hasMultiAxis(v.script_path) ? 1 : 0,
    );
    // 태그는 태그 엔진을 거쳐야 운영모드·CORE_BLOCK이 적용된다 (직접 넣지 말 것)
    if ((req.body.tags || '').trim()) {
        try { tagEngine.submitForVideo('content', Number(r.lastInsertRowid), req.body.tags, req.user.id); } catch (_) {}
    }
    req.session.flashOk = `'${title}' 을(를) 카탈로그에 등재했습니다.`;
    res.redirect('/admin/contents');
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
