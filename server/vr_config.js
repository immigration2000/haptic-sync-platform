/**
 * VR 평면 재투영 기본값 — 관리자가 설정(설정값에 JSON 저장), 사용자는 플레이어에서 개별 조절.
 * 키: settings.vr_reproject = {"hFovDeg":..,"fisheyeFovDeg":..,"pitchDeg":..,"yawDeg":..}
 */
const { getSetting, setSetting } = require('./db');

const DEFAULT = { hFovDeg: 100, fisheyeFovDeg: 100, pitchDeg: 30, yawDeg: 0 };

function clampNum(v, min, max, fallback) {
    const n = parseFloat(v);
    if (!isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
}

function get() {
    try { return Object.assign({}, DEFAULT, JSON.parse(getSetting('vr_reproject', '{}'))); }
    catch (_) { return Object.assign({}, DEFAULT); }
}

// 관리자 입력 정규화 후 저장
function set(input) {
    const cur = get();
    const next = {
        hFovDeg:       clampNum(input.hFovDeg,       50, 160, cur.hFovDeg),
        fisheyeFovDeg: clampNum(input.fisheyeFovDeg, 60, 230, cur.fisheyeFovDeg),
        pitchDeg:      clampNum(input.pitchDeg,     -80,  80, cur.pitchDeg),
        yawDeg:        clampNum(input.yawDeg,       -80,  80, cur.yawDeg),
    };
    setSetting('vr_reproject', JSON.stringify(next));
    return next;
}

module.exports = { get, set, DEFAULT };
