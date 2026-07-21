/**
 * 성인(연령) 인증 서비스 — 스켈레톤
 *
 * ⚠ 현재는 provider='none' (자가 확인). 운영 전 실제 본인확인(PASS/통신사/아이핀 등) 연동 필요.
 * 연동 시 startVerification()으로 외부 인증 세션을 열고, 콜백에서 verifyCallback()로 결과를 검증해
 * stmts.updateAgeVerified로 승인한다. auth.js의 /verify-age 가 이 모듈을 호출하도록 교체할 것.
 */
const cfg = require('../config');

const provider = cfg.ageVerification.provider; // 'none' | 'pass' | 'mobile' | ...

// 실제 본인확인 시작 — 외부 인증 페이지 URL/세션을 반환 (none이면 자가확인 폴백 신호)
function startVerification(/* user, returnUrl */) {
    if (provider === 'none') return { ok: false, mode: 'self', reason: 'PROVIDER_NOT_CONFIGURED' };
    // TODO: 공급자 SDK로 인증 트랜잭션 생성 → { ok:true, redirectUrl }
    throw new Error('age_verification provider not implemented: ' + provider);
}

// 외부 인증 콜백 검증 — 성공 시 { ok:true, verified:true, birthdate } 반환
function verifyCallback(/* req */) {
    if (provider === 'none') return { ok: false, mode: 'self', reason: 'PROVIDER_NOT_CONFIGURED' };
    // TODO: 콜백 서명/CI/DI 검증 후 성인 여부 판정
    throw new Error('age_verification provider not implemented: ' + provider);
}

module.exports = { provider, isConfigured: provider !== 'none', startVerification, verifyCallback };
