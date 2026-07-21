/**
 * Seed initial users, BJs, content
 * Run: npm run seed
 */
const bcrypt = require('bcryptjs');
const { db, stmts, setSetting } = require('../server/db');

console.log('Seeding PULSE database...');

const tx = db.transaction(() => {
    // Wipe non-content tables for re-seed
    db.exec('DELETE FROM call_logs');
    db.exec('DELETE FROM transactions');
    db.exec('DELETE FROM subscriptions');
    db.exec('DELETE FROM watch_history');
    db.exec('DELETE FROM bj_profiles');
    db.exec('DELETE FROM users');
    db.exec('DELETE FROM contents');
    db.exec('DELETE FROM dummy_bj_rooms');

    // ─── Users ────────────────────────────────────────────
    const userPass = bcrypt.hashSync('1234', 10);

    // Admin
    stmts.insertUser.run('admin@pulse.dev', userPass, '관리자', 'admin', 1);

    // Regular user
    const userId = stmts.insertUser.run('test@pulse.dev', userPass, '테스터', 'user', 1).lastInsertRowid;
    stmts.updateCredits.run(50000, userId);
    stmts.insertTx.run(userId, 'reward', 50000, 50000, '가입 보너스 (테스트)');

    // BJs
    const bjs = [
        { email: 'sophia@pulse.dev', nick: '소피아',  stage: '소피아',  desc: '우아하고 세련된 분위기', rate: 150, free: 60, block: 5,  tags: '#성숙,#텍니션', svc: 'call,cowatch,live-priv,broadcast' },
        { email: 'aimee@pulse.dev',  nick: '에이미',  stage: '에이미',  desc: '발랄하고 청량한 매력', rate: 120, free: 60, block: 3,  tags: '#발랄,#포어플레이', svc: 'call,cowatch' },
        { email: 'luna@pulse.dev',   nick: '루나',    stage: '루나',    desc: '신비롭고 몽환적인 비주얼', rate: 180, free: 30, block: 10, tags: '#성숙,#인텐스', svc: 'call,live-priv' },
        { email: 'jenny@pulse.dev',  nick: '제니',    stage: '제니',    desc: '귀엽고 사랑스러운 매력', rate: 100, free: 60, block: 5,  tags: '#비기너,#발랄', svc: 'call' },
        { email: 'aria@pulse.dev',   nick: '아리아',  stage: '아리아',  desc: '강렬한 카리스마', rate: 200, free: 30, block: 10, tags: '#카리스마,#텍니션', svc: 'call,cowatch,live-priv,broadcast' },
    ];
    const setBJTimes = db.prepare('UPDATE bj_profiles SET free_preview_sec = ?, session_block_min = ?, services = ? WHERE user_id = ?');
    for (const bj of bjs) {
        const r = stmts.insertUser.run(bj.email, userPass, bj.nick, 'bj', 1);
        stmts.insertBJProfile.run(r.lastInsertRowid, bj.stage, bj.desc, bj.rate, bj.tags);
        setBJTimes.run(bj.free, bj.block, bj.svc, r.lastInsertRowid);
    }

    // ─── Contents ────────────────────────────────────────
    // VR (이미 폰/PC에 있는 자산)
    const VRS = [
        { title: 'Technician 01', file: 'vr_technician_001', script: 'vr_technician_01', duration: 317, multi: 1, tags: '#3축,#텍니션' },
        { title: 'Technician 02', file: 'vr_technician_002', script: 'vr_technician_02', duration: 320, multi: 1, tags: '#3축,#텍니션' },
        { title: 'Technician 03', file: 'vr_technician_003', script: 'vr_technician_03', duration: 300, multi: 1, tags: '#2축,#텍니션' },
        { title: 'Technician 04', file: 'vr_technician_004', script: 'vr_technician_04', duration: 240, multi: 0, tags: '#텍니션' },
        { title: 'Technician 05', file: 'vr_technician_005', script: 'vr_technician_05', duration: 210, multi: 0, tags: '#텍니션' },
    ];
    for (const v of VRS) {
        stmts.insertContent.run(
            'vr',
            v.title,
            'AlphaMain 시리즈 — VR 4K 다축 인터랙티브',
            '리얼버스 스튜디오',
            `/content/vrs/${v.file}.mp4`,
            `/content/vrs/${v.script}.funscript`,
            `/content/thumbnails/${v.file}.jpg`,
            v.duration, 30, v.tags, v.multi
        );
    }

    // VOD (일반 2D — IWeb에서 옮길 거)
    const VODS = [
        { title: '러브 인 더 시티', file: 'vod1', script: 'vod1', duration: 1259, tags: '#로멘틱' },
        { title: '환상의 밤',         file: 'vod2', script: 'vod2', duration: 1080, tags: '#판타지' },
        { title: '시간의 조각',      file: 'vod3', script: 'vod3', duration: 1225, tags: '#감성' },
        { title: '바람의 노래',      file: 'vod4', script: 'vod4', duration: 990,  tags: '#감성' },
        { title: '겨울 동화',         file: 'vod5', script: 'vod5', duration: 1140, tags: '#로멘틱' },
        { title: '비밀의 정원',      file: 'vod6', script: 'vod6', duration: 1080, tags: '#판타지' },
        { title: '여름의 끝',         file: 'vod7', script: 'vod7', duration: 1308, tags: '#감성' },
        { title: '달빛 산책',         file: 'vod8', script: 'vod8', duration: 720,  tags: '#감성' },
    ];
    for (const v of VODS) {
        stmts.insertContent.run(
            'vod',
            v.title,
            `${v.title} — 2D 영상 + 동작 스크립트 동기`,
            '리얼버스',
            `/content/vods/${v.file}.mp4`,
            `/content/vods/${v.script}.funscript`,
            `/content/thumbnails/${v.file}.jpg`,
            v.duration, 20, v.tags, 0
        );
    }

    // ─── Dummy BJ rooms (라이브 로비/BJ 목록에 표시될 가짜 방) ─────
    const DUMMIES = [
        { name: '✨ 미야',     desc: '신비롭고 차분한 분위기의 안내자',           rate: 130, free: 60, block: 5,  tags: '#성숙,#텍니션', viewers: 47, video: '/content/vrs/vr_technician_001.mp4' },
        { name: '🔥 카리나',  desc: '강렬한 비주얼 + 다축 인터랙티브',           rate: 180, free: 30, block: 10, tags: '#카리스마,#인텐스', viewers: 89, video: '/content/vrs/vr_technician_002.mp4' },
        { name: '💋 유나',    desc: '청순한 매력의 신인 스트리머',                       rate: 110, free: 60, block: 3,  tags: '#비기너,#청순', viewers: 23, video: '/content/vrs/vr_technician_003.mp4' },
        { name: '🌙 세나',    desc: '몽환적 분위기 + 시청자 맞춤 응대',           rate: 160, free: 45, block: 5,  tags: '#성숙,#감성', viewers: 62, video: '/content/vrs/vr_technician_004.mp4' },
        { name: '⚡ 리아',    desc: '에너지 넘치는 라이브 + 디바이스 풀활용',     rate: 200, free: 30, block: 10, tags: '#발랄,#에너지', viewers: 134, video: '/content/vrs/vr_technician_005.mp4' },
        { name: '🌸 하나',    desc: '아침형 스트리머 — 잔잔한 모닝 라이브',             rate: 100, free: 60, block: 5,  tags: '#모닝,#청순', viewers: 18, video: '/content/vods/vod1.mp4' },
        { name: '🌑 이브',    desc: '심야 전문, 다축 시퀀스 마스터',               rate: 220, free: 30, block: 15, tags: '#심야,#텍니션,#다축', viewers: 76, video: '/content/vods/vod2.mp4' },
    ];
    for (const d of DUMMIES) {
        stmts.insertDummyRoom2.run(d.name, d.desc, d.rate, d.free, d.block, d.tags, d.viewers, null, d.video);
    }

    // ─── BJ 데모 통화 기록 (sophia 기준) ─────────────────
    // user_id: admin=1, test=2, sophia=3, aimee=4, luna=5, jenny=6, aria=7
    const insertCall = db.prepare(`INSERT INTO call_logs (user_id, bj_id, started_at, ended_at, duration_sec, charged, kind)
                                   VALUES (?, ?, datetime('now', ?), datetime('now', ?), ?, ?, ?)`);
    // sophia (id=3) 데모 통화 5건
    insertCall.run(2, 3, '-2 days',   '-2 days', 1200, 3000, 'call');      // 20분
    insertCall.run(2, 3, '-1 days',   '-1 days', 1800, 4500, 'cowatch');   // 30분
    insertCall.run(2, 3, '-12 hours', '-12 hours', 600, 1500, 'call');     // 10분
    insertCall.run(2, 3, '-6 hours',  '-6 hours', 2400, 7200, 'live-priv'); // 40분
    insertCall.run(2, 3, '-2 hours',  '-2 hours', 900, 2250, 'call');      // 15분

    // ─── 기본 설정 ─────────────────────────────────────────
    setSetting('dummy_bj_enabled', '1');   // 더미 BJ/라이브 노출 ON (시연용 기본)
    setSetting('site_message', '');         // 사이트 전체 공지
    setSetting('maintenance_mode', '0');    // 점검 모드
});

tx();

console.log('✓ Seed complete');
console.log(`  - users:     ${db.prepare('SELECT COUNT(*) AS c FROM users').get().c}`);
console.log(`  - bj_profiles: ${db.prepare('SELECT COUNT(*) AS c FROM bj_profiles').get().c}`);
console.log(`  - contents:  ${db.prepare('SELECT COUNT(*) AS c FROM contents').get().c}`);
console.log('\nTest login: test@pulse.dev / 1234');
console.log('Admin login: admin@pulse.dev / 1234');
