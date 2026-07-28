const express = require('express');
const router = express.Router();
const { stmts } = require('../db');
const { requireAgeVerified } = require('../middleware/auth');
const { videoAccess } = require('../access');
const vrConfig = require('../vr_config');

/* ── 통합 영상 카탈로그 ───────────────────────────────────────────
 * 전체 영상(사이트 VOD/VR + 스트리머 업로드)을 한 목록으로 합치고
 * 좌측 필터(타입 · 이용방식 · 태그)로 좁힌다.
 * 필터 규칙: 같은 카테고리 안은 OR, 카테고리끼리는 AND.
 */

// 성인 확인만 되면 비로그인도 열람 가능 — 유료 콘텐츠 노출이 신규 유입 경로이므로.
// (로그인 계정은 age_verified, 게스트는 세션 확인. 재생·구매는 별도로 로그인 필요)
function requireAgeOrGuest(req, res, next) {
    if (req.user) return requireAgeVerified(req, res, next);
    if (req.session && req.session.guestAgeOk) return next();
    return res.redirect('/content/age?next=' + encodeURIComponent(req.originalUrl));
}

const csvList = (v) => String(v || '').split(',').map(s => s.trim()).filter(Boolean);
const tagsOf  = (s) => csvList(s);

/** 두 소스를 하나의 카드 형태로 정규화
 *  태그 우선순위: 영상 자체 태그 > (스트리머 영상이면) 스트리머 태그 > 레거시 문자열 컬럼 */
function buildCatalog(userId) {
    const out = [];

    // 영상별 태그를 한 번에 읽어 맵으로 (영상마다 쿼리하지 않도록)
    const vtMap = new Map();
    try {
        for (const r of stmts.listAllVideoTags.all()) {
            const k = r.source + ':' + r.video_id;
            if (!vtMap.has(k)) vtMap.set(k, []);
            vtMap.get(k).push(r.name);
        }
    } catch (_) {}
    const ownTags = (src, id) => vtMap.get(src + ':' + id) || [];

    for (const c of stmts.listAllContents.all()) {
        const own = ownTags('content', c.id);
        out.push({
            key: 'c' + c.id, href: '/content/play/' + c.id,
            type: c.type === 'vr' ? 'vr' : 'vod',
            title: c.title, thumb: c.thumbnail_path, duration: c.duration_sec,
            multiAxis: !!c.multi_axis, hasScript: !!c.script_path,
            access: c.price > 0 ? 'ppv' : 'free', price: c.price,
            tags: own.length ? own : tagsOf(c.tags), streamer: null,
            locked: false, createdAt: c.created_at,
        });
    }
    for (const v of stmts.listAllBJVideos.all()) {
        const acc  = videoAccess(userId, v);
        const kind = v.price > 0 ? 'ppv' : 'sub';
        // 구독전용은 스트리머가 노출을 끄면 카탈로그에서 숨김.
        // 단 이미 볼 수 있는 사람(구독자·구매자·본인)에겐 항상 보인다.
        if (kind === 'sub' && !v.show_sub_videos && !acc.allowed) continue;
        const own = ownTags('bj', v.id);
        out.push({
            key: 'b' + v.id, href: '/bj/vid/' + v.id,
            type: 'vod',
            title: v.title, thumb: null, duration: 0,
            multiAxis: false, hasScript: !!v.script_path,
            access: kind, price: v.price,
            tags: own.length ? own : tagsOf(v.streamer_tags),
            streamer: { id: v.bj_user_id, name: v.stage_name, subPrice: v.sub_price },
            locked: !acc.allowed, accessReason: acc.reason,
            createdAt: v.created_at,
        });
    }
    out.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    return out;
}

function applyFilters(items, f) {
    return items.filter((it) => {
        if (f.type.length   && !f.type.includes(it.type))     return false;
        if (f.access.length && !f.access.includes(it.access)) return false;
        if (f.tag.length    && !f.tag.some(t => it.tags.includes(t))) return false;
        if (f.q) {
            const hay = (it.title + ' ' + (it.streamer ? it.streamer.name : '') + ' ' + it.tags.join(' ')).toLowerCase();
            if (!hay.includes(f.q)) return false;
        }
        return true;
    });
}

function renderCatalog(req, res, preset) {
    const f = {
        type:   preset && preset.type ? [preset.type] : csvList(req.query.type),
        access: csvList(req.query.access),
        tag:    csvList(req.query.tag),
        q:      (req.query.q || '').toLowerCase().trim(),
    };
    const all   = buildCatalog(req.user ? req.user.id : null);
    const items = applyFilters(all, f);
    // 필터 칩에 쓸 태그 — 실제 영상에 붙어있는 것만 (빈 결과 방지)
    const tagCount = {};
    all.forEach(it => it.tags.forEach(t => { tagCount[t] = (tagCount[t] || 0) + 1; }));
    const tagList = Object.keys(tagCount).sort((a, b) => tagCount[b] - tagCount[a]).slice(0, 30)
                          .map(name => ({ name, count: tagCount[name] }));
    res.render('content/catalog', {
        title: '영상', tab: 'catalog', items, filters: f,
        total: all.length, shown: items.length, tagList,
    });
}

// 게스트 성인 확인 게이트
router.get('/age', (req, res) => {
    if (req.user) return res.redirect(req.query.next || '/content');
    res.render('content/age', { title: '성인 확인', next: req.query.next || '/content' });
});
router.post('/age', (req, res) => {
    req.session.guestAgeOk = true;
    res.redirect(req.body.next || '/content');
});

router.get('/',    requireAgeOrGuest, (req, res) => renderCatalog(req, res, null));
router.get('/vod', requireAgeOrGuest, (req, res) => renderCatalog(req, res, { type: 'vod' }));
router.get('/vr',  requireAgeOrGuest, (req, res) => renderCatalog(req, res, { type: 'vr' }));

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
