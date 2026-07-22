/**
 * 샘플 데이터 시드 — 라이브 + 피드 + 태그
 * 실행: node scripts/seed_samples.js   (~/pulse 에서)
 *
 * 멱등: 이미 있으면 건너뛰거나 갱신한다. 여러 번 실행해도 중복되지 않음.
 * 시연용 데이터라 언제든 지울 수 있게 포스트 본문에 특별한 표식은 두지 않고
 * scripts/clear_samples.js 로 일괄 삭제 가능하게 했다.
 */
const { db, stmts } = require('../server/db');
const svcTypes = require('../server/service_types');

// ── 1) 태그 마스터 (승인 상태) ──────────────────────────────
const TAGS = [
    ['성숙', '분위기'], ['청순', '분위기'], ['발랄', '분위기'], ['카리스마', '분위기'],
    ['감성', '분위기'], ['인텐스', '분위기'],
    ['테크니션', '컨셉'], ['비기너', '컨셉'], ['다축', '컨셉'], ['ASMR', '컨셉'],
    ['코스프레', '의상'], ['원피스', '의상'], ['유니폼', '의상'],
    ['심야', '주제'], ['모닝', '주제'], ['수다', '주제'],
];
let tagAdded = 0;
for (const [name, cat] of TAGS) {
    if (!stmts.findTagByName.get(name)) {
        stmts.insertTag.run(name, cat, 'approved', null);
        tagAdded++;
    } else {
        const t = stmts.findTagByName.get(name);
        if (t.status !== 'approved') stmts.setTagStatus.run('approved', t.id);
    }
}
console.log(`태그: ${tagAdded}개 추가 (전체 ${TAGS.length})`);

// ── 2) 스트리머별 서비스 태그 + 커스텀 태그 ─────────────────
// 4가지 서비스가 골고루 보이도록 배분 (음성방송이 하나도 없어서 로비가 단조로웠음)
const STREAMERS = [
    { id: 3, svc: ['voice_1on1', 'video_1on1', 'video_multi'], tags: ['성숙', '테크니션', '다축'] },
    { id: 4, svc: ['voice_1on1', 'video_1on1', 'voice_multi'], tags: ['발랄', '수다', 'ASMR'] },
    { id: 5, svc: ['voice_1on1', 'video_1on1', 'video_multi'], tags: ['성숙', '인텐스', '심야'] },
    { id: 6, svc: ['voice_1on1', 'voice_multi'],               tags: ['비기너', '청순', '모닝'] },
    { id: 7, svc: ['voice_1on1', 'video_1on1', 'video_multi', 'voice_multi'], tags: ['카리스마', '테크니션', '코스프레'] },
];
for (const s of STREAMERS) {
    if (!stmts.findBJ.get(s.id)) continue;
    stmts.updateBJServices.run(svcTypes.normalizeServices(s.svc), s.id);
    stmts.clearBJTags.run(s.id);
    for (const name of s.tags) {
        const t = stmts.findTagByName.get(name);
        if (t) { try { stmts.addBJTag.run(s.id, t.id); } catch (_) {} }
    }
    db.prepare('UPDATE bj_profiles SET tags = ? WHERE user_id = ?').run(s.tags.join(','), s.id);
}
db.exec('UPDATE tags SET use_count = (SELECT COUNT(*) FROM bj_tags WHERE tag_id = tags.id)');
console.log(`스트리머 ${STREAMERS.length}명 서비스·태그 설정`);

// ── 3) 라이브 로비 — 더미 방 활성화 ─────────────────────────
// 실제 방송은 소켓 연결이 있어야 뜨므로, 시연용 더미 방을 켜서 로비가 비어 보이지 않게 한다.
const dummyOn = db.prepare('UPDATE dummy_bj_rooms SET is_active = 1').run();
const dummyCnt = db.prepare('SELECT COUNT(*) c FROM dummy_bj_rooms').get().c;
console.log(`더미 라이브 방 ${dummyCnt}개 활성화`);

// ── 4) 피드 샘플 포스트 ─────────────────────────────────────
// 클립은 기존 영상의 구간만 지정 (새 파일 없음). 실제 존재하는 영상에만 연결.
const has = (sql, ...a) => { try { return db.prepare(sql).get(...a); } catch (_) { return null; } };
const contentOk = (id) => !!stmts.findContent.get(id);
const bjVideoOk = (id, uid) => !!stmts.findBJVideo.get(id, uid);

const POSTS = [
    { author: 3, body: '오늘 밤 10시에 라이브 켭니다 🌙 다축 스크립트 새로 준비했어요, 기대해주세요!',
      src: 'content', vid: 1, start: 45, end: 75 },
    { author: 3, body: '새 영상 업로드했습니다. 구독자분들은 바로 보실 수 있어요 💕',
      src: 'bj', vid: 2, start: 5, end: 35 },
    { author: 4, body: '내일 아침 음성방송 예정이에요 ☕ 수다 떨러 오세요~ 편하게 들어주시면 됩니다',
      src: null },
    { author: 5, body: '심야 방송 다시 시작합니다. 이번엔 기기 연동도 같이 해볼게요 🔥',
      src: 'content', vid: 6, start: 120, end: 160 },
    { author: 7, body: '코스프레 컨셉 준비 중입니다. 어떤 의상이 좋을까요? 댓글로 알려주세요!',
      src: 'content', vid: 3, start: 30, end: 60 },
    { author: 7, body: '오늘 방송 감사했습니다 🙏 다음엔 더 재밌게 준비할게요',
      src: null },
];

let postAdded = 0;
for (const p of POSTS) {
    if (!stmts.findBJ.get(p.author)) continue;
    // 같은 작성자+본문이 이미 있으면 건너뜀 (멱등)
    if (has('SELECT id FROM posts WHERE author_id = ? AND body = ?', p.author, p.body)) continue;

    let src = p.src, vid = p.vid, st = p.start || 0, en = p.end || 0;
    if (src === 'content' && !contentOk(vid)) { src = null; vid = null; st = 0; en = 0; }
    if (src === 'bj' && !bjVideoOk(vid, p.author)) { src = null; vid = null; st = 0; en = 0; }
    if (!src) { vid = null; st = 0; en = 0; }

    stmts.insertPost.run(p.author, p.body, src, vid, st, en);
    postAdded++;
}
console.log(`피드 포스트 ${postAdded}개 추가`);

// ── 5) 샘플 좋아요·댓글 (반응이 있어 보이게) ────────────────
const users = db.prepare("SELECT id FROM users WHERE role = 'user' LIMIT 3").all().map(u => u.id);
const posts = db.prepare('SELECT id FROM posts ORDER BY id DESC LIMIT 6').all().map(p => p.id);
const COMMENTS = ['기대돼요!', '오늘도 잘 볼게요 👍', '기다리고 있었어요', '좋아요~'];
let likeN = 0, cmtN = 0;
posts.forEach((pid, i) => {
    users.slice(0, (i % 3) + 1).forEach(uid => {
        if (!stmts.hasPostLike.get(pid, uid)) { stmts.addPostLike.run(pid, uid); likeN++; }
    });
    stmts.syncPostLikes.run(pid, pid);
    if (users.length && !has('SELECT id FROM post_comments WHERE post_id = ?', pid)) {
        stmts.insertComment.run(pid, users[i % users.length], COMMENTS[i % COMMENTS.length]);
        stmts.syncPostComments.run(pid, pid);
        cmtN++;
    }
});
console.log(`좋아요 ${likeN}건, 댓글 ${cmtN}건 추가`);

console.log('\n✅ 샘플 시드 완료');
