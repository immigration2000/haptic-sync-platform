#!/bin/bash
# PULSE 통합 스모크 테스트 — 모든 기능 자동 검증
HOST="http://localhost:5501"
JAR="/tmp/pulse_smoke_$$.txt"
TOTAL=0; PASSED=0; FAILED=0
declare -a FAILURES

pass() { PASSED=$((PASSED+1)); printf "  \033[32m✓\033[0m %s\n" "$1"; }
fail() { FAILED=$((FAILED+1)); FAILURES+=("$1"); printf "  \033[31m✗\033[0m %s\n" "$1"; }

check() {
    TOTAL=$((TOTAL+1))
    local name="$1"; local expected="$2"; local actual="$3"
    if [ "$expected" = "$actual" ]; then pass "$name (status=$actual)"; else fail "$name (expected=$expected, got=$actual)"; fi
}

check_contains() {
    TOTAL=$((TOTAL+1))
    local name="$1"; local needle="$2"; local content="$3"
    if echo "$content" | grep -q "$needle"; then pass "$name"; else fail "$name (missing: $needle)"; fi
}

# CSRF 토큰 추출 (지정 jar로 GET 후 meta 토큰 파싱 — pulse-csrf 쿠키와 짝)
get_csrf() {  # $1=jar  $2=path
    curl -s -c "$1" -b "$1" "$HOST$2" | grep -oE 'name="csrf-token" content="[^"]+"' | head -1 | sed 's/.*content="//; s/"$//'
}

echo
echo "═══════════════════════════════════════════════"
echo "  PULSE 스모크 테스트"
echo "═══════════════════════════════════════════════"
echo

# ─── 1. 서버 헬스 ─────────────────────────────────────
echo "▸ 서버 헬스"
check "GET /" "200" "$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 $HOST/)"
check "GET /pricing" "200" "$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 $HOST/pricing)"
check "GET /about" "200" "$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 $HOST/about)"
check "GET /legal" "200" "$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 $HOST/legal)"

# ─── 2. 정적 자산 ────────────────────────────────────
echo; echo "▸ 정적 자산"
check "CSS theme" "200" "$(curl -s -o /dev/null -w '%{http_code}' $HOST/css/theme.css)"
check "CSS components" "200" "$(curl -s -o /dev/null -w '%{http_code}' $HOST/css/components.css)"
check "CSS pulse_device" "200" "$(curl -s -o /dev/null -w '%{http_code}' $HOST/css/pulse_device.css)"
check "JS device" "200" "$(curl -s -o /dev/null -w '%{http_code}' $HOST/js/core/device.js)"
check "JS funscript" "200" "$(curl -s -o /dev/null -w '%{http_code}' $HOST/js/core/funscript.js)"
check "JS header" "200" "$(curl -s -o /dev/null -w '%{http_code}' $HOST/js/core/header.js)"
check "JS simple-peer" "200" "$(curl -s -o /dev/null -w '%{http_code}' $HOST/js/vendor/simple-peer.min.js)"
check "Socket.IO" "200" "$(curl -s -o /dev/null -w '%{http_code}' $HOST/socket.io/socket.io.js)"

# ─── 3. 자산 (영상/스크립트) ─────────────────────────
echo; echo "▸ 콘텐츠 자산"
check "VOD1 mp4 (range)" "206" "$(curl -s -o /dev/null -w '%{http_code}' -r 0-1023 $HOST/content/vods/vod1.mp4)"
check "VOD9 mp4 (range)" "206" "$(curl -s -o /dev/null -w '%{http_code}' -r 0-1023 $HOST/content/vods/vod9.mp4)"
check "VR tech 001 mp4" "206" "$(curl -s -o /dev/null -w '%{http_code}' -r 0-1023 $HOST/content/vrs/vr_technician_001.mp4)"
check "VR tech 005 mp4" "206" "$(curl -s -o /dev/null -w '%{http_code}' -r 0-1023 $HOST/content/vrs/vr_technician_005.mp4)"
check "VR script main" "200" "$(curl -s -o /dev/null -w '%{http_code}' $HOST/content/vrs/vr_technician_01.funscript)"
check "VR script pitch" "200" "$(curl -s -o /dev/null -w '%{http_code}' $HOST/content/vrs/vr_technician_01.pitch.funscript)"
check "VR script roll" "200" "$(curl -s -o /dev/null -w '%{http_code}' $HOST/content/vrs/vr_technician_01.roll.funscript)"

# ─── 4. 인증 흐름 ────────────────────────────────────
echo; echo "▸ 인증 (비로그인 → 보호 페이지 리다이렉트)"
check "비로그인 /content/vod → 302" "302" "$(curl -s -o /dev/null -w '%{http_code}' $HOST/content/vod)"
check "비로그인 /bj → 302"          "302" "$(curl -s -o /dev/null -w '%{http_code}' $HOST/bj)"
check "비로그인 /mypage → 302"      "302" "$(curl -s -o /dev/null -w '%{http_code}' $HOST/mypage)"

echo; echo "▸ 로그인 → 세션 (CSRF 토큰 포함)"
rm -f $JAR
TOK=$(get_csrf $JAR /auth/login)
curl -s -c $JAR -b $JAR -X POST --data-urlencode "_csrf=$TOK" --data-urlencode "email=test@pulse.dev" --data-urlencode "password=1234" $HOST/auth/login -o /dev/null
check "로그인 후 / 접근" "200" "$(curl -s -b $JAR -c $JAR -o /dev/null -w '%{http_code}' $HOST/)"
check "로그인 후 /mypage 접근" "200" "$(curl -s -b $JAR -c $JAR -o /dev/null -w '%{http_code}' $HOST/mypage)"
# CSRF 토큰 없는 POST는 차단되어야 (403)
check "CSRF 토큰 없는 로그인 POST → 403" "403" "$(curl -s -X POST -d 'email=test@pulse.dev&password=1234' -o /dev/null -w '%{http_code}' $HOST/auth/login)"
JARW="/tmp/pulse_smoke_w_$$.txt"; rm -f $JARW
TOKW=$(get_csrf $JARW /auth/login)
check "잘못된 비번 → 302" "302" "$(curl -s -b $JARW -c $JARW -X POST --data-urlencode "_csrf=$TOKW" --data-urlencode 'email=test@pulse.dev' --data-urlencode 'password=wrong' -o /dev/null -w '%{http_code}' $HOST/auth/login)"; rm -f $JARW

# ─── 5. 콘텐츠 렌더링 ────────────────────────────────
echo; echo "▸ 콘텐츠 페이지"
VOD_HTML=$(curl -s -b $JAR $HOST/content/vod)
check_contains "VOD 목록에 vod 카드 표시" "content-card" "$VOD_HTML"
check_contains "VOD 목록에 한국어 제목" "러브 인 더 시티" "$VOD_HTML"
VR_HTML=$(curl -s -b $JAR $HOST/content/vr)
check_contains "VR 목록에 Technician" "Technician 01" "$VR_HTML"
check_contains "VR 목록에 다축 배지" "badge-multi" "$VR_HTML"

PLAY_HTML=$(curl -s -b $JAR $HOST/content/play/2)
check_contains "플레이어 video 태그" "<video" "$PLAY_HTML"
check_contains "플레이어 funscript 경로" "fsPath" "$PLAY_HTML"
check_contains "플레이어 디바이스 패널" "DEVICE STATUS" "$PLAY_HTML"

# ─── 6. BJ 시스템 ────────────────────────────────────
echo; echo "▸ BJ 시스템"
BJ_HTML=$(curl -s -b $JAR $HOST/bj)
check_contains "BJ 목록 카드" "bj-card" "$BJ_HTML"
check_contains "BJ 이름 5명" "소피아" "$BJ_HTML"
check_contains "BJ 분당 요금 표시" "Rb/분" "$BJ_HTML"

# BJ 통화 페이지 — sophia의 user_id는 3 (admin=1, test=2, sophia=3, aimee=4, ...)
BJ_CALL=$(curl -s -b $JAR -L $HOST/bj/call/3)
check_contains "BJ 통화 페이지 동작" "통화 시작" "$BJ_CALL"
check_contains "BJ 통화 socket.io 로드" "socket.io" "$BJ_CALL"

# BJ 콘솔 (BJ 권한 없는 사용자 → 차단)
check "일반 사용자 /bj/console → 403" "403" "$(curl -s -b $JAR -o /dev/null -w '%{http_code}' $HOST/bj/console)"

# BJ 계정으로 로그인 → 콘솔 진입
JAR_BJ="/tmp/pulse_smoke_bj_$$.txt"
rm -f $JAR_BJ
TOKB=$(get_csrf $JAR_BJ /auth/login)
curl -s -c $JAR_BJ -b $JAR_BJ -X POST --data-urlencode "_csrf=$TOKB" --data-urlencode "email=sophia@pulse.dev" --data-urlencode "password=1234" $HOST/auth/login -o /dev/null
check "BJ 로그인 후 콘솔 접근" "200" "$(curl -s -b $JAR_BJ -o /dev/null -w '%{http_code}' $HOST/bj/console)"
BJ_CONSOLE=$(curl -s -b $JAR_BJ $HOST/bj/console)
check_contains "콘솔 가상 조작 슬라이더" "ax-l0" "$BJ_CONSOLE"

# ─── 7. 마이페이지 ──────────────────────────────────
echo; echo "▸ 마이페이지 / 결제"
MY_HTML=$(curl -s -b $JAR $HOST/mypage)
check_contains "마이페이지 잔액 표시" "RUBY BALANCE" "$MY_HTML"
BILL_HTML=$(curl -s -b $JAR $HOST/mypage/billing)
check_contains "결제 페이지 충전 버튼" "충전" "$BILL_HTML"
HIST_HTML=$(curl -s -b $JAR $HOST/mypage/history)
check_contains "시청기록 페이지" "최근 시청" "$HIST_HTML"

# 충전 실행 → 잔액 증가 검증 (헤더에 user.credits 표시되는 곳에서 추출)
extract_balance() {
    curl -s -b $JAR $HOST/ | grep -oE '[0-9,]+ Rb<' | head -1 | tr -d ', Rb<'
}
BEFORE=$(extract_balance)
TOKC=$(get_csrf $JAR /mypage/billing)
curl -s -b $JAR -c $JAR -X POST --data-urlencode "_csrf=$TOKC" --data-urlencode "amount=5000" $HOST/mypage/charge -o /dev/null
AFTER=$(extract_balance)
TOTAL=$((TOTAL+1))
if [ -n "$BEFORE" ] && [ -n "$AFTER" ] && [ "$AFTER" -gt "$BEFORE" ]; then
    pass "충전 후 잔액 증가 ($BEFORE → $AFTER, +$((AFTER-BEFORE)))"
else
    fail "잔액 변화 없음 ($BEFORE → $AFTER)"
fi

# ─── 8. DB 무결성 ───────────────────────────────────
echo; echo "▸ DB 무결성"
DB="D:/Leeminsoo/Project/Website/IWeb/IRealverse-main/pulse/data/pulse.db"
if [ -f "$DB" ]; then pass "SQLite 파일 존재 ($(du -h $DB | cut -f1))"; else fail "DB 파일 없음"; fi
TOTAL=$((TOTAL+1))

# ─── 결과 ──────────────────────────────────────────
echo
echo "═══════════════════════════════════════════════"
printf "  결과: \033[32m%d 통과\033[0m / \033[31m%d 실패\033[0m / 총 %d\n" $PASSED $FAILED $TOTAL
echo "═══════════════════════════════════════════════"
if [ $FAILED -gt 0 ]; then
    echo
    echo "실패한 항목:"
    for f in "${FAILURES[@]}"; do echo "  - $f"; done
fi
rm -f $JAR $JAR_BJ
exit $FAILED
