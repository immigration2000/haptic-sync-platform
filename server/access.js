/**
 * BJ 영상 접근 권한 — 구독(기간제) + 개별구매(PPV) 병행 모델
 *   소유자 / 활성 구독자 / 구매자 → 열람 허용
 *   그 외: price>0 이면 구매 또는 구독 필요, price==0 이면 구독 전용
 */
const { stmts } = require('./db');

function videoAccess(userId, video) {
    if (!video) return { allowed: false, reason: 'NOT_FOUND' };
    if (userId && userId === video.bj_user_id) return { allowed: true, reason: 'OWNER' };
    if (userId && stmts.activeBJSub.get(userId, video.bj_user_id)) return { allowed: true, reason: 'SUBSCRIBED' };
    if (userId && stmts.hasVideoPurchase.get(userId, video.id)) return { allowed: true, reason: 'PURCHASED' };
    return { allowed: false, reason: video.price > 0 ? 'NEED_PURCHASE_OR_SUB' : 'NEED_SUB' };
}

function isSubscribed(userId, bjUserId) {
    return !!(userId && stmts.activeBJSub.get(userId, bjUserId));
}

module.exports = { videoAccess, isSubscribed };
