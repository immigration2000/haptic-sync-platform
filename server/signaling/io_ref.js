/**
 * 시그널링 io 인스턴스 공유
 *
 * HTTP 라우트(결제·후원 등)에서 소켓 룸으로 알림을 보내야 할 때 사용한다.
 * 핵심: 후원 알림 같은 "돈이 걸린 이벤트"는 **결제가 서버에서 성공한 뒤 서버가 직접** 쏜다.
 * 클라이언트가 소켓으로 "내가 후원했다"고 주장하는 경로를 만들면 위조가 가능하므로 두지 않는다.
 */
let io = null;

module.exports = {
    set: (instance) => { io = instance; },
    get: () => io,

    /** 특정 스트리머의 방송 룸(방송자+시청자 전원)에 이벤트 발송 */
    toBroadcast(bjUserId, event, payload) {
        if (!io) return false;
        io.to(`broadcast-${bjUserId}`).emit(event, payload);
        return true;
    },
};
