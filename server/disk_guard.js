/**
 * 업로드 용량 가드 — 폰(A82) 저장공간이 차는 것을 막는다.
 *
 * 왜 필요한가:
 *   기존 카탈로그는 PC에서 ffmpeg NVENC로 압축한 뒤 올린 것이라 편당 ~300MB다.
 *   그런데 /bj-studio 업로드 경로는 **압축을 전혀 거치지 않는다.**
 *   작업자가 원본을 올리면 편당 2GB까지 가능해 30편 남짓에 폰이 찬다.
 *   폰이 차면 업로드만 실패하는 게 아니라 SQLite 쓰기가 깨져
 *   세션·결제·시청기록이 무너지고, 같은 폰의 다른 프로젝트(릴레이·터널)까지 영향을 받는다.
 *
 * 설계:
 *   - multer가 파일을 쓰기 **전에** Content-Length로 미리 거른다.
 *     (multer는 스트리밍하며 디스크에 쓰므로 다 받은 뒤 거부하면 이미 늦다)
 *   - 임계값은 설정(settings)으로 관리자가 바꿀 수 있다.
 *
 * ⚠ Content-Length는 멀티파트 전체 크기라 실제 파일보다 약간 크다.
 *   보수적으로 판단하는 쪽이므로 그대로 쓴다.
 */
const fs = require('fs');
const path = require('path');
const { getSetting } = require('./db');

const CONTENT_ROOT = path.join(__dirname, '..', 'public', 'content');

const GB = 1024 * 1024 * 1024;
const MB = 1024 * 1024;

/** 관리자 설정 (기본값은 폰 운영 기준) */
function limits() {
    const num = (key, dflt) => {
        const v = parseFloat(getSetting(key, String(dflt)));
        return isNaN(v) || v < 0 ? dflt : v;
    };
    return {
        maxFileMB:      num('upload_max_file_mb', 800),      // 파일 1개 상한
        quotaPerUserGB: num('upload_quota_user_gb', 10),     // 계정별 총량
        minFreeGB:      num('upload_min_free_gb', 5),        // 이만큼은 항상 남긴다
    };
}

/** 남은 디스크 용량(bytes). 확인 불가면 null (그 경우 가드를 통과시킨다) */
function freeBytes() {
    try {
        const st = fs.statfsSync(CONTENT_ROOT);
        return st.bsize * st.bavail;
    } catch (_) {
        return null;
    }
}

/** 디렉터리 총 용량(bytes) — 파일 수가 적어 단순 재귀로 충분하다 */
function dirSize(dir) {
    let total = 0;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return 0; }
    for (const e of entries) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) total += dirSize(p);
        else { try { total += fs.statSync(p).size; } catch (_) {} }
    }
    return total;
}

const userUsage = (userId) => dirSize(path.join(CONTENT_ROOT, 'bj', String(userId)));
const totalUsage = () => dirSize(CONTENT_ROOT);

const fmt = (bytes) => (bytes >= GB ? (bytes / GB).toFixed(1) + 'GB' : Math.round(bytes / MB) + 'MB');

/**
 * 업로드를 받아도 되는지 판단
 * @returns {{ok:true}} 또는 {{ok:false, error:string}} — error는 사용자에게 그대로 보여줄 문구
 */
function checkUpload(userId, incomingBytes) {
    const L = limits();
    const incoming = Number(incomingBytes) || 0;

    if (incoming > L.maxFileMB * MB) {
        return { ok: false, error: `파일이 너무 큽니다. 1회 업로드 상한은 ${L.maxFileMB}MB입니다. ` +
                                   `PC에서 압축한 뒤 올려주세요. (요청 크기 ${fmt(incoming)})` };
    }

    const free = freeBytes();
    if (free !== null && free - incoming < L.minFreeGB * GB) {
        return { ok: false, error: `서버 저장공간이 부족합니다. 관리자에게 문의해 주세요. ` +
                                   `(남은 공간 ${fmt(free)})` };
    }

    const used = userUsage(userId);
    if (used + incoming > L.quotaPerUserGB * GB) {
        return { ok: false, error: `계정 저장 한도(${L.quotaPerUserGB}GB)를 넘습니다. ` +
                                   `현재 ${fmt(used)} 사용 중입니다. 오래된 영상을 지운 뒤 다시 시도해 주세요.` };
    }

    return { ok: true };
}

/** multer 앞에 세우는 미들웨어 — 파일이 디스크에 써지기 전에 막는다 */
function guardUpload(req, res, next) {
    const len = parseInt(req.headers['content-length'] || '0', 10);
    const r = checkUpload(req.user ? req.user.id : 0, len);
    if (r.ok) return next();
    req.session.flash = r.error;
    return res.redirect(req.get('referer') || '/bj-studio/videos');
}

/** 관리자 대시보드용 요약 */
function status() {
    const L = limits();
    const free = freeBytes();
    const content = totalUsage();
    return {
        freeBytes: free, freeText: free === null ? '확인 불가' : fmt(free),
        contentBytes: content, contentText: fmt(content),
        minFreeGB: L.minFreeGB, maxFileMB: L.maxFileMB, quotaPerUserGB: L.quotaPerUserGB,
        low: free !== null && free < L.minFreeGB * GB * 2,   // 임계의 2배 밑이면 경고
    };
}

module.exports = { checkUpload, guardUpload, freeBytes, userUsage, totalUsage, status, limits, fmt };
