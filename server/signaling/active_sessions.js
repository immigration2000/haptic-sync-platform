/**
 * 활성 통화 세션 공유 스토어 (시그널링 ↔ 결제 HTTP 라우트)
 *
 * key:   사용자 user_id (결제 주체)
 * value: { bjUserId, kind, socketId }
 *
 * 시그널링에서 매칭(doMatch) 시 기록하고 종료 시 삭제한다.
 * /bj/session/charge·/info 는 클라이언트가 보낸 bjUserId 대신
 * 이 스토어의 권위 있는 값으로 금액을 산정한다 (요금 우회 방지).
 */
module.exports = new Map();
