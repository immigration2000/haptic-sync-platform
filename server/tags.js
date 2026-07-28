/**
 * 커스텀 태그 엔진 — 의상·주제 등 정보 전달용 태그
 * (서비스 태그 4종은 별개: server/service_types.js — 그쪽은 고정 enum이라 여기 규칙 안 탐)
 *
 * 운영 모드 3가지 — 관리자가 설정에서 전환 (설정키: tag_mode)
 *   approval : 승인된 태그만 노출. 신규는 pending으로 쌓이고 관리자 승인 후 공개  ← 기본(가장 안전)
 *   filter   : 자유 입력 + 금지어(관리자 편집 목록) 자동 차단. 통과하면 즉시 공개
 *   open     : 자유 입력, 관리자 금지어 미적용 (가장 느슨)
 *
 * ⚠ 어떤 모드에서도 CORE_BLOCK(미성년·불법 암시)은 항상 차단된다.
 *   이건 운영 정책이 아니라 법적 요구사항이라 모드로 끌 수 없게 설계했다.
 *   (아청법 등 — 미성년 암시 태그는 플랫폼 자체가 위험해짐)
 */
const { db, stmts, getSetting, setSetting } = require('./db');

const MODES = ['approval', 'filter', 'open'];
const DEFAULT_MODE = 'approval';

/** 모드와 무관하게 항상 차단 (법적 안전장치) */
const CORE_BLOCK = [
    '미성년', '미성년자', '청소년', '초등', '초딩', '중딩', '여중생', '남중생',
    '고딩', '여고생', '남고생', '교복', '아동', '유아', '로리', '쇼타',
    'loli', 'lolita', 'shota', 'child', 'minor', 'underage', 'teen', 'jailbait',
    '강간', '몰카', '불법촬영', '마약', 'rape', 'drug',
];

const CATEGORIES = ['의상', '주제', '분위기', '컨셉', '기타'];

/** 태그명 정규화 — 앞의 #, 공백/대소문자 정리, 길이 제한 */
function normalizeName(raw) {
    return String(raw || '')
        .replace(/^#+/, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 20);
}

const getMode = () => {
    const m = getSetting('tag_mode');
    return MODES.includes(m) ? m : DEFAULT_MODE;
};
const setMode = (m) => { if (MODES.includes(m)) setSetting('tag_mode', m); };

/** 관리자 편집 금지어 목록 (filter 모드에서 적용) */
const getBannedWords = () =>
    String(getSetting('tag_banned_words') || '')
        .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
const setBannedWords = (csv) =>
    setSetting('tag_banned_words', String(csv || '').split(',').map(s => s.trim()).filter(Boolean).join(','));

const containsAny = (name, list) => {
    const n = name.toLowerCase();
    return list.some(w => w && n.includes(w));
};

/**
 * 태그 1개 판정 → { name, action, reason }
 *   action: 'attach'(즉시 사용) | 'pending'(승인대기) | 'reject'(차단)
 */
function judge(name, mode) {
    if (!name) return { name, action: 'reject', reason: '빈 태그' };
    if (containsAny(name, CORE_BLOCK)) {
        return { name, action: 'reject', reason: '금지 표현(법적 차단)' };
    }
    if (mode === 'filter' && containsAny(name, getBannedWords())) {
        return { name, action: 'reject', reason: '금지어' };
    }
    const existing = stmts.findTagByName.get(name);
    if (existing) {
        if (existing.status === 'rejected') return { name, action: 'reject', reason: '차단된 태그' };
        if (existing.status === 'approved') return { name, action: 'attach', tagId: existing.id };
        // pending 상태 — approval 모드면 계속 대기, 그 외 모드면 승격
        if (mode === 'approval') return { name, action: 'pending', tagId: existing.id };
        db.prepare("UPDATE tags SET status = 'approved' WHERE id = ?").run(existing.id);
        return { name, action: 'attach', tagId: existing.id };
    }
    // 신규 태그 — approval이면 승인대기로 생성, 나머지는 바로 승인
    const status = (mode === 'approval') ? 'pending' : 'approved';
    return { name, action: status === 'pending' ? 'pending' : 'attach', status, isNew: true };
}

/**
 * 스트리머의 태그 제출 처리 (기존 연결은 교체)
 * @returns { attached:[names], pending:[names], rejected:[{name,reason}] }
 */
function submitForStreamer(userId, rawList, createdBy) {
    const mode = getMode();
    let names = rawList;
    if (typeof names === 'string') names = names.split(',');
    if (!Array.isArray(names)) names = [];
    names = names.map(normalizeName).filter(Boolean);
    names = [...new Set(names)].slice(0, 10);          // 중복 제거 + 최대 10개

    const attached = [], pending = [], rejected = [];
    const tagIds = [];

    for (const name of names) {
        const r = judge(name, mode);
        if (r.action === 'reject') { rejected.push({ name, reason: r.reason }); continue; }
        let tagId = r.tagId;
        if (!tagId) {
            const ins = stmts.insertTag.run(name, '기타', r.status || 'pending', createdBy || userId);
            tagId = Number(ins.lastInsertRowid);
        }
        if (r.action === 'attach') { attached.push(name); tagIds.push(tagId); }
        else pending.push(name);
    }

    // 연결 교체 (승인된 것만 실제 연결)
    stmts.clearBJTags.run(userId);
    for (const id of tagIds) {
        try { stmts.addBJTag.run(userId, id); } catch (_) {}
    }
    try { db.exec('UPDATE tags SET use_count = (SELECT COUNT(*) FROM bj_tags WHERE tag_id = tags.id)'); } catch (_) {}

    return { attached, pending, rejected, mode };
}

/**
 * 영상 1편의 태그 제출 (기존 연결은 교체)
 * 스트리머 태그와 같은 마스터·모드·차단 규칙을 쓴다.
 * @param source 'content'(사이트 VOD/VR) | 'bj'(스트리머 업로드)
 * @returns { attached, pending, rejected, mode }
 */
function submitForVideo(source, videoId, rawList, createdBy) {
    const mode = getMode();
    const src = source === 'content' ? 'content' : 'bj';
    let names = rawList;
    if (typeof names === 'string') names = names.split(',');
    if (!Array.isArray(names)) names = [];
    names = [...new Set(names.map(normalizeName).filter(Boolean))].slice(0, 8);

    const attached = [], pending = [], rejected = [];
    const tagIds = [];

    for (const name of names) {
        const r = judge(name, mode);
        if (r.action === 'reject') { rejected.push({ name, reason: r.reason }); continue; }
        let tagId = r.tagId;
        if (!tagId) {
            const ins = stmts.insertTag.run(name, '기타', r.status || 'pending', createdBy || null);
            tagId = Number(ins.lastInsertRowid);
        }
        if (r.action === 'attach') { attached.push(name); tagIds.push(tagId); }
        else pending.push(name);
    }

    stmts.clearVideoTags.run(src, videoId);
    for (const id of tagIds) {
        try { stmts.addVideoTag.run(src, videoId, id); } catch (_) {}
    }
    return { attached, pending, rejected, mode };
}

module.exports = {
    MODES, DEFAULT_MODE, CORE_BLOCK, CATEGORIES,
    normalizeName, getMode, setMode, getBannedWords, setBannedWords,
    judge, submitForStreamer, submitForVideo,
};
