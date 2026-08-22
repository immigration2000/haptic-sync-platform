/**
 * 라이브 스트리밍 서비스 타입 — 사이트 전체의 단일 기준 (Single Source of Truth)
 *
 * 구조: 매체(음성|영상) × 대상(1:1|1:다수) = 4종.
 * 이 4종이 "서비스 태그"이며 **고정 enum**이다. 스트리머가 자유입력할 수 없다.
 *   → 서비스 태그가 사이트의 실제 동작(라우팅·과금·시그널링)을 결정하므로,
 *     자유입력을 허용하면 오타 하나로 서비스가 안 열리거나 우회가 생긴다.
 * 의상·주제 등 정보 전달용 "커스텀 태그"는 별도 시스템(승인제)으로 관리한다.
 *
 * 과금:
 *   1:1  → per_minute (기존 분당 결제 모듈 사용)
 *   1:다수 → donation (입장 무료 + 후원)
 *
 * '기기 제어 제공 여부'는 이 4종과 직교하는 별도 플래그(device_control)다.
 * (태그에 섞으면 8종이 되어 복잡해지므로 분리)
 */

const SERVICE_TYPES = [
    { code: 'voice_1on1',  label: '1:1 음성 통화', short: '음성통화', icon: '🎤',
      medium: 'voice', audience: '1on1',  billing: 'per_minute', rateField: 'rate_per_minute',
      desc: '목소리 + 기기 교감 (1:1)' },
    { code: 'video_1on1',  label: '1:1 영상 통화', short: '영상통화', icon: '📷',
      medium: 'video', audience: '1on1',  billing: 'per_minute', rateField: 'rate_cam',
      desc: '화상 + 기기 교감 (1:1). 영상 함께보기 포함' },
    { code: 'voice_multi', label: '음성 방송',     short: '음성방송', icon: '📻',
      medium: 'voice', audience: 'multi', billing: 'donation',   rateField: null,
      desc: '라디오형 1:다수 음성 (입장 무료 · 후원)' },
    { code: 'video_multi', label: '영상 방송',     short: '영상방송', icon: '📺',
      medium: 'video', audience: 'multi', billing: 'donation',   rateField: null,
      desc: '인터넷 방송형 1:다수 영상 (입장 무료 · 후원)' },
];

const CODES   = SERVICE_TYPES.map(s => s.code);
const BY_CODE = Object.fromEntries(SERVICE_TYPES.map(s => [s.code, s]));

/** 구 코드 → 신 코드 (기존 DB 값 및 하위호환용)
 *  cowatch(함께보기)·live-priv(비공개방)는 별도 서비스가 아니라
 *  1:1 영상 통화 '안의 기능'으로 흡수한다. */
const LEGACY_MAP = {
    call:         'voice_1on1',
    cam:          'video_1on1',
    cowatch:      'video_1on1',
    'live-priv':  'video_1on1',
    broadcast:    'video_multi',
};

/** 콤마 문자열/배열 → 유효한 신규 코드 배열 (구 코드 자동 변환, 중복 제거)
 *
 * ⚠ 2026-08-22: 예전에는 **최소 1개를 강제**해서 빈 값이면 voice_1on1을 넣었다.
 *   그래서 "라이브 서비스를 하나도 안 함"(영상 업로드만 하는 계정)을 표현할 수 없었고,
 *   업로드 전용 계정이 1:1 통화를 제공하는 것처럼 취급돼 요율 검사에 걸리고
 *   보이스 목록에도 노출됐다. 이제 **빈 배열을 허용**한다.
 *   → 빈 서비스 = 라이브 미제공. 목록·매칭에서 제외되고, 영상 업로드/구독은 그대로 된다.
 *   과금 tier 판정(normalizeTier)은 별개다 — 그쪽은 여전히 기본값으로 떨어진다.
 */
function normalizeList(input) {
    let arr = input;
    if (typeof arr === 'string') arr = arr.split(',');
    if (!Array.isArray(arr)) arr = [];
    const out = [];
    for (let v of arr) {
        v = String(v || '').trim();
        if (!v) continue;
        if (LEGACY_MAP[v]) v = LEGACY_MAP[v];
        if (CODES.includes(v) && !out.includes(v)) out.push(v);
    }
    return out;                                       // 빈 배열 허용 (= 라이브 미제공)
}

/** DB 저장용 콤마 문자열 */
const normalizeServices = (input) => normalizeList(input).join(',');

/** 해당 스트리머가 이 서비스를 제공하는가 */
const has = (services, code) => normalizeList(services).includes(code);

/* ── 요율 ──────────────────────────────────────────────────────
 * 서비스 코드 ↔ DB 요율 컬럼 매핑을 여기서만 한다.
 *   voice_1on1 → rate_per_minute   (항상 제공, 기본 요율)
 *   video_1on1 → rate_cam          (0이면 미제공)
 *   *_multi    → 요율 없음(입장 무료 + 후원)
 * ⚠ rate_with_video(옛 '모니터링')는 video_1on1로 흡수되어 더 이상 쓰지 않는다.
 *   DB 컬럼은 과거 데이터 보존을 위해 남겨두되, 값은 마이그레이션에서 rate_cam으로 옮긴다.
 */
const LEGACY_TIER = { call: 'voice_1on1', video: 'video_1on1', cam: 'video_1on1' };

/** 결제 tier 값 정규화 — 구 값('call'/'video'/'cam')도 받아 서비스 코드로 통일 */
function normalizeTier(t) {
    const v = String(t || '').trim();
    if (LEGACY_TIER[v]) return LEGACY_TIER[v];
    return CODES.includes(v) && BY_CODE[v].audience === '1on1' ? v : 'voice_1on1';
}

/** 서비스 코드에 해당하는 분당 요율. 미제공(0)이면 기본 요율로 폴백. */
function rateOf(profile, code) {
    if (!profile) return 0;
    const s = BY_CODE[normalizeTier(code)];
    const base = profile.rate_per_minute || 0;
    if (!s || !s.rateField) return base;
    const v = profile[s.rateField] || 0;
    return v > 0 ? v : base;
}

module.exports = {
    SERVICE_TYPES, CODES, BY_CODE, LEGACY_MAP, LEGACY_TIER,
    normalizeList, normalizeServices, has, normalizeTier, rateOf,
};
