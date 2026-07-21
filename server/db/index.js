/**
 * SQLite DB 어댑터 — better-sqlite3 (Node 20) 또는 node:sqlite (Node 22+) 자동 선택
 * 폰 Termux ARM64에서 better-sqlite3 native 빌드가 막혀서 node:sqlite로 폴백
 */
const fs   = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', '..', 'data', 'pulse.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

let db;
try {
    const Database = require('better-sqlite3');
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    console.log('[db] using better-sqlite3');
} catch (e) {
    const { DatabaseSync } = require('node:sqlite');
    const raw = new DatabaseSync(DB_PATH);
    raw.exec('PRAGMA journal_mode = WAL');
    raw.exec('PRAGMA foreign_keys = ON');
    // better-sqlite3와 같은 API로 래핑
    db = {
        prepare: (sql) => raw.prepare(sql),
        exec:    (sql) => raw.exec(sql),
        close:   ()    => raw.close(),
        pragma:  (q)   => raw.exec('PRAGMA ' + q),
        // 트랜잭션 헬퍼 — 함수 fn을 BEGIN/COMMIT/ROLLBACK으로 감쌈
        transaction: (fn) => function (...args) {
            raw.exec('BEGIN');
            try {
                const r = fn(...args);
                raw.exec('COMMIT');
                return r;
            } catch (err) {
                raw.exec('ROLLBACK');
                throw err;
            }
        },
    };
    console.log('[db] using node:sqlite (Node ' + process.version + ' built-in)');
}

// 스키마 1회 초기화
const schemaSQL = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
db.exec(schemaSQL);

// ─── 마이그레이션 (기존 DB에 신규 컬럼 보강) ────────────────
function addColumnIfMissing(table, column, ddl) {
    try {
        const cols = db.prepare(`PRAGMA table_info(${table})`).all();
        if (!cols.some(c => c.name === column)) {
            db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
            console.log(`[db] migrated: ${table}.${column}`);
        }
    } catch (e) { /* table 없으면 schema가 만들어줌 */ }
}
addColumnIfMissing('bj_profiles',    'free_preview_sec',  'free_preview_sec INTEGER NOT NULL DEFAULT 60');
addColumnIfMissing('bj_profiles',    'session_block_min', 'session_block_min INTEGER NOT NULL DEFAULT 5');
addColumnIfMissing('bj_profiles',    'services',          `services TEXT NOT NULL DEFAULT 'call,cowatch,live-priv,broadcast'`);
addColumnIfMissing('bj_profiles',    'rate_with_video',   'rate_with_video INTEGER NOT NULL DEFAULT 0');
addColumnIfMissing('bj_profiles',    'rate_cam',          'rate_cam INTEGER NOT NULL DEFAULT 0');
addColumnIfMissing('bj_profiles',    'sub_price',         'sub_price INTEGER NOT NULL DEFAULT 0');
addColumnIfMissing('bj_profiles',    'sub_days',          'sub_days INTEGER NOT NULL DEFAULT 30');
addColumnIfMissing('bj_videos',      'price',             'price INTEGER NOT NULL DEFAULT 0');
addColumnIfMissing('dummy_bj_rooms', 'free_preview_sec',  'free_preview_sec INTEGER NOT NULL DEFAULT 60');
addColumnIfMissing('dummy_bj_rooms', 'session_block_min', 'session_block_min INTEGER NOT NULL DEFAULT 5');
// 서비스 태그 체계 개편 — 기기제어 제공 여부(서비스와 직교), 구독전용 영상 카탈로그 노출
addColumnIfMissing('bj_profiles',    'device_control',    'device_control INTEGER NOT NULL DEFAULT 1');
addColumnIfMissing('bj_profiles',    'show_sub_videos',   'show_sub_videos INTEGER NOT NULL DEFAULT 1');

// services 값을 신규 4종 체계로 1회 변환 (call→voice_1on1, broadcast→video_multi …)
// 이미 신규 코드면 그대로 — 멱등이라 매 부팅 실행돼도 안전.
try {
    const { normalizeServices } = require('../service_types');
    const rows = db.prepare('SELECT user_id, services FROM bj_profiles').all();
    const upd  = db.prepare('UPDATE bj_profiles SET services = ? WHERE user_id = ?');
    let n = 0;
    for (const r of rows) {
        const next = normalizeServices(r.services);
        if (next !== (r.services || '')) { upd.run(next, r.user_id); n++; }
    }
    if (n) console.log(`[db] migrated services → 신규 4종 체계 (${n}건)`);
} catch (e) { console.warn('[db] services 마이그레이션 건너뜀:', e.message); }

// 서버 시작 시 stale 온라인 상태 리셋 (재시작 후 모두 오프라인)
try { db.exec('UPDATE bj_profiles SET is_online = 0'); } catch (_) {}

// ─── Prepared statement 헬퍼 모음 ────────────────────────────
const stmts = {
    // users
    findUserByEmail:   db.prepare('SELECT * FROM users WHERE email = ?'),
    findUserByNick:    db.prepare('SELECT * FROM users WHERE nickname = ?'),
    findUserById:      db.prepare('SELECT * FROM users WHERE id = ?'),
    insertUser:        db.prepare(`INSERT INTO users (email, password_hash, nickname, role, age_verified)
                                   VALUES (?, ?, ?, ?, ?)`),
    updateAgeVerified: db.prepare('UPDATE users SET age_verified = 1 WHERE id = ?'),
    updateCredits:     db.prepare('UPDATE users SET credits = ? WHERE id = ?'),
    updateSubscription:db.prepare('UPDATE users SET subscription_until = ? WHERE id = ?'),
    updateAvatar:      db.prepare('UPDATE users SET avatar_url = ?, bio = ? WHERE id = ?'),

    // bj_profiles
    listBJs:           db.prepare(`SELECT u.id, u.nickname, u.avatar_url, b.stage_name, b.description,
                                          b.rate_per_minute, b.rate_with_video, b.rate_cam,
                                          b.free_preview_sec, b.session_block_min, b.services,
                                          b.rating_avg, b.rating_count, b.tags, b.is_online
                                   FROM users u
                                   JOIN bj_profiles b ON b.user_id = u.id
                                   ORDER BY b.is_online DESC, b.rating_avg DESC`),
    findBJ:            db.prepare(`SELECT u.id, u.nickname, u.avatar_url, b.*
                                   FROM users u JOIN bj_profiles b ON b.user_id = u.id
                                   WHERE u.id = ?`),
    insertBJProfile:   db.prepare(`INSERT INTO bj_profiles (user_id, stage_name, description, rate_per_minute, tags)
                                   VALUES (?, ?, ?, ?, ?)`),
    setBJOnline:       db.prepare('UPDATE bj_profiles SET is_online = ? WHERE user_id = ?'),
    updateBJServices:  db.prepare('UPDATE bj_profiles SET services = ? WHERE user_id = ?'),
    updateBJFlags:     db.prepare('UPDATE bj_profiles SET device_control = ?, show_sub_videos = ? WHERE user_id = ?'),

    // ── 후원 (1:다수 방송) ──
    insertDonation:    db.prepare(`INSERT INTO donations (from_user_id, to_bj_user_id, amount, net_amount, message)
                                   VALUES (?, ?, ?, ?, ?)`),
    listBJDonations:   db.prepare(`SELECT d.*, u.nickname AS from_nick FROM donations d
                                   JOIN users u ON u.id = d.from_user_id
                                   WHERE d.to_bj_user_id = ? ORDER BY d.created_at DESC LIMIT 100`),
    sumBJDonations:    db.prepare(`SELECT COALESCE(SUM(net_amount),0) AS net, COALESCE(SUM(amount),0) AS gross,
                                          COUNT(*) AS cnt FROM donations WHERE to_bj_user_id = ?`),

    // ── 커스텀 태그 (server/tags.js) ──
    findTagByName:     db.prepare('SELECT * FROM tags WHERE name = ?'),
    insertTag:         db.prepare('INSERT INTO tags (name, category, status, created_by) VALUES (?, ?, ?, ?)'),
    listTagsByStatus:  db.prepare('SELECT * FROM tags WHERE status = ? ORDER BY use_count DESC, name'),
    listApprovedTags:  db.prepare("SELECT * FROM tags WHERE status = 'approved' ORDER BY use_count DESC, name"),
    setTagStatus:      db.prepare('UPDATE tags SET status = ? WHERE id = ?'),
    setTagCategory:    db.prepare('UPDATE tags SET category = ? WHERE id = ?'),
    deleteTag:         db.prepare('DELETE FROM tags WHERE id = ?'),
    clearBJTags:       db.prepare('DELETE FROM bj_tags WHERE bj_user_id = ?'),
    addBJTag:          db.prepare('INSERT OR IGNORE INTO bj_tags (bj_user_id, tag_id) VALUES (?, ?)'),
    listBJTags:        db.prepare(`SELECT t.* FROM tags t JOIN bj_tags b ON b.tag_id = t.id
                                   WHERE b.bj_user_id = ? AND t.status = 'approved' ORDER BY t.name`),

    // BJ 개인 영상
    listBJVideos:      db.prepare('SELECT * FROM bj_videos WHERE bj_user_id = ? ORDER BY created_at DESC'),
    insertBJVideo:     db.prepare('INSERT INTO bj_videos (bj_user_id, title, video_path, script_path, price) VALUES (?, ?, ?, ?, ?)'),
    findBJVideo:       db.prepare('SELECT * FROM bj_videos WHERE id = ? AND bj_user_id = ?'),
    findBJVideoById:   db.prepare('SELECT * FROM bj_videos WHERE id = ?'),
    deleteBJVideo:     db.prepare('DELETE FROM bj_videos WHERE id = ? AND bj_user_id = ?'),
    updateBJVideoPrice:db.prepare('UPDATE bj_videos SET price = ? WHERE id = ? AND bj_user_id = ?'),
    updateBJProfile:   db.prepare(`UPDATE bj_profiles SET
                                       stage_name = ?, description = ?, rate_per_minute = ?, tags = ?,
                                       free_preview_sec = ?, session_block_min = ?,
                                       rate_with_video = ?, rate_cam = ?, sub_price = ?, sub_days = ?,
                                       updated_at = CURRENT_TIMESTAMP
                                   WHERE user_id = ?`),

    // BJ별 구독 (기간제)
    insertBJSub:       db.prepare('INSERT INTO bj_subscriptions (user_id, bj_user_id, end_at) VALUES (?, ?, ?)'),
    activeBJSub:       db.prepare(`SELECT * FROM bj_subscriptions
                                   WHERE user_id = ? AND bj_user_id = ? AND end_at > CURRENT_TIMESTAMP
                                   ORDER BY end_at DESC LIMIT 1`),
    listMySubs:        db.prepare(`SELECT s.*, b.stage_name, u.nickname AS bj_nick
                                   FROM bj_subscriptions s
                                   JOIN bj_profiles b ON b.user_id = s.bj_user_id
                                   JOIN users u ON u.id = s.bj_user_id
                                   WHERE s.user_id = ? AND s.end_at > CURRENT_TIMESTAMP
                                   ORDER BY s.end_at DESC`),
    countBJSubscribers:db.prepare(`SELECT COUNT(DISTINCT user_id) AS c FROM bj_subscriptions
                                   WHERE bj_user_id = ? AND end_at > CURRENT_TIMESTAMP`),

    // 영상 개별구매 (PPV)
    insertVideoPurchase: db.prepare('INSERT OR IGNORE INTO video_purchases (user_id, video_id) VALUES (?, ?)'),
    hasVideoPurchase:    db.prepare('SELECT 1 AS ok FROM video_purchases WHERE user_id = ? AND video_id = ?'),

    // 영상 허브 — 업로드 영상이 있는 스트리머 라이브러리 목록
    listStreamerLibraries: db.prepare(`SELECT b.user_id, b.stage_name, b.sub_price, b.sub_days,
                                              COUNT(v.id) AS video_count
                                       FROM bj_profiles b
                                       JOIN bj_videos v ON v.bj_user_id = b.user_id
                                       GROUP BY b.user_id
                                       HAVING video_count > 0
                                       ORDER BY video_count DESC`),
    // 전체 스트리머 업로드 영상 (구독자전용 영상 탭 — 스트리머명 포함)
    listAllBJVideos:       db.prepare(`SELECT v.*, b.stage_name, b.sub_price,
                                              b.show_sub_videos, b.tags AS streamer_tags
                                       FROM bj_videos v
                                       JOIN bj_profiles b ON b.user_id = v.bj_user_id
                                       ORDER BY v.created_at DESC`),

    // BJ 통계 — 본인의 통화 로그
    bjCallStats:       db.prepare(`SELECT
                                       COUNT(*) AS total_calls,
                                       COALESCE(SUM(duration_sec), 0) AS total_seconds,
                                       COALESCE(SUM(charged), 0) AS total_earned
                                   FROM call_logs WHERE bj_id = ?`),
    bjRecentCalls:     db.prepare(`SELECT c.*, u.nickname AS user_nick
                                   FROM call_logs c JOIN users u ON u.id = c.user_id
                                   WHERE c.bj_id = ?
                                   ORDER BY c.started_at DESC LIMIT 50`),

    // contents
    listContents:      db.prepare(`SELECT * FROM contents WHERE type = ? ORDER BY created_at DESC`),
    listAllContents:   db.prepare(`SELECT * FROM contents ORDER BY created_at DESC`),
    findContent:       db.prepare(`SELECT * FROM contents WHERE id = ?`),
    insertContent:     db.prepare(`INSERT INTO contents (type, title, description, creator, video_path, script_path,
                                                          thumbnail_path, duration_sec, price, tags, multi_axis)
                                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
    bumpViewCount:     db.prepare('UPDATE contents SET view_count = view_count + 1 WHERE id = ?'),

    // watch_history
    upsertWatch:       db.prepare(`INSERT INTO watch_history (user_id, content_id, last_position)
                                   VALUES (?, ?, ?)
                                   ON CONFLICT(user_id, content_id) DO UPDATE SET
                                     last_position = excluded.last_position,
                                     watched_at = CURRENT_TIMESTAMP`),
    listWatchHistory:  db.prepare(`SELECT c.*, w.last_position, w.watched_at
                                   FROM watch_history w JOIN contents c ON c.id = w.content_id
                                   WHERE w.user_id = ?
                                   ORDER BY w.watched_at DESC
                                   LIMIT 50`),

    // transactions
    insertTx:          db.prepare(`INSERT INTO transactions (user_id, type, amount, balance_after, description)
                                   VALUES (?, ?, ?, ?, ?)`),
    listTx:            db.prepare(`SELECT * FROM transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT 100`),

    // call_logs
    insertCallLog:     db.prepare(`INSERT INTO call_logs (user_id, bj_id, kind) VALUES (?, ?, ?)`),
    closeCallLog:      db.prepare(`UPDATE call_logs SET ended_at = CURRENT_TIMESTAMP,
                                                       duration_sec = ?, charged = ?
                                   WHERE id = ?`),

    // subscriptions
    insertSub:         db.prepare(`INSERT INTO subscriptions (user_id, tier, end_at) VALUES (?, ?, ?)`),
    listSubs:          db.prepare(`SELECT * FROM subscriptions WHERE user_id = ? ORDER BY start_at DESC`),

    // settings (key-value)
    getSettingRaw:     db.prepare(`SELECT value FROM settings WHERE key = ?`),
    setSetting:        db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?)
                                   ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`),
    listSettings:      db.prepare(`SELECT * FROM settings ORDER BY key`),

    // dummy BJ rooms
    listDummyRooms:    db.prepare(`SELECT * FROM dummy_bj_rooms ORDER BY sort_order, id`),
    listActiveDummy:   db.prepare(`SELECT * FROM dummy_bj_rooms WHERE is_active = 1 ORDER BY sort_order, id`),
    insertDummyRoom2:  db.prepare(`INSERT INTO dummy_bj_rooms (stage_name, description, rate_per_minute, free_preview_sec, session_block_min, tags, viewer_count, thumbnail, looping_video)
                                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`),
    insertDummyRoom:   db.prepare(`INSERT INTO dummy_bj_rooms (stage_name, description, rate_per_minute, tags, viewer_count, thumbnail, looping_video)
                                   VALUES (?, ?, ?, ?, ?, ?, ?)`),
    toggleDummyRoom:   db.prepare(`UPDATE dummy_bj_rooms SET is_active = ? WHERE id = ?`),

    // auth_tokens
    insertToken:       db.prepare(`INSERT INTO auth_tokens (token, user_id, purpose, expires_at) VALUES (?, ?, ?, ?)`),
    findToken:         db.prepare(`SELECT * FROM auth_tokens WHERE token = ? AND purpose = ? AND used_at IS NULL AND expires_at > CURRENT_TIMESTAMP`),
    markTokenUsed:     db.prepare(`UPDATE auth_tokens SET used_at = CURRENT_TIMESTAMP WHERE token = ?`),
    deleteOldTokens:   db.prepare(`DELETE FROM auth_tokens WHERE expires_at < CURRENT_TIMESTAMP OR used_at IS NOT NULL`),

    // user updates
    updatePassword:    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?'),
    updateEmail:       db.prepare('UPDATE users SET email = ? WHERE id = ?'),
    updateNickname:    db.prepare('UPDATE users SET nickname = ? WHERE id = ?'),
    deleteUser:        db.prepare('DELETE FROM users WHERE id = ?'),
    updateUserRole:    db.prepare('UPDATE users SET role = ? WHERE id = ?'),

    // BJ application
    insertBJApp:       db.prepare(`INSERT INTO bj_applications (user_id, stage_name, description, intro_message) VALUES (?, ?, ?, ?)`),
    listBJApps:        db.prepare(`SELECT a.*, u.nickname, u.email FROM bj_applications a JOIN users u ON u.id = a.user_id ORDER BY a.created_at DESC`),
    findBJApp:         db.prepare(`SELECT * FROM bj_applications WHERE id = ?`),
    findBJAppByUser:   db.prepare(`SELECT * FROM bj_applications WHERE user_id = ? ORDER BY created_at DESC LIMIT 1`),
    approveBJApp:      db.prepare(`UPDATE bj_applications SET status = 'approved', reviewer_id = ?, reviewed_at = CURRENT_TIMESTAMP WHERE id = ?`),
    rejectBJApp:       db.prepare(`UPDATE bj_applications SET status = 'rejected', reviewer_id = ?, reviewed_at = CURRENT_TIMESTAMP WHERE id = ?`),

    // Reports
    insertReport:      db.prepare(`INSERT INTO reports (reporter_id, target_type, target_id, reason_code, detail) VALUES (?, ?, ?, ?, ?)`),
    listReports:       db.prepare(`SELECT r.*, u.nickname AS reporter_name FROM reports r LEFT JOIN users u ON u.id = r.reporter_id ORDER BY r.created_at DESC LIMIT 100`),
    updateReportStatus:db.prepare(`UPDATE reports SET status = ? WHERE id = ?`),

    // Support tickets
    insertTicket:      db.prepare(`INSERT INTO support_tickets (user_id, email, subject, body) VALUES (?, ?, ?, ?)`),
    listTickets:       db.prepare(`SELECT t.*, u.nickname FROM support_tickets t LEFT JOIN users u ON u.id = t.user_id ORDER BY t.created_at DESC LIMIT 100`),

    // admin stats
    countUsers:        db.prepare(`SELECT COUNT(*) AS c FROM users`),
    countBJs:          db.prepare(`SELECT COUNT(*) AS c FROM bj_profiles`),
    countContents:     db.prepare(`SELECT COUNT(*) AS c FROM contents`),
    countPendingApps:  db.prepare(`SELECT COUNT(*) AS c FROM bj_applications WHERE status = 'pending'`),
    countOpenReports:  db.prepare(`SELECT COUNT(*) AS c FROM reports WHERE status = 'open'`),
    sumCharges:        db.prepare(`SELECT COALESCE(SUM(amount), 0) AS s FROM transactions WHERE type = 'charge'`),
    sumSpends:         db.prepare(`SELECT COALESCE(SUM(amount), 0) AS s FROM transactions WHERE type = 'spend'`),
    recentUsers:       db.prepare(`SELECT id, email, nickname, role, credits, age_verified, created_at
                                   FROM users ORDER BY created_at DESC LIMIT 20`),
    recentTxs:         db.prepare(`SELECT t.*, u.nickname FROM transactions t
                                   JOIN users u ON u.id = t.user_id
                                   ORDER BY t.created_at DESC LIMIT 30`),
};

// settings helpers
function getSetting(key, defaultValue) {
    const row = stmts.getSettingRaw.get(key);
    return row ? row.value : defaultValue;
}
function getSettingBool(key, defaultValue) {
    const v = getSetting(key, defaultValue ? '1' : '0');
    return v === '1' || v === 'true';
}
function setSetting(key, value) {
    stmts.setSetting.run(key, String(value));
}

// ─── 트랜잭션: 잔액 변경 + 거래 기록 동시 ────────────────────
const adjustCredits = db.transaction((userId, delta, type, description) => {
    const user = stmts.findUserById.get(userId);
    if (!user) throw new Error('User not found');
    const newBalance = user.credits + delta;
    if (newBalance < 0) throw new Error('잔액 부족');
    stmts.updateCredits.run(newBalance, userId);
    stmts.insertTx.run(userId, type, delta, newBalance, description || '');
    return newBalance;
});

module.exports = {
    db,
    stmts,
    adjustCredits,
    getSetting,
    getSettingBool,
    setSetting,
};
