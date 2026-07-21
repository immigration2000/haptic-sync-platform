/**
 * BJ 통화/함께보기/라이브 시그널링 (Socket.IO)
 *
 * 1:1 페어 종류:  call · cowatch · live-priv
 * 1:N 공개 라이브: broadcast
 *
 * BJ 상태 모델:
 *   - available: waitingBJs 에 존재, 매칭 가능
 *   - busy:      busyBJs 에 존재, 통화 중 (종료 시 available 복귀)
 *   - offline:   둘 다 없음 (소켓 끊김)
 */
const { Server } = require('socket.io');
const { stmts } = require('../db');
const activeSessions = require('./active_sessions');

module.exports = (httpServer, sessionMiddleware) => {
    const io = new Server(httpServer, {
        cors: { origin: '*' },
        maxHttpBufferSize: 1e6,
    });

    // ── 소켓 핸드셰이크에서 Express 세션 검증 ──
    // 클라이언트가 보내는 userId를 신뢰하지 않고, 로그인 세션에서 신원을 끌어온다.
    if (sessionMiddleware) {
        io.engine.use(sessionMiddleware);
    }
    io.use((socket, next) => {
        const sess = socket.request && socket.request.session;
        const uid = sess && sess.userId;
        if (!uid) return next(new Error('unauthorized'));
        const user = stmts.findUserById.get(uid);
        if (!user) return next(new Error('unauthorized'));
        socket.userId = user.id;
        socket.userRole = user.role;
        socket.userNick = user.nickname;
        next();
    });

    let waitingBJs = [];           // [{ socketId, userId, name }] — 매칭 가능
    const busyBJs  = new Map();    // socketId → bj info — 통화 중
    const pairs    = new Map();    // socketId → peerSocketId

    function bjListPublic() {
        return waitingBJs.map(b => ({ id: b.socketId, name: b.name, userId: b.userId }));
    }
    function broadcastLobby() {
        io.to('user-lobby').emit('bj-list', bjListPublic());
        io.to('broadcast-lobby').emit('bj-list', bjListPublic());
    }

    // BJ가 통화 종료 후 소켓이 살아있으면 available 복귀
    function returnBJToPool(socketId) {
        if (!busyBJs.has(socketId)) return;
        const live = io.sockets.sockets.get(socketId);
        const bj = busyBJs.get(socketId);
        busyBJs.delete(socketId);
        if (live && !waitingBJs.find(b => b.socketId === socketId)) {
            waitingBJs.push(bj);
        }
    }

    // 결제 세션 정리 — 해당 소켓이 결제 주체였으면 활성 세션에서 제거
    function clearBilling(socketId) {
        const sock = io.sockets.sockets.get(socketId);
        if (!sock || sock.userId == null) return;
        const e = activeSessions.get(sock.userId);
        if (e && e.socketId === socketId) activeSessions.delete(sock.userId);
    }

    // 페어 종료 공통 — 상대에게 알림 + BJ 복귀
    function releasePair(socketId) {
        const peerId = pairs.get(socketId);
        if (peerId === undefined) return;
        io.to(peerId).emit('peer-hangup');
        // 양쪽 결제 세션 정리 (소켓이 사라지기 전에)
        clearBilling(socketId);
        clearBilling(peerId);
        pairs.delete(peerId);
        pairs.delete(socketId);
        // 양쪽 중 BJ였던 쪽을 풀로 복귀
        returnBJToPool(socketId);
        returnBJToPool(peerId);
        broadcastLobby();
    }

    io.on('connection', (socket) => {
        let role = null;
        let bjUserId = null;

        // ── BJ 대기 등록 ── (신원은 세션에서, 클라이언트 userId 무시)
        socket.on('bj-online', () => {
            if (socket.userRole !== 'bj' && socket.userRole !== 'admin') return; // 권한 검증
            const userId = socket.userId;
            const profile = stmts.findBJ.get(userId);
            const name = (profile && profile.stage_name) || socket.userNick || 'BJ';
            role = 'bj';
            bjUserId = userId;
            socket.join('bj-pool');
            // 같은 userId의 이전 대기 항목 제거 (두 탭 중복 누적 방지) + 자기 socket 중복 방지
            waitingBJs = waitingBJs.filter(b => b.userId !== userId && b.socketId !== socket.id);
            if (!busyBJs.has(socket.id)) {
                waitingBJs.push({ socketId: socket.id, userId, name });
            }
            try { stmts.setBJOnline.run(1, userId); } catch (_) {}
            broadcastLobby();
            socket.emit('bj-registered');
        });

        socket.on('user-enter', () => {
            role = 'user';
            socket.join('user-lobby');
            socket.emit('bj-list', bjListPublic());
        });

        // ── 1:1 매칭 ── (socket = 호출자=사용자, bj = 상대 BJ)
        function doMatch(bj, kind, context) {
            waitingBJs = waitingBJs.filter(b => b.socketId !== bj.socketId);
            busyBJs.set(bj.socketId, bj);
            pairs.set(socket.id, bj.socketId);
            pairs.set(bj.socketId, socket.id);
            // 결제 권위 세션 기록: 이 사용자는 이 BJ와 통화 중 (요금은 서버가 이 값으로만 산정)
            // tier: 'call'(통화) | 'video'(모니터링/영상) | 'cam'(캠) — 사용자가 진입 시 선택
            const tier = (context && ['video', 'cam'].includes(context.tier)) ? context.tier : 'call';
            activeSessions.set(socket.userId, { bjUserId: bj.userId, kind: kind || 'call', socketId: socket.id, tier });
            broadcastLobby();
            const ctx = context || {};
            io.to(bj.socketId).emit('paired', { peerId: socket.id, peerName: socket.userNick || 'User', initiator: false, kind, context: ctx });
            socket.emit         ('paired', { peerId: bj.socketId, peerName: bj.name, initiator: true,  kind, context: ctx });
        }

        socket.on('user-call', ({ bjSocketId, bjUserIdTarget, kind, context }) => {
            // socketId 우선, 없으면 userId로 (목록이 stale해도 매칭되도록)
            let bj = bjSocketId ? waitingBJs.find(b => b.socketId === bjSocketId) : null;
            if (!bj && bjUserIdTarget != null) bj = waitingBJs.find(b => b.userId === bjUserIdTarget);

            if (!bj) {
                // busy인지 offline인지 구분
                const busyMatch = bjUserIdTarget != null
                    ? Array.from(busyBJs.values()).find(b => b.userId === bjUserIdTarget)
                    : (bjSocketId ? busyBJs.get(bjSocketId) : null);
                socket.emit('call-failed', { reason: busyMatch ? 'BJ_BUSY' : 'BJ_OFFLINE' });
                return;
            }
            doMatch(bj, kind, context);
        });

        socket.on('signal', ({ to, data }) => {
            // 자기 페어 상대에게만 릴레이 (임의 소켓에 SDP/ICE 주입 차단)
            if (to && pairs.get(socket.id) === to) io.to(to).emit('signal', { from: socket.id, data });
        });

        socket.on('hangup', () => releasePair(socket.id));

        // ── 공개 라이브 ──
        socket.on('broadcast-start', () => {
            if (socket.userRole !== 'bj' && socket.userRole !== 'admin') return; // 권한 검증
            const userId = socket.userId;
            const profile = stmts.findBJ.get(userId);
            const name = (profile && profile.stage_name) || socket.userNick || 'BJ';
            role = 'broadcaster';
            socket.join(`broadcast-${userId}`);
            socket.broadcasterUserId = userId;
            socket.broadcasterName = name;
            socket.viewers = new Set();
            try { stmts.setBJOnline.run(1, userId); } catch (_) {}
            io.to('broadcast-lobby').emit('broadcast-list-update', listBroadcasters());
            socket.emit('broadcast-ready');
        });
        socket.on('broadcast-stop', () => endBroadcast(socket));

        socket.on('broadcast-lobby-enter', () => {
            socket.join('broadcast-lobby');
            socket.emit('broadcast-list', listBroadcasters());
        });

        socket.on('viewer-join', ({ broadcasterUserId }) => {
            const allSockets = Array.from(io.sockets.sockets.values());
            const bcaster = allSockets.find(s => s.broadcasterUserId === broadcasterUserId);
            if (!bcaster) { socket.emit('viewer-failed', { reason: 'OFFLINE' }); return; }
            bcaster.viewers.add(socket.id);
            socket.broadcasterSocketId = bcaster.id;
            socket.viewingRoom = `broadcast-${broadcasterUserId}`;
            socket.join(socket.viewingRoom);   // 채팅 룸 합류 — 시청자도 chat-msg 수신
            bcaster.emit('viewer-incoming', { viewerId: socket.id });
            socket.emit('viewer-ready', { broadcasterId: bcaster.id, broadcasterName: bcaster.broadcasterName });
            io.to(`broadcast-${broadcasterUserId}`).emit('viewer-count', { count: bcaster.viewers.size });
            bcaster.emit('viewer-count', { count: bcaster.viewers.size });
        });

        socket.on('viewer-leave', () => {
            if (socket.viewingRoom) { socket.leave(socket.viewingRoom); socket.viewingRoom = null; }
            const bcid = socket.broadcasterSocketId;
            const bcaster = bcid ? io.sockets.sockets.get(bcid) : null;
            if (bcaster && bcaster.viewers) {
                bcaster.viewers.delete(socket.id);
                bcaster.emit('viewer-left', { viewerId: socket.id });
                bcaster.emit('viewer-count', { count: bcaster.viewers.size });
            }
        });

        socket.on('bcast-signal', ({ to, data }) => {
            // broadcaster↔viewer 관계인 소켓에게만 릴레이
            const allowed = socket.broadcasterSocketId === to
                || (socket.viewers && socket.viewers.has(to));
            if (allowed) io.to(to).emit('bcast-signal', { from: socket.id, data });
        });

        socket.on('chat-msg', ({ broadcasterUserId, text }) => {
            // sender는 클라이언트 입력을 믿지 않고 세션 닉네임으로 강제, text 길이 제한
            const clean = String(text == null ? '' : text).slice(0, 500);
            if (!clean) return;
            io.to(`broadcast-${broadcasterUserId}`).emit('chat-msg', {
                text: clean, sender: socket.userNick || '익명', ts: Date.now(),
            });
        });

        // ── 방송자 → 시청자 전원 디바이스 제어 (TCode 중계) ──
        // 방송 중인 소켓만 송신 가능. 방 안의 시청자들에게만 전달(발신자 제외).
        socket.on('bcast-tcode', ({ cmd }) => {
            if (!socket.broadcasterUserId) return;
            const c = String(cmd == null ? '' : cmd).slice(0, 64).trim();
            if (!c) return;
            socket.to(`broadcast-${socket.broadcasterUserId}`).emit('bcast-tcode', { cmd: c });
        });

        // ── 단일 disconnect 핸들러 (1:1 + broadcast 통합) ──
        socket.on('disconnect', () => {
            // 1:1 페어 정리 (상대 BJ 복귀 포함)
            releasePair(socket.id);
            // 결제 세션 잔여 정리 (페어가 아니었던 경우 대비)
            if (socket.userId != null) {
                const e = activeSessions.get(socket.userId);
                if (e && e.socketId === socket.id) activeSessions.delete(socket.userId);
            }
            // 자신이 available/busy BJ였으면 제거
            waitingBJs = waitingBJs.filter(b => b.socketId !== socket.id);
            busyBJs.delete(socket.id);
            // 시청자였으면 broadcaster에서 제거
            if (socket.broadcasterSocketId) {
                const bc = io.sockets.sockets.get(socket.broadcasterSocketId);
                if (bc && bc.viewers) {
                    bc.viewers.delete(socket.id);
                    bc.emit('viewer-left', { viewerId: socket.id });
                    bc.emit('viewer-count', { count: bc.viewers.size });
                }
            }
            // BJ 오프라인 처리 (다른 활성 소켓 없을 때만)
            if (role === 'bj' && bjUserId != null) {
                const stillOnline = waitingBJs.some(b => b.userId === bjUserId)
                    || Array.from(busyBJs.values()).some(b => b.userId === bjUserId);
                if (!stillOnline) { try { stmts.setBJOnline.run(0, bjUserId); } catch (_) {} }
            }
            // broadcaster였으면 방송 종료
            endBroadcast(socket);
            broadcastLobby();
        });
    });

    function endBroadcast(socket) {
        if (socket.broadcasterUserId) {
            for (const vid of socket.viewers || []) io.to(vid).emit('broadcast-ended');
            try { stmts.setBJOnline.run(0, socket.broadcasterUserId); } catch (_) {}
            socket.leave(`broadcast-${socket.broadcasterUserId}`);
            socket.broadcasterUserId = null;
            socket.viewers = null;
            io.to('broadcast-lobby').emit('broadcast-list-update', listBroadcasters());
        }
    }

    function listBroadcasters() {
        return Array.from(io.sockets.sockets.values())
            .filter(s => s.broadcasterUserId)
            .map(s => ({ broadcasterUserId: s.broadcasterUserId, name: s.broadcasterName, viewerCount: s.viewers ? s.viewers.size : 0 }));
    }

    console.log('Signaling ready (Socket.IO) — call · cowatch · live-priv · broadcast');
    return io;
};
