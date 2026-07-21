/**
 * PULSE — main Express server (production-ready)
 */
const express        = require('express');
const session        = require('express-session');
const FileStore      = require('session-file-store')(session);
const flash          = require('connect-flash');
const layouts        = require('express-ejs-layouts');
const path           = require('path');
const http           = require('http');
const helmet         = require('helmet');
const compression    = require('compression');
const morgan         = require('morgan');
const { rateLimit }  = require('express-rate-limit');
const cookieParser   = require('cookie-parser');
const fs             = require('fs');

const cfg = require('./config');
const { attachUser } = require('./middleware/auth');

const app = express();
const httpServer = http.createServer(app);

// ─── Cloudflare/proxy 뒷단이면 trust proxy 활성화 ─────────
if (cfg.behindProxy) {
    app.set('trust proxy', 1);
    console.log('[app] trust proxy enabled (Cloudflare/reverse proxy)');
}

// ─── 압축 / 보안 헤더 ────────────────────────────────────
app.use(compression());
app.use(helmet({
    contentSecurityPolicy: false,           // EJS 인라인 스크립트 많아서 임시 비활성 — 추후 nonce 도입
    crossOriginEmbedderPolicy: false,       // WebRTC + media 호환
    crossOriginResourcePolicy: { policy: 'cross-origin' },
}));

// ─── 액세스 로그 (파일 + 콘솔) ───────────────────────────
const logDir = path.join(__dirname, '..', 'data', 'logs');
fs.mkdirSync(logDir, { recursive: true });
const accessLog = fs.createWriteStream(path.join(logDir, 'access.log'), { flags: 'a' });
app.use(morgan(':remote-addr :method :url :status :res[content-length] - :response-time ms', { stream: accessLog }));
app.use(morgan('dev')); // 콘솔에도

// ─── 사이트 출입 게이트 (Basic 인증) ─────────────────────
// 허가된 아이디/비번을 가진 사람만 사이트 진입. 자격은 data/gate.json 에서 관리.
// 모든 페이지/정적/라우트보다 먼저 — /health 만 통과(터널 모니터링).
app.use(require('./middleware/gate'));

// ─── Body parser ────────────────────────────────────────
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));
app.use(cookieParser());   // csrf-csrf가 req.cookies로 토큰 쿠키를 읽음

// ─── Session ────────────────────────────────────────────
const sessionStore = new FileStore({
    path: path.join(__dirname, '..', 'data', 'sessions'),
    ttl: cfg.cookieMaxAge / 1000,
    retries: 0,
    reapInterval: 60 * 60, // 1시간마다 만료 세션 정리
});
// 손상 세션 파일 방어 — 깨진 JSON/cookie 필드 누락 세션이 500을 내지 않고 새 세션으로 대체
const storeGet = sessionStore.get.bind(sessionStore);
sessionStore.get = (sid, cb) => storeGet(sid, (err, sess) => {
    if (err && err.code !== 'ENOENT') return cb(null, null);
    if (sess && !sess.cookie) return cb(null, null);
    cb(err, sess);
});

const sessionMiddleware = session({
    name: 'pulse.sid',
    secret: cfg.sessionSecret,
    resave: false,
    saveUninitialized: false,
    store: sessionStore,
    cookie: {
        httpOnly: true,
        secure: cfg.behindProxy,   // Cloudflare HTTPS 뒷단이면 secure
        sameSite: 'lax',
        maxAge: cfg.cookieMaxAge,
    },
});
app.use(sessionMiddleware);
app.use(flash());
app.use(attachUser);

// ─── Rate limiting ──────────────────────────────────────
// 일반 — 분당 200 요청
const generalLimit = rateLimit({
    windowMs: 60 * 1000,
    max: 200,
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => req.path.startsWith('/content/vods/')
                || req.path.startsWith('/content/vrs/')
                || req.path.startsWith('/css/')
                || req.path.startsWith('/js/')
                || req.path.startsWith('/socket.io/'),
});
app.use(generalLimit);

// 인증 — 분당 10 요청
const authLimit = rateLimit({
    windowMs: 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'too_many_attempts', message: '너무 많은 시도. 잠시 후 다시 시도해주세요.' },
});

// ─── CSRF (double-submit) ───────────────────────────────
// 설정은 middleware/csrf.js에서 (멀티파트 업로드 라우트와 공유). 실제 적용은 정적 자산 이후.
const { generateCsrfToken, doubleCsrfProtection } = require('./middleware/csrf');

// ─── Views ──────────────────────────────────────────────
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));
app.use(layouts);
app.set('layout', 'layout');
app.set('layout extractScripts', true);
app.set('layout extractStyles', true);

// ─── Static ─────────────────────────────────────────────
app.use(express.static(path.join(__dirname, '..', 'public'), { maxAge: '1d' }));

// ─── Public utility routes (CSRF 면제) ───────────────────
app.get('/health',   (req, res) => res.json({ ok: true, time: new Date().toISOString() }));
app.get('/robots.txt', (req, res) => res.type('text/plain').send('User-agent: *\nDisallow: /admin\nDisallow: /mypage\nDisallow: /auth\nSitemap: /sitemap.xml\n'));
app.get('/sitemap.xml', (req, res) => {
    const urls = ['/', '/content/vod', '/content/vr', '/bj', '/bj/live-lobby', '/pricing', '/about', '/legal', '/auth/login', '/auth/register'];
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(u => `  <url><loc>${u}</loc></url>`).join('\n')}\n</urlset>`;
    res.type('application/xml').send(xml);
});

// ─── Routes ─────────────────────────────────────────────
const { stmts, getSettingBool, getSetting } = require('./db');

// 점검 모드 — admin 외 차단
app.use((req, res, next) => {
    if (req.path === '/health' || req.path.startsWith('/admin') || req.path.startsWith('/auth')) return next();
    if (getSettingBool('maintenance_mode', false) && (!req.user || req.user.role !== 'admin')) {
        return res.status(503).render('error', { title: '점검 중', message: '현재 서비스 점검 중입니다. 잠시 후 다시 이용해주세요.' });
    }
    next();
});

// 사이트 공지 — res.locals로
app.use((req, res, next) => {
    res.locals.siteMessage = getSetting('site_message', '');
    next();
});

// ─── CSRF 토큰 발급 + 검증 (정적 자산·유틸 라우트 이후라 자산 요청은 스킵) ───
app.use((req, res, next) => {
    // 세션 id를 안정화해 double-submit 토큰을 세션에 묶음 (익명 방문자도 1회 세션 생성)
    if (req.session && req.session.csrfInit === undefined) req.session.csrfInit = 1;
    // 손상/오래된 pulse-csrf 쿠키가 있으면 generateToken이 예외를 던짐 → overwrite=true로 강제 재발급.
    // (실패해도 빈 문자열을 넣어 템플릿의 <%= csrfToken %>가 ReferenceError로 500나지 않게)
    try {
        res.locals.csrfToken = generateCsrfToken(req, res);
    } catch (_) {
        try { res.locals.csrfToken = generateCsrfToken(req, res, true); }
        catch (__) { res.locals.csrfToken = ''; }
    }
    next();
});
app.use((req, res, next) => {
    // 멀티파트(파일 업로드)는 multer가 body를 파싱한 뒤 라우트에서 직접 검증
    if (req.is('multipart/form-data')) return next();
    return doubleCsrfProtection(req, res, next);
});

app.get('/', (req, res) => {
    const vods = stmts.listContents.all('vod').slice(0, 10);
    const vrs  = stmts.listContents.all('vr').slice(0, 10);
    const realBJs = stmts.listBJs.all();
    const dummyRooms = getSettingBool('dummy_bj_enabled', true) ? stmts.listActiveDummy.all() : [];
    const allBJs = [
        ...dummyRooms.map(d => ({
            id: 'dummy_' + d.id, stage_name: d.stage_name, description: d.description, tags: d.tags,
            rate_per_minute: d.rate_per_minute, is_online: 1, is_dummy: true,
            viewer_count: d.viewer_count, href: '/bj/dummy/' + d.id,
        })),
        ...realBJs.map(b => ({ ...b, href: '/bj/call/' + b.id })),
    ];
    res.render('home', {
        title: 'PULSE — Interactive Platform',
        vods, vrs, bjs: allBJs,
        featured: vrs[0] || vods[0] || null,
    });
});

// 인증 라우트는 별도 rate limit
app.use('/auth',    authLimit, require('./routes/auth'));
app.use('/content', require('./routes/content'));
app.use('/bj',      require('./routes/bj'));
app.use('/mypage',  require('./routes/mypage'));
app.use('/admin',     require('./routes/admin'));
app.use('/bj-studio', require('./routes/bj_studio'));
app.use('/support',   require('./routes/support'));
app.use('/feed',      require('./routes/feed'));

// 정적 페이지
app.get('/pricing', (req, res) => res.render('pricing', { title: '요금제' }));
app.get('/about',   (req, res) => res.render('about',   { title: 'PULSE 소개' }));
app.get('/legal',   (req, res) => res.render('legal',   { title: '법적 안내' }));

// ─── 404 ────────────────────────────────────────────────
app.use((req, res) => res.status(404).render('error', { title: '404', message: '존재하지 않는 페이지입니다.' }));

// ─── Global error handler ───────────────────────────────
app.use((err, req, res, next) => {
    console.error('[err]', err);
    fs.appendFileSync(path.join(logDir, 'error.log'),
        `[${new Date().toISOString()}] ${req.method} ${req.path} — ${err.stack || err}\n`);
    if (err && err.code === 'EBADCSRFTOKEN') {
        return res.status(403).render('error', { title: '403', message: '보안 토큰 검증 실패. 다시 시도해주세요.' });
    }
    const status = err.status || 500;
    res.status(status).render('error', { title: String(status), message: cfg.isProd ? '오류가 발생했습니다.' : (err.message || '오류') });
});

// ─── Signaling ──────────────────────────────────────────
// 세션 미들웨어를 공유해 소켓 핸드셰이크에서 로그인 사용자 검증
require('./signaling/bj_signaling')(httpServer, sessionMiddleware);

// ─── Listen ─────────────────────────────────────────────
httpServer.listen(cfg.port, () => {
    console.log(`PULSE server ready at http://localhost:${cfg.port}`);
    console.log(`  trust_proxy=${cfg.behindProxy} prod=${cfg.isProd}`);
});

