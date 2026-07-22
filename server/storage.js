/**
 * 파일 저장소 추상화 — 로컬 디스크 ↔ AWS S3 전환 대비
 *
 * 왜 필요한가:
 *   지금은 폰(A82) 로컬 디스크에 저장하지만, 트래픽이 늘면 스트리밍을 AWS로 옮겨야 한다.
 *   그때 코드 전반을 고치지 않으려면 **"파일이 어디 있는가"를 한 곳에서만 결정**해야 한다.
 *
 * 핵심 규칙 — DB에는 절대 절대경로/도메인을 넣지 않는다:
 *   DB에 저장하는 값 = 논리 키(key).  예) 'bj/3/1712345_a.jpg'
 *   화면에 쓰는 값   = publicUrl(key) 로 만든 URL
 *   → 로컬이면  /content/bj/3/1712345_a.jpg
 *   → S3/CDN이면 https://cdn.example.com/bj/3/1712345_a.jpg
 *   저장소를 바꿔도 DB 데이터는 그대로 두고 설정만 바꾸면 된다.
 *
 * 마이그레이션 시 할 일 (예상):
 *   1) STORAGE_DRIVER=s3, S3_BUCKET, CDN_BASE_URL 환경변수 설정
 *   2) 기존 public/content/** 를 S3로 1회 동기화 (aws s3 sync)
 *   3) 이 파일의 s3 드라이버 구현부만 채우기 (@aws-sdk/client-s3)
 *   앱 나머지 코드(라우트·뷰)는 수정 없음.
 */
const fs   = require('fs');
const path = require('path');

const DRIVER   = process.env.STORAGE_DRIVER || 'local';        // 'local' | 's3'
const CDN_BASE = (process.env.CDN_BASE_URL || '').replace(/\/$/, '');
const LOCAL_ROOT   = path.join(__dirname, '..', 'public', 'content');
const LOCAL_PREFIX = '/content';                                // 로컬 정적 서빙 경로

/** 업로드 원본 파일명을 안전한 저장 키로 (경로 조작·한글 깨짐 방지) */
function safeName(originalname) {
    const ext  = path.extname(originalname).toLowerCase().replace(/[^.\w]/g, '').slice(0, 10);
    const base = path.basename(originalname, path.extname(originalname))
        .replace(/[^\w.\-]/g, '_').slice(0, 40) || 'file';
    return `${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${base}${ext}`;
}

/** 논리 키 → 실제 접근 URL. 뷰에서는 반드시 이걸 통해서만 경로를 만든다. */
function publicUrl(key) {
    if (!key) return '';
    // 과거 데이터 호환: 이미 '/content/...' 나 절대 URL로 저장된 값은 그대로 쓴다
    if (/^https?:\/\//i.test(key)) return key;
    if (key.startsWith('/')) return key;
    if (DRIVER === 's3' && CDN_BASE) return `${CDN_BASE}/${key}`;
    return `${LOCAL_PREFIX}/${key}`;
}

/** 저장 키 만들기 — 'bj/<userId>/<파일명>' 형태 */
const buildKey = (scope, userId, originalname) =>
    `${scope}/${userId}/${safeName(originalname)}`;

/** 로컬 드라이버에서 키의 실제 파일 경로 */
const localPathOf = (key) => path.join(LOCAL_ROOT, key.replace(/^\/+/, ''));

/** 파일 삭제 — 저장소 종류와 무관하게 이 함수만 호출 */
function remove(key) {
    if (!key) return;
    if (DRIVER === 's3') {
        // TODO(S3): DeleteObjectCommand — 마이그레이션 시 구현
        return;
    }
    try {
        // 과거 '/content/xxx' 형태도 처리
        const rel = key.startsWith(LOCAL_PREFIX) ? key.slice(LOCAL_PREFIX.length) : key;
        fs.unlinkSync(localPathOf(rel));
    } catch (_) { /* 이미 없으면 무시 */ }
}

/** 로컬 디스크 저장 위치 (multer diskStorage용) */
function localDir(scope, userId) {
    const dir = path.join(LOCAL_ROOT, scope, String(userId));
    fs.mkdirSync(dir, { recursive: true });
    return dir;
}

module.exports = {
    DRIVER, CDN_BASE,
    safeName, publicUrl, buildKey, remove, localDir, localPathOf,
    isS3: () => DRIVER === 's3',
};
