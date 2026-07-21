const isProd = process.env.NODE_ENV === 'production';
const sessionSecret = process.env.SESSION_SECRET || 'pulse-dev-secret-change-in-prod';
const csrfSecret    = process.env.CSRF_SECRET    || 'pulse-csrf-secret-change-in-prod';

// 운영(prod)에서 기본 시크릿이 그대로면 세션/CSRF 위조가 가능하므로 부팅 차단
if (isProd && (sessionSecret.includes('change-in-prod') || csrfSecret.includes('change-in-prod'))) {
    console.error('[FATAL] 운영 환경에서 기본 시크릿이 감지됨. SESSION_SECRET / CSRF_SECRET 환경변수를 설정하세요.');
    process.exit(1);
}

module.exports = {
    port:           parseInt(process.env.PORT || '5500', 10),
    sessionSecret,
    csrfSecret,
    cookieMaxAge:   1000 * 60 * 60 * 24 * 7, // 7일
    isProd,
    // Cloudflare 터널 사용 시: HTTPS 강제 + secure cookie 활성화
    behindProxy:    process.env.BEHIND_PROXY === '1' || !!process.env.CLOUDFLARE_TUNNEL,
    // 성인 인증 — 운영 전 실제 공급자 연동 (현재 'none' = 자가확인)
    ageVerification: {
        provider: process.env.AGE_PROVIDER || 'none', // none | pass | mobile
    },
    // 결제 게이트웨이 — 운영 전 실 PG 연동 (현재 'none' = Ruby 가상충전)
    pg: {
        provider: process.env.PG_PROVIDER || 'none',  // none | toss | iamport | stripe
    },
    // 운영 시 환경 변수로 덮어쓰기
    smtp: {
        enabled: false,  // 실제 메일 전송 비활성화 (로그 출력)
        from:    process.env.SMTP_FROM    || 'noreply@pulse.local',
        host:    process.env.SMTP_HOST    || '',
        port:    parseInt(process.env.SMTP_PORT || '587', 10),
        user:    process.env.SMTP_USER    || '',
        pass:    process.env.SMTP_PASS    || '',
    },
};
