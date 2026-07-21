/**
 * 결제 게이트웨이(PG) 서비스 — 스켈레톤
 *
 * ⚠ 현재는 provider='none' (Ruby 가상화폐 잔액 직접 증감). 운영 전 실 PG(토스/아임포트/스트라이프 등) 연동 필요.
 * 연동 시 createCharge()로 결제창을 열고, verifyWebhook()으로 결제완료 콜백을 검증한 뒤에만
 * adjustCredits(+amount)로 충전을 확정한다. mypage.js /charge 가 이 모듈을 경유하도록 교체할 것.
 */
const cfg = require('../config');

const provider = cfg.pg.provider; // 'none' | 'toss' | 'iamport' | 'stripe' | ...

// 결제 요청 생성 — 결제창 URL/주문ID 반환 (none이면 미설정 신호 → 현행 가상충전 폴백)
function createCharge(/* user, amountKRW, orderId */) {
    if (provider === 'none') return { ok: false, mode: 'virtual', reason: 'PG_NOT_CONFIGURED' };
    // TODO: PG SDK로 결제 트랜잭션 생성 → { ok:true, redirectUrl, orderId }
    throw new Error('payment provider not implemented: ' + provider);
}

// 결제 완료 웹훅/콜백 검증 — 성공 시 { ok:true, paid:true, amount, orderId } 반환
function verifyWebhook(/* req */) {
    if (provider === 'none') return { ok: false, mode: 'virtual', reason: 'PG_NOT_CONFIGURED' };
    // TODO: 서명/금액/중복 검증 후 확정. 검증 통과분만 adjustCredits로 반영
    throw new Error('payment provider not implemented: ' + provider);
}

module.exports = { provider, isConfigured: provider !== 'none', createCharge, verifyWebhook };
