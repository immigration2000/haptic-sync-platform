#!/data/data/com.termux/files/usr/bin/sh
# PULSE 자동 기동 — Termux:Boot 가 부팅 후 이 디렉터리의 스크립트를 실행한다.
#
# 왜 있는가: 폰이 꺼지거나 재부팅되면 sshd·서버·터널이 **전부** 안 올라와
#   매번 손으로 Termux 를 열어 sshd 부터 띄워야 했다 (2026-10-11, 11-08).
#
# 설계 메모:
#   · 이미 떠 있으면 두 번 띄우지 않는다 — 수동 실행해도 안전하다.
#   · 서버 생존 확인은 pgrep 이 아니라 **/health 응답**으로 한다.
#     pgrep -f 로 패턴을 넓게 잡으면 **자기 자신(ssh 명령줄)까지 잡는다** (RULES R-2).
#   · 환경은 현재 운영과 동일: PORT=5501, BEHIND_PROXY 안 씀.
#     BEHIND_PROXY=1 을 켜면 세션 쿠키가 secure 가 되어 LAN HTTP 로그인이 깨진다.
set -u
export PATH=/data/data/com.termux/files/usr/bin:$PATH
LOGDIR=$HOME/pulse/data/logs
mkdir -p "$LOGDIR"
exec >> "$LOGDIR/boot.log" 2>&1
echo "===== boot $(date) ====="

sleep 10                      # 부팅 직후 네트워크·스토리지가 자리잡을 시간
termux-wake-lock 2>/dev/null  # 화면 꺼져도 CPU 안 자게 (Doze 방지)

# ① sshd
if pgrep -x sshd >/dev/null 2>&1; then echo "sshd 이미 실행 중"; else sshd && echo "sshd 시작"; fi

# ② PULSE 서버
cd "$HOME/pulse" || exit 1
if curl -s -m 5 -o /dev/null http://localhost:5501/health; then
    echo "PULSE 서버 이미 실행 중"
else
    setsid env PORT=5501 node server/app.js > "$LOGDIR/run_$(date +%Y%m%d_%H%M%S).log" 2>&1 < /dev/null &
    echo "PULSE 서버 시작"
fi

# ③ Cloudflare 터널 (realhage.com · syncra.uk)
if pgrep -f "^cloudflared tunnel run syncra" >/dev/null 2>&1; then
    echo "터널 이미 실행 중"
else
    setsid cloudflared tunnel run syncra > "$HOME/pulse/named.log" 2>&1 < /dev/null &
    echo "터널 시작"
fi

sleep 10
echo "--- 상태 ---"
curl -s -m 5 http://localhost:5501/health; echo
echo "===== done $(date) ====="
