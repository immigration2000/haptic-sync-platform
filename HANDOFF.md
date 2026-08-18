# 🔖 PULSE — 새 대화 핸드오프 (START HERE)

> 새 대화를 시작하면 **이 파일을 먼저 읽으라**고 Claude에게 요청하세요.
> 함께 `PROJECT_STATUS.md`도 읽으면 전체 맥락이 복원됩니다.
> 마지막 업데이트: **2026-08-18**

---

## 0. 새 대화 첫 메시지 추천 문구
```
pulse/HANDOFF.md 와 pulse/PROJECT_STATUS.md 먼저 읽고 맥락 파악해줘.
이어서 작업할 거야.
```

---

## 1. 한 줄 요약
스트리머↔사용자 양방향 인터랙티브 성인 디바이스 플랫폼 (투자 시연 + 실서비스 수준).
서비스 주소 **https://syncra.uk** · 레포 `immigration2000/haptic-sync-platform`(private).

**서비스 3축** — 태그로 서로 연결(교차 유입):
| 축 | 내용 |
|---|---|
| **영상** | 통합 카탈로그 + 좌측 필터(타입·이용방식·태그). 무료/PPV/구독전용 |
| **라이브** | 서비스 태그 4종 = 매체(음성/영상) × 대상(1:1/1:다수). 1:1은 분당, 1:N은 무료입장+후원 |
| **피드** | 스트리머 홍보 SNS. 구간 클립·사진 → "전체 영상 보기" 유입 동선 |

라이브 4종: `voice_1on1` `video_1on1` `voice_multi`(스푼형) `video_multi`(인터넷방송형)
→ **`server/service_types.js`가 단일 기준**(고정 enum). 함께보기·비공개방은 video_1on1에 흡수됨.

## 2. 작업 위치

- **작업 폴더(= git 저장소):** `C:\Users\user\Documents\GitHub\haptic-sync-platform`
  원격 `immigration2000/haptic-sync-platform` (private)
- ⚠ **옛 사본이 아직 남아 있다:** `D:\Leeminsoo\Project\Website\IWeb\IRealverse-main\pulse`.
  삭제되지 않았으므로 **엉뚱한 쪽을 고치지 않도록 주의.** git 저장소는 `C:` 쪽이다.
- 데스크톱 릴레이 앱 `haptic-relay-desktop`은 **노트북(Codex) 담당** — PC에서 건드리지 않는다.
- OS: Windows 11 / PowerShell (Bash 도구도 사용 가능)

### AI 공유 노트 (필수 — 매 작업)
PC(Claude Code)와 노트북(Codex)이 번갈아 작업한다.
공유 노트: `C:\Users\user\AI_NOTES` (원격 `immigration2000/AI_NOTES`).
**전체 작업 흐름과 규칙은 이 저장소 `CLAUDE.md`에 있다 — 작업 시작 전 반드시 볼 것.**
특히 `RULES.md` R-1(폰 pkill 충돌) · R-4(T-Code 포맷)는 실제 사고 이력이다.

### 전용 서브에이전트
`D:\Leeminsoo\Project\Website\IWeb\.claude\agents\` 에 3종이 있다
(`pulse-security-reviewer` · `pulse-e2e-tester` · `pulse-phone-deployer`).
⚠ **옛 폴더에 있어서 지금 작업 폴더(`C:`)에서는 로드되지 않는다.**
쓰려면 이 저장소 `.claude/agents/`로 복사해야 한다.

## 3. 현재 상태 (DONE)
- 서비스 태그 4종 체계 · 커스텀 태그(운영모드 3종) · 통합 영상 카탈로그 ✅
- 후원(1:N 수익화) · 음성방송(스푼형) ✅
- SNS 피드(구간 클립·사진·댓글·신고) + 저장소 추상화(AWS 대비) ✅
- 결제(무료체험→분당결제→연장) · 구독 · PPV ✅
- **하드웨어 실기기 검증 완료**(2026-07-28) ✅
- 모바일 네비(드로어+하단탭) · 출입게이트 · 마스터계정 ✅
- 보안/운영/관리자/스튜디오 ✅
→ 상세 이력은 `PROJECT_STATUS.md` §9

## 4. 배포 — 가장 중요 ⚠️
| 서비스 | 포트 | 비고 |
|--------|------|------|
| **PULSE (신규)** | **5501** | 작업 대상 |
| IWeb (옛 데모) | 5500 | 건드리지 말 것 |

**외부 URL(고정·영구):** https://syncra.uk  (+ www.syncra.uk)
(폰 **cloudflared named tunnel**이 5501→이 URL. **재부팅/재시작에도 주소 영구 불변.** 무제한 대역폭. 로그 `~/pulse/named.log`)
- 터널 id `54a9f992-1739-414b-9fe6-b437688ecf42`, 이름 `syncra`. 설정 `~/.cloudflared/config.yml`(ingress: syncra.uk·www→localhost:5501), 자격증명 `~/.cloudflared/<id>.json`, 계정인증서 `~/.cloudflared/cert.pem`.
- 터널만 죽으면 재시작: `bash ~/pulse/restart_named.sh` (wake-lock + 옛 cloudflared 정리 + `cloudflared tunnel run syncra`).
- 도메인 `syncra.uk`는 Cloudflare Registrar 등록(zone 자동 활성). DNS는 `cloudflared tunnel route dns syncra <host>`로 CNAME 자동 생성.
- **⚠ 폐기**: trycloudflare(주소 가변)·ngrok(무료 월 ~1GB 대역폭이라 영상에 ERR_NGROK_725). `restart_cf.sh`/`restart_ngrok.sh`/ngrok 바이너리는 잔재 — 쓰지 말 것.

**폰 접속:** `ssh -o StrictHostKeyChecking=no -p 8022 u0_a870@192.168.219.108`
(IP 192.168.219.108 — 같은 LAN 가정. 바뀌면 폰에서 재확인)

**폰 PULSE 기동:**
```bash
ssh -o StrictHostKeyChecking=no -p 8022 u0_a870@192.168.219.108 \
  "cd ~/pulse && setsid env PORT=5501 BEHIND_PROXY=1 node server/app.js > data/logs/run.log 2>&1 < /dev/null & disown; echo spawned"
```
**중지:** `pkill -f 'server/app.js'` (← 반드시 이 패턴)
⚠ **폰 한 대에 PULSE(5501)와 노트북의 relay 테스트(4174)가 함께 돈다.**
`pkill -f node` / `pkill -f cloudflared` 같은 넓은 패턴은 **남의 프로젝트를 죽인다**
(2026-08-18 실제 사고). 터널도 `pkill -f 'run syncra'`로 좁힐 것. AI_NOTES `RULES.md` R-1.
**health:** `curl -s http://localhost:5501/health`

## 5. 로컬 테스트
```bash
# PowerShell에서 기존 node 정리 후
cd /c/Users/user/Documents/GitHub/haptic-sync-platform
PORT=5502 node server/app.js     # Bash 도구로
# health: curl http://localhost:5502/health
```
테스트 계정: `test@pulse.dev` / `1234` (일반). admin 계정 별도 존재.
**마스터 계정**(2026-06-18): 로그인 `1111` / 비번 `2222` — role=admin(=모든 권한 통과) + bj_profiles(스트리머) + age인증 + 크레딧 99,999,999. 생성/갱신 스크립트 `node scripts/make_master.js`(폰에서). 로그인 폼은 `type=text`로 변경(이메일 아닌 아이디 허용).

## 6. 폰 배포 절차 (코드 변경 후)
```bash
# 1) 변경 파일 tar로 전송 (예시)
tar -cf - <파일들> | \
  ssh -p 8022 u0_a870@192.168.219.108 "cd ~/pulse && tar -xf -"
# 2) package.json 바뀌었으면: npm install --omit=optional --production
# 3) 4번 절차로 재기동
```

## 7. 절대 잊지 말 것 (Gotchas)
1. **포트 5501** (5500 아님 — EADDRINUSE 났던 원인)
2. `pkill`은 `'server/app.js'` 패턴만 — 안 그러면 SSH/IWeb 같이 죽음
3. nohup 대신 **`setsid`** — SSH 끊겨도 생존
4. 폰 Node 26 → `node:sqlite` 어댑터 자동, bcryptjs 사용 (네이티브 빌드 X)
5. 모달 숨김: `.ps-modal-backdrop[hidden]{display:none!important}` 유지
6. Windows curl은 Git Bash `/tmp` 경로 못 읽음 → 업로드 테스트 시 절대경로 사용
7. CSP는 현재 비활성(인라인 스크립트 多) — 운영 전 nonce 도입 필요
8. **뷰/정적 파일만 바꿨으면 서버 재시작 불필요** (EJS는 매 요청 읽음). 단 **CSS/JS는 1일 캐시**라 `views/layout.ejs`의 `?v=` 값을 올려야 반영됨.
9. **멀티파트 업로드는 CSRF를 라우트에서 직접 검증** (글로벌은 스킵). multer가 CSRF보다 먼저 파일을 쓰므로, 거부 시 파일을 지우는 처리가 필요 — 피드 업로드에 적용됨.
10. **서비스/태그/요율 값을 하드코딩하지 말 것** — `service_types.js`·`tags.js`를 거칠 것. 서비스 태그는 고정 enum이라 자유입력이 들어오면 버려짐.
11. **사이트 출입 게이트(Basic 인증)** — `server/middleware/gate.js`, app.js 최상단(morgan 직후) 마운트. 허가 계정만 사이트 진입(앱 회원로그인과 별개 앞단 관문). 계정은 폰 `~/pulse/data/gate.json`(`{enabled,realm,users:[{user,pass}]}`)에서 관리 — **파일만 고치면 5초 내 자동 반영(watchFile), 재시작 불필요**. `/health`·`/favicon.ico`만 게이트 우회. 현재 계정: `1111` / `2222`(2026-06-18 단순화, 마스터 로그인과 동일). 끄려면 gate.json `enabled:false`. 검증: 무인증 401, 정상 200.

## 8. 핵심 파일 지도
```
── 단일 기준(SSOT) 모듈 — 값을 바꾸려면 여기부터
server/service_types.js            # 서비스 4종 enum·tier 정규화·요율 매핑(rateOf)
server/tags.js                     # 태그 엔진(운영모드 3종·CORE_BLOCK·제출)
server/content_filter.js           # 피드 텍스트 필터(외부링크·연락처 차단)
server/storage.js                  # 파일 저장소 추상화(로컬↔S3, DB엔 논리키만)
server/access.js                   # 영상 접근권한(OWNER/SUBSCRIBED/PURCHASED)

── 서버
server/app.js                      # 메인 (게이트→CSRF→라우트 마운트 순서 주의)
server/db/index.js, schema.sql     # DB 어댑터·마이그레이션(멱등)·쿼리
server/middleware/gate.js          # 사이트 출입 Basic 인증
server/signaling/bj_signaling.js   # WebRTC 시그널링 + 방송 모드 검증
server/signaling/io_ref.js         # HTTP→소켓 룸 알림(후원 알림은 서버만 발송)
server/routes/{bj,bj_studio,content,feed,admin}.js

── 뷰 / 클라
views/content/catalog.ejs          # 통합 카탈로그 + 좌측 필터
views/feed/index.ejs               # SNS 피드(클립 슬라이더·사진·태그)
views/bj/{call,console,broadcast,watch}.ejs
views/admin/tags.ejs               # 태그 운영모드·승인
public/js/core/{device_drivers,device,funscript,bj_session,header}.js
public/js/pages/{bj_call,bj_console,broadcast,watch,player,vr_reproject}.js

── 문서
PROJECT_STATUS.md                  # 전체 현황 + §9 개편 상세 이력
DEPLOY.md                          # 폰 배포 전용 가이드
```

## 8-1. 하드웨어 (검증 완료)
- **실기기 동작 확인됨** (2026-07-28, 하드웨어 담당 작업자 환경에서 테스트).
  시리얼 baud **115200**(9600이면 포트는 열리나 기기가 명령을 못 읽음) + TCode 와이어 포맷
  정규화(`L050I100` → `L0500I0100`, 위치 우측패딩 3자리 / 보간 좌측패딩 4자리·1~9999 클램프).
- 드라이버 레지스트리(`public/js/core/device_drivers.js`) — 여성용 기기 추가 시 드라이버 1개만 등록.
- 연결 시 기기 응답을 헤더 팝오버에 `↩`로 표시(통신 성공 여부 즉시 확인용).

## 9. 남은 작업 (TODO)
- [x] BJ 권한 계정으로 통화 콘솔 **실연결 e2e** 테스트 — 2026-06-10 완료 (Chrome 2탭 실 WebRTC: 모드/영상푸시/제어전환/TCode/결제/풀복귀/재연결 전부 통과. 상세는 PROJECT_STATUS.md §6)
- [ ] (옛 데모) 수익 시뮬레이터+합법성+로드맵+CTA / 데모 폰 재배포 — task #11·#12
- [ ] (운영 전) CSP nonce, 실 결제 PG 연동
- [x] **(보안) 다중 에이전트 리뷰 → 핵심 수정·검증** — 2026-06-10. 소켓 세션 인증, 결제 서버 권위화(active_sessions), 채팅 XSS 차단, prod 시크릿 강제, 신고/문의 위조 방어. 상세 PROJECT_STATUS.md §6-1
- [x] **(보안) CSRF 실제 배선** — 2026-06-10 완료. cookie-parser + middleware/csrf.js(csrf-csrf v3, generateToken), 전 폼에 `_csrf` hidden, fetch는 `x-csrf-token` 헤더(메타에서), 멀티파트 업로드는 multer 후 검증. 검증: 토큰없는 POST→403, 폼/fetch 정상. 스모크 46/46
- [x] **(버그) 공개라이브 채팅 시청자 미수신** — viewer-join에 `socket.join('broadcast-N')` 추가. 검증: 시청자 수신 OK
- [x] **(배포) 위 전부 폰(5501) 반영·검증** — 2026-06-10. 외부 https://syncra.uk health 200·CSRF 403 확인. cookie-parser는 폰에 npm install됨
- [ ] (틀만 만듦) 실 성인인증·실 PG — `server/services/{age_verification,payment_gateway}.js` 스텁 + config `ageVerification.provider`/`pg.provider`(기본 none). 운영 시 공급자 연동 + auth.js/mypage.js 경유 교체

⚠ **폰 재기동은 `~/pulse/restart_pulse.sh` 사용** — SSH 명령에 직접 `pkill -f 'server/app.js'`를 넣으면 그 문자열이 SSH 자기 명령줄과 매칭돼 세션이 죽음(exit 255). 스크립트로 분리하면 안전.
ℹ **`npm install --omit=optional`** — better-sqlite3가 프루닝되지만 Node 22+ 는
`node:sqlite` 내장으로 폴백하므로 지금은 치명적이지 않다.
**2026-08-18 확인: 이 PC(Node v24)에는 better-sqlite3가 아예 없고 `node:sqlite`로 정상 동작 중.**
과거 "PC는 better-sqlite3 필수" 안내는 Node 20 시절 것이라 더 이상 맞지 않는다.
성능이 필요하면 `npm install better-sqlite3 --no-save`.
cookie-parser=런타임 의존성, socket.io-client=devDependency.

## 10. WebRTC 데이터채널 프로토콜 (참고)
`MODE:call`/`MODE:video` · `VIDEO:<path>|<fs>` · `CTRL:script`/`CTRL:manual` · `L0xxIyyy`(TCode)
TCode V3: L0=stroke, R0=roll, R2=pitch / funscript: `{actions:[{at,pos}]}`
