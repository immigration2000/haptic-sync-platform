/**
 * SNS 피드 — 스트리머 홍보 채널
 *
 * 권한: 포스트는 스트리머(+관리자)만, 좋아요·댓글은 로그인 사용자 누구나.
 * 클립: 새 파일을 만들지 않고 **기존 영상의 구간(start~end)만 지정**해서 쇼츠처럼 재생한다.
 *       → 인코딩 0, 추가 저장 0. 폰 서버에서도 부담 없음.
 * 보호: 외부 링크·연락처는 content_filter로 차단(플랫폼 이탈 방지).
 */
const express = require('express');
const multer  = require('multer');
const router = express.Router();
const { stmts } = require('../db');
const { requireLogin, requireAgeVerified } = require('../middleware/auth');
const { doubleCsrfProtection } = require('../middleware/csrf');
const filter = require('../content_filter');
const { videoAccess } = require('../access');
const storage = require('../storage');

/* 사진 업로드 — 저장 위치는 storage.js가 결정한다(로컬 ↔ S3 전환 대비).
 * DB에는 논리 키만 저장하고, 화면에서는 storage.publicUrl(key)로 URL을 만든다. */
const IMAGE_RE = /\.(jpe?g|png|webp|gif)$/i;
const upload = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => cb(null, storage.localDir('feed', req.user.id)),
        filename:    (req, file, cb) => cb(null, storage.safeName(file.originalname)),
    }),
    limits: { fileSize: 8 * 1024 * 1024 },      // 8MB — 사진이라 넉넉히 잡되 폰 서버 보호
    fileFilter: (req, file, cb) => {
        const ok = IMAGE_RE.test(file.originalname);
        cb(ok ? null : new Error('이미지 파일만 업로드할 수 있습니다'), ok);
    },
});

const isStreamer = (u) => u && (u.role === 'bj' || u.role === 'admin');

/** 포스트에 연결된 영상 정보 붙이기 (클립 재생·유입 CTA용) */
function attachVideo(p, userId) {
    if (!p.video_id || !p.video_source) return null;
    if (p.video_source === 'content') {
        const c = stmts.findContent.get(p.video_id);
        if (!c) return null;
        return { title: c.title, src: c.video_path, href: '/content/play/' + c.id, locked: false };
    }
    const v = stmts.findBJVideoById ? stmts.findBJVideoById.get(p.video_id) : null;
    if (!v) return null;
    const acc = videoAccess(userId, v);
    return {
        title: v.title, src: v.video_path, href: '/bj/vid/' + v.id,
        locked: !acc.allowed,   // 잠겨 있어도 클립(티저)은 보여준다 — 그게 홍보의 핵심
    };
}

// ── 피드 ──
router.get('/', requireAgeVerified, (req, res) => {
    let posts = stmts.listPosts.all();

    // 태그 필터 — 작성자(스트리머)의 태그 기준. 영상·라이브와 같은 태그 어휘를 공유한다.
    const wantTags = String(req.query.tag || '').split(',').map(s => s.trim()).filter(Boolean);
    const tagCache = new Map();
    const tagsOfAuthor = (uid) => {
        if (!tagCache.has(uid)) {
            let t = [];
            try { t = stmts.listBJTags.all(uid).map(x => x.name); } catch (_) {}
            tagCache.set(uid, t);
        }
        return tagCache.get(uid);
    };
    if (wantTags.length) {
        posts = posts.filter(p => tagsOfAuthor(p.author_id).some(t => wantTags.includes(t)));
    }

    const liked = new Set(stmts.myLikedPosts.all(req.user.id).map(r => r.post_id));
    const items = posts.map(p => Object.assign({}, p, {
        video: attachVideo(p, req.user.id),
        likedByMe: liked.has(p.id),
        comments: stmts.listComments.all(p.id),
        authorTags: tagsOfAuthor(p.author_id).slice(0, 3),
        imageUrl: p.image_key ? storage.publicUrl(p.image_key) : null,   // 저장소 무관 URL
    }));

    // 필터 칩 — 승인된 태그
    let allTags = [];
    try { allTags = stmts.listApprovedTags.all().slice(0, 20); } catch (_) {}

    // 작성용 — 내 영상 + 사이트 콘텐츠(VOD/VR)도 클립 소스로 사용 가능
    const myVideos = isStreamer(req.user) ? stmts.listBJVideos.all(req.user.id) : [];
    const siteVideos = isStreamer(req.user) ? stmts.listAllContents.all().slice(0, 50) : [];

    res.render('feed/index', {
        title: '피드', items, canPost: isStreamer(req.user), myVideos, siteVideos,
        allTags, activeTags: wantTags,
        error: req.session.flash, ok: req.session.flashOk,
    });
    req.session.flash = null; req.session.flashOk = null;
});

// ── 포스트 작성 (스트리머만) ──
// 멀티파트라 글로벌 CSRF를 지나치므로 multer 뒤에서 직접 검증한다(업로드 라우트 공통 패턴).
router.post('/', requireLogin, (req, res, next) => {
    upload.single('image')(req, res, (err) => {
        if (err) { req.session.flash = err.message || '업로드 실패'; return res.redirect('/feed'); }
        next();
    });
}, (req, res, next) => {
    // multer는 CSRF 검증 '전에' 파일을 디스크에 쓴다. 이후 단계에서 거부(403 등)되면
    // 핸들러가 실행되지 않아 파일만 남는다 → 반복 요청으로 디스크를 채울 수 있음.
    // 응답이 실패로 끝나면 업로드 파일을 되돌린다.
    res.on('finish', () => {
        if (res.statusCode >= 400 && req.file) {
            storage.remove(`feed/${req.user.id}/${req.file.filename}`);
        }
    });
    next();
}, doubleCsrfProtection, (req, res) => {
    const imgKey = req.file ? `feed/${req.user.id}/${req.file.filename}` : null;
    const dropImage = () => { if (imgKey) storage.remove(imgKey); };

    if (!isStreamer(req.user)) {
        dropImage();
        req.session.flash = '스트리머만 게시할 수 있습니다.';
        return res.redirect('/feed');
    }
    const f = filter.check(req.body.body, { maxLen: 500 });
    if (!f.ok) {
        dropImage();   // 본문이 거부되면 올라간 파일도 남기지 않는다
        req.session.flash = `게시 실패 — ${f.blocked.join(', ')}는 등록할 수 없습니다. (외부 연락처·링크 금지)`;
        return res.redirect('/feed');
    }
    // 영상 선택값은 "bj:12" 또는 "content:5" 형식 — 소스와 id를 함께 받는다
    const raw = String(req.body.video_ref || '');
    const m = /^(bj|content):(\d+)$/.exec(raw);
    let src = m ? m[1] : null;
    let vid = m ? parseInt(m[2], 10) : null;
    let start = Math.max(0, parseInt(req.body.clip_start, 10) || 0);
    let end   = Math.max(0, parseInt(req.body.clip_end, 10) || 0);

    // 클립은 최대 60초 (쇼츠 성격 유지)
    if (end && end <= start) end = start + 30;
    if (end - start > 60) end = start + 60;

    // 스트리머 영상은 본인 것만 연결 가능 (남의 영상 도용 방지)
    if (vid && src === 'bj' && !stmts.findBJVideo.get(vid, req.user.id)) { vid = null; src = null; }
    if (vid && src === 'content' && !stmts.findContent.get(vid))         { vid = null; src = null; }
    if (!vid || !src) { vid = null; src = null; start = 0; end = 0; }

    stmts.insertPost.run(req.user.id, f.text, src, vid, start, end, imgKey);
    req.session.flashOk = '게시했습니다.';
    res.redirect('/feed');
});

// ── 좋아요 토글 ──
router.post('/:id/like', requireLogin, (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!stmts.findPost.get(id)) return res.status(404).json({ ok: false });
    const has = stmts.hasPostLike.get(id, req.user.id);
    if (has) stmts.delPostLike.run(id, req.user.id);
    else     stmts.addPostLike.run(id, req.user.id);
    stmts.syncPostLikes.run(id, id);
    const p = stmts.findPost.get(id);
    res.json({ ok: true, liked: !has, count: p.like_count });
});

// ── 댓글 (로그인 사용자 누구나) ──
router.post('/:id/comment', requireLogin, (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!stmts.findPost.get(id)) return res.redirect('/feed');
    const f = filter.check(req.body.body, { maxLen: 200 });
    if (!f.ok) {
        req.session.flash = `댓글 실패 — ${f.blocked.join(', ')}는 쓸 수 없습니다.`;
        return res.redirect('/feed');
    }
    stmts.insertComment.run(id, req.user.id, f.text);
    stmts.syncPostComments.run(id, id);
    res.redirect('/feed');
});

// ── 신고 (포스트·댓글) — 관리자 신고함으로 들어감 ──
router.post('/:id/report', requireLogin, (req, res) => {
    const id = parseInt(req.params.id, 10);
    const kind = req.body.kind === 'comment' ? 'comment' : 'post';
    if (!stmts.findPost.get(id)) return res.status(404).json({ ok: false });
    const REASONS = ['spam', 'illegal', 'abuse', 'underage', 'other'];
    const reason = REASONS.includes(req.body.reason) ? req.body.reason : 'other';
    try {
        stmts.insertReport.run(req.user.id, kind, id, reason, String(req.body.detail || '').slice(0, 500));
    } catch (_) { return res.json({ ok: false }); }
    res.json({ ok: true });
});

// ── 삭제 (작성자 또는 관리자) ──
router.post('/:id/delete', requireLogin, (req, res) => {
    const id = parseInt(req.params.id, 10);
    const p = stmts.findPost.get(id);
    if (p && (p.author_id === req.user.id || req.user.role === 'admin')) {
        if (p.image_key) storage.remove(p.image_key);   // 고아 파일 방지
        stmts.deletePost.run(id);
    }
    res.redirect('/feed');
});

module.exports = router;
