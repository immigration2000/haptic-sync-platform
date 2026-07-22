/**
 * 샘플 데이터 삭제 — 실서비스 전환 시 시연용 데이터를 걷어낼 때 사용
 * 실행: node scripts/clear_samples.js
 *
 * 지우는 것: 피드 포스트/좋아요/댓글 전체, 더미 라이브 방 비활성화.
 * 남기는 것: 태그 마스터(실제로 쓸 수 있으므로), 스트리머 서비스 설정, 실제 영상.
 */
const { db } = require('../server/db');

const n = (sql) => { try { return db.prepare(sql).get().c; } catch (_) { return 0; } };

const posts = n('SELECT COUNT(*) c FROM posts');
db.exec('DELETE FROM post_comments');
db.exec('DELETE FROM post_likes');
db.exec('DELETE FROM posts');
console.log(`피드 포스트 ${posts}건 삭제 (좋아요·댓글 포함)`);

db.exec('UPDATE dummy_bj_rooms SET is_active = 0');
console.log('더미 라이브 방 전부 비활성화');

console.log('\n태그 마스터와 스트리머 설정은 유지했습니다.');
console.log('태그까지 지우려면: DELETE FROM bj_tags; DELETE FROM tags;');
