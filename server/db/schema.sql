-- PULSE schema (SQLite)

PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS users (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    email           TEXT UNIQUE NOT NULL,
    password_hash   TEXT NOT NULL,
    nickname        TEXT UNIQUE NOT NULL,
    role            TEXT NOT NULL DEFAULT 'user',          -- user | bj | admin
    age_verified    INTEGER NOT NULL DEFAULT 0,            -- 0/1
    credits         INTEGER NOT NULL DEFAULT 0,            -- Ruby balance
    subscription_until DATETIME,                            -- premium subscription expiry
    avatar_url      TEXT,
    bio             TEXT,
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- BJ 전용 프로필 (1:1 with users where role='bj')
CREATE TABLE IF NOT EXISTS bj_profiles (
    user_id          INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    stage_name       TEXT NOT NULL,
    description      TEXT,
    rate_per_minute  INTEGER NOT NULL DEFAULT 100,           -- 통화(음성+디바이스) 분당요율 (Ruby/분) — 항상 제공
    rate_with_video  INTEGER NOT NULL DEFAULT 0,             -- 모니터링(영상) 분당요율 (0 = 미제공)
    rate_cam         INTEGER NOT NULL DEFAULT 0,             -- 캠(1:1 화상) 분당요율 (0 = 미제공)
    free_preview_sec INTEGER NOT NULL DEFAULT 60,            -- 무료 체험 시간(초)
    session_block_min INTEGER NOT NULL DEFAULT 5,            -- 시간제 결제 단위(분)
    sub_price        INTEGER NOT NULL DEFAULT 0,             -- 구독권 가격 (Ruby, 0 = 구독 미제공)
    sub_days         INTEGER NOT NULL DEFAULT 30,            -- 구독 기간(일)
    services         TEXT NOT NULL DEFAULT 'voice_1on1',                        -- 서비스 태그(고정 4종, 콤마) — server/service_types.js
    device_control   INTEGER NOT NULL DEFAULT 1,                                -- 기기 제어 제공 여부 (서비스와 직교)
    show_sub_videos  INTEGER NOT NULL DEFAULT 1,                                -- 구독전용 영상을 전체 카탈로그에 노출
    tags             TEXT,                                    -- comma-separated
    rating_avg       REAL NOT NULL DEFAULT 0,
    rating_count     INTEGER NOT NULL DEFAULT 0,
    total_minutes    INTEGER NOT NULL DEFAULT 0,
    is_online        INTEGER NOT NULL DEFAULT 0,
    updated_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS contents (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    type            TEXT NOT NULL,                          -- vod | vr | volumetric
    title           TEXT NOT NULL,
    description     TEXT,
    creator         TEXT,
    video_path      TEXT NOT NULL,                          -- /content/vods/xxx.mp4
    script_path     TEXT,                                   -- main funscript (.funscript). multi-axis는 같은 base에서 자동 탐색
    thumbnail_path  TEXT,
    duration_sec    INTEGER NOT NULL DEFAULT 0,
    price           INTEGER NOT NULL DEFAULT 0,             -- 0 = subscription only
    tags            TEXT,
    multi_axis      INTEGER NOT NULL DEFAULT 0,             -- 0/1 for badge
    age_restricted  INTEGER NOT NULL DEFAULT 1,
    view_count      INTEGER NOT NULL DEFAULT 0,
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_contents_type ON contents(type);

CREATE TABLE IF NOT EXISTS watch_history (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content_id      INTEGER NOT NULL REFERENCES contents(id) ON DELETE CASCADE,
    last_position   INTEGER NOT NULL DEFAULT 0,             -- seconds
    watched_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (user_id, content_id)
);

CREATE TABLE IF NOT EXISTS call_logs (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    bj_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    started_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ended_at        DATETIME,
    duration_sec    INTEGER NOT NULL DEFAULT 0,
    charged         INTEGER NOT NULL DEFAULT 0,             -- Ruby
    kind            TEXT NOT NULL DEFAULT 'call'            -- call | cowatch | live_priv | live_pub
);

CREATE TABLE IF NOT EXISTS transactions (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type            TEXT NOT NULL,                          -- charge | spend | refund | reward
    amount          INTEGER NOT NULL,                       -- + or -
    balance_after   INTEGER NOT NULL,
    description     TEXT,
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS subscriptions (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    tier            TEXT NOT NULL,                          -- basic | premium | vip
    start_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    end_at          DATETIME NOT NULL,
    status          TEXT NOT NULL DEFAULT 'active'          -- active | cancelled | expired
);

-- 사이트 전역 설정 (key-value)
CREATE TABLE IF NOT EXISTS settings (
    key     TEXT PRIMARY KEY,
    value   TEXT NOT NULL,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- BJ 개인 업로드 영상
CREATE TABLE IF NOT EXISTS bj_videos (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    bj_user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title        TEXT NOT NULL,
    video_path   TEXT NOT NULL,
    script_path  TEXT,
    price        INTEGER NOT NULL DEFAULT 0,               -- 개별구매(PPV) 가격 (Ruby, 0 = 구독전용)
    created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_bj_videos_user ON bj_videos(bj_user_id);

-- BJ별 구독 (기간제). 구독 중이면 해당 BJ 영상 자유 열람
CREATE TABLE IF NOT EXISTS bj_subscriptions (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    bj_user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    start_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    end_at       DATETIME NOT NULL,
    created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_bj_subs_user ON bj_subscriptions(user_id, bj_user_id);

-- 영상 개별구매(PPV). 한 번 사면 영구 열람
CREATE TABLE IF NOT EXISTS video_purchases (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    video_id     INTEGER NOT NULL REFERENCES bj_videos(id) ON DELETE CASCADE,
    created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (user_id, video_id)
);

-- 이메일 인증 / 비밀번호 재설정 토큰
CREATE TABLE IF NOT EXISTS auth_tokens (
    token       TEXT PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    purpose     TEXT NOT NULL,                            -- verify_email | reset_password
    created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at  DATETIME NOT NULL,
    used_at     DATETIME
);
CREATE INDEX IF NOT EXISTS idx_auth_tokens_user ON auth_tokens(user_id, purpose);

-- BJ 신청
CREATE TABLE IF NOT EXISTS bj_applications (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    stage_name    TEXT NOT NULL,
    description   TEXT,
    intro_message TEXT,
    status        TEXT NOT NULL DEFAULT 'pending',         -- pending | approved | rejected
    reviewer_id   INTEGER REFERENCES users(id),
    reviewed_at   DATETIME,
    created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 신고
CREATE TABLE IF NOT EXISTS reports (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    reporter_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
    target_type   TEXT NOT NULL,                            -- content | bj | user | other
    target_id     INTEGER,
    reason_code   TEXT NOT NULL,                            -- spam | illegal | abuse | underage | other
    detail        TEXT,
    status        TEXT NOT NULL DEFAULT 'open',             -- open | reviewed | resolved
    created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 고객센터 문의
CREATE TABLE IF NOT EXISTS support_tickets (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
    email       TEXT,                                       -- 비로그인 문의 가능
    subject     TEXT NOT NULL,
    body        TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'open',
    created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 더미 BJ "방송 방" — 진짜 사용자 아닌 데모용 카드. 라이브 로비/BJ 목록에 표시 가능
CREATE TABLE IF NOT EXISTS dummy_bj_rooms (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    stage_name       TEXT NOT NULL,
    description      TEXT,
    rate_per_minute  INTEGER NOT NULL DEFAULT 100,
    free_preview_sec INTEGER NOT NULL DEFAULT 60,
    session_block_min INTEGER NOT NULL DEFAULT 5,
    tags             TEXT,
    rating_avg       REAL DEFAULT 4.5,
    viewer_count     INTEGER DEFAULT 0,                     -- 가짜 시청자 수
    thumbnail        TEXT,                                    -- 옵션
    looping_video    TEXT,                                    -- 클릭 시 재생할 데모 영상 경로
    is_active        INTEGER NOT NULL DEFAULT 1,              -- 개별 더미 on/off
    sort_order       INTEGER NOT NULL DEFAULT 0,
    created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
