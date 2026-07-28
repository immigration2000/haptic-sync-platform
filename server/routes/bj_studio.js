/**
 * BJ 스튜디오 — 승인된 BJ 전용 페이지
 * - 대시보드 (방송 시작 / 통계 / 빠른 액션)
 * - 프로필 편집 (활동명·설명·요금·태그)
 * - 수익 내역
 * - 통화/방송 기록
 */
const express = require('express');
const path    = require('path');
const fs      = require('fs');
const multer  = require('multer');
const router  = express.Router();
const { stmts } = require('../db');
const { requireRole } = require('../middleware/auth');
const { doubleCsrfProtection } = require('../middleware/csrf');

router.use(requireRole('bj'));

// ── 업로드 설정 (BJ별 폴더) ──
const UPLOAD_ROOT = path.join(__dirname, '..', '..', 'public', 'content', 'bj');
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const dir = path.join(UPLOAD_ROOT, String(req.user.id));
        fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
    },
    filename: (req, file, cb) => {
        const safe = file.originalname.replace(/[^\w.\-]/g, '_');
        cb(null, Date.now() + '_' + safe);
    },
});
const upload = multer({
    storage,
    limits: { fileSize: 2 * 1024 * 1024 * 1024 }, // 2GB
    fileFilter: (req, file, cb) => {
        const ok = /\.(mp4|webm|mov|m4v|funscript|json)$/i.test(file.originalname);
        cb(ok ? null : new Error('지원하지 않는 파일'), ok);
    },
});

// 대시보드
router.get('/', (req, res) => {
    const profile = stmts.findBJ.get(req.user.id);
    const stats   = stmts.bjCallStats.get(req.user.id) || { total_calls: 0, total_seconds: 0, total_earned: 0 };
    res.render('bj_studio/dashboard', { title: '스트리머 스튜디오', profile, stats });
});

// 프로필 편집
router.get('/profile', (req, res) => {
    const profile = stmts.findBJ.get(req.user.id);
    const svcTypes = require('../service_types');
    res.render('bj_studio/profile', {
        title: '프로필 편집', profile,
        serviceTypes: svcTypes.SERVICE_TYPES,
        mySvc: svcTypes.normalizeList(profile && profile.services),
        approvedTags: stmts.listApprovedTags.all(),           // 골라 쓰는 공용 태그
        tagMode: require('../tags').getMode(),                // approval | filter | open
        error: req.session.flash, ok: req.session.flashOk,
    });
    req.session.flash = null; req.session.flashOk = null;
});

router.post('/profile', (req, res) => {
    const { stage_name, description, rate_per_minute, tags, free_preview_sec, session_block_min,
            rate_cam, sub_price, sub_days } = req.body;
    if (!stage_name || stage_name.length < 2 || stage_name.length > 30) {
        req.session.flash = '활동명 2~30자.'; return res.redirect('/bj-studio/profile');
    }
    const rate = parseInt(rate_per_minute || '0', 10);
    if (rate < 50 || rate > 1000) {
        req.session.flash = '분당 요금 50~1000 Ruby.'; return res.redirect('/bj-studio/profile');
    }
    let free  = parseInt(free_preview_sec || '60', 10);
    let block = parseInt(session_block_min || '5', 10);
    if (isNaN(free)  || free  < 0 || free  > 120) free  = 60;
    if (isNaN(block) || block < 1 || block > 60)  block = 5;
    // 1:1 영상통화 분당요율 (0 = 미제공). 음성통화는 위 '분당 요금'(rate_per_minute).
    // rate_with_video(옛 모니터링)는 영상통화로 흡수돼 더 이상 입력받지 않는다.
    const rateV = 0;
    let rateC = parseInt(rate_cam || '0', 10);
    if (isNaN(rateC) || rateC < 0) rateC = 0;
    if (rateC > 2000) rateC = 2000;
    let subP = parseInt(sub_price || '0', 10);
    if (isNaN(subP) || subP < 0) subP = 0;
    if (subP > 100000) subP = 100000;
    let subD = parseInt(sub_days || '30', 10);
    if (isNaN(subD) || subD < 1 || subD > 365) subD = 30;
    // 커스텀 태그 — 운영 모드(approval/filter/open)에 따라 즉시적용·승인대기·차단으로 갈림
    const tagEngine = require('../tags');
    const tagRes = tagEngine.submitForStreamer(req.user.id, tags, req.user.id);
    const tagStr = tagRes.attached.join(',').slice(0, 100);   // 레거시 표시용 컬럼도 동기화

    stmts.updateBJProfile.run(stage_name, (description || '').slice(0, 300), rate, tagStr,
                              free, block, rateV, rateC, subP, subD, req.user.id);
    // 서비스 태그 — 고정 4종 enum (server/service_types.js가 단일 기준).
    // 자유입력 불가: 구 코드는 자동 변환, 유효하지 않은 값은 버림, 최소 1개 보장.
    const svcTypes = require('../service_types');
    stmts.updateBJServices.run(svcTypes.normalizeServices(req.body.services), req.user.id);

    // 서비스와 직교하는 플래그
    const devCtrl  = req.body.device_control  ? 1 : 0;   // 기기 제어 제공 여부
    const showSub  = req.body.show_sub_videos ? 1 : 0;   // 구독전용 영상 카탈로그 노출
    stmts.updateBJFlags.run(devCtrl, showSub, req.user.id);

    let msg = '프로필 업데이트 완료.';
    if (tagRes.pending.length)  msg += ` 태그 ${tagRes.pending.length}건은 관리자 승인 대기(${tagRes.pending.join(', ')}).`;
    if (tagRes.rejected.length) msg += ` 차단된 태그: ${tagRes.rejected.map(r => r.name + '(' + r.reason + ')').join(', ')}.`;
    req.session.flashOk = msg;
    res.redirect('/bj-studio/profile');
});

// 수익 내역
router.get('/earnings', (req, res) => {
    const profile = stmts.findBJ.get(req.user.id);
    const stats   = stmts.bjCallStats.get(req.user.id) || { total_calls: 0, total_seconds: 0, total_earned: 0 };
    const calls   = stmts.bjRecentCalls.all(req.user.id);
    // 정산 (운영 시 BJ 75%, 플랫폼 25%)
    const SHARE = 0.75;
    const payable = Math.floor((stats.total_earned || 0) * SHARE);
    // 후원 수익 (1:다수 방송) — net_amount는 이미 수수료가 빠진 정산액
    const donSum  = stmts.sumBJDonations.get(req.user.id) || { net: 0, gross: 0, cnt: 0 };
    const donList = stmts.listBJDonations.all(req.user.id);
    res.render('bj_studio/earnings', {
        title: '수익 내역', profile, stats, payable, calls, share: SHARE,
        donSum, donList,
    });
});

// 통화/방송 기록
router.get('/calls', (req, res) => {
    const profile = stmts.findBJ.get(req.user.id);
    const calls = stmts.bjRecentCalls.all(req.user.id);
    res.render('bj_studio/calls', { title: '통화 기록', profile, calls });
});

// ── 내 영상 관리 ──
router.get('/videos', (req, res) => {
    const profile = stmts.findBJ.get(req.user.id);
    const videos = stmts.listBJVideos.all(req.user.id).map(v => {
        let tags = [];
        try { tags = stmts.listVideoTags.all('bj', v.id).map(t => t.name); } catch (_) {}
        return Object.assign({}, v, { tagStr: tags.join(',') });
    });
    res.render('bj_studio/videos', {
        title: '내 영상', profile, videos,
        approvedTags: stmts.listApprovedTags.all().slice(0, 30),
        error: req.session.flash, ok: req.session.flashOk,
    });
    req.session.flash = null; req.session.flashOk = null;
});

// 영상별 태그 저장 — 스트리머 태그와 같은 마스터·운영모드·차단 규칙 적용
router.post('/videos/:id/tags', (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!stmts.findBJVideo.get(id, req.user.id)) {   // 내 영상만
        req.session.flash = '내 영상이 아닙니다.';
        return res.redirect('/bj-studio/videos');
    }
    const r = require('../tags').submitForVideo('bj', id, req.body.tags, req.user.id);
    let msg = '영상 태그를 저장했습니다.';
    if (r.pending.length)  msg += ` 승인 대기: ${r.pending.join(', ')}.`;
    if (r.rejected.length) msg += ` 차단됨: ${r.rejected.map(x => x.name).join(', ')}.`;
    req.session.flashOk = msg;
    res.redirect('/bj-studio/videos');
});

router.post('/videos/upload',
    upload.fields([{ name: 'video', maxCount: 1 }, { name: 'script', maxCount: 1 }]),
    doubleCsrfProtection,   // multer가 _csrf 필드를 파싱한 뒤 CSRF 검증 (글로벌은 멀티파트 스킵)
    (req, res) => {
        const title = (req.body.title || '').trim().slice(0, 80);
        const vf = req.files && req.files.video && req.files.video[0];
        const sf = req.files && req.files.script && req.files.script[0];
        if (!title || !vf) {
            req.session.flash = '제목과 영상 파일은 필수입니다.';
            return res.redirect('/bj-studio/videos');
        }
        const rel = (f) => '/content/bj/' + req.user.id + '/' + f.filename;
        let price = parseInt(req.body.price || '0', 10);
        if (isNaN(price) || price < 0) price = 0;
        if (price > 100000) price = 100000;
        stmts.insertBJVideo.run(req.user.id, title, rel(vf), sf ? rel(sf) : null, price);
        req.session.flashOk = '영상 업로드 완료.';
        res.redirect('/bj-studio/videos');
    });

router.post('/videos/:id/delete', (req, res) => {
    const id = parseInt(req.params.id, 10);
    const v = stmts.findBJVideo.get(id, req.user.id);
    if (v) {
        // 파일 삭제 (best-effort)
        for (const p of [v.video_path, v.script_path]) {
            if (!p) continue;
            const abs = path.join(__dirname, '..', '..', 'public', p.replace(/^\//, ''));
            try { fs.unlinkSync(abs); } catch (_) {}
        }
        stmts.deleteBJVideo.run(id, req.user.id);
    }
    res.redirect('/bj-studio/videos');
});

// 영상 개별구매(PPV) 가격 변경
router.post('/videos/:id/price', (req, res) => {
    const id = parseInt(req.params.id, 10);
    let price = parseInt(req.body.price || '0', 10);
    if (isNaN(price) || price < 0) price = 0;
    if (price > 100000) price = 100000;
    if (Number.isInteger(id)) stmts.updateBJVideoPrice.run(price, id, req.user.id);
    req.session.flashOk = '영상 가격을 변경했습니다.';
    res.redirect('/bj-studio/videos');
});

module.exports = router;
