# PULSE / Syncra — 프로젝트 현황 정리

> 양방향 인터랙티브 성인 디바이스 플랫폼
> 최종 정리: **2026-08-18** (§9에 2026-06~07 대규모 개편 상세)
> 서비스 주소: **https://syncra.uk** · 레포: `immigration2000/haptic-sync-platform` (private)

---

## 1. 사업 개요

| 항목 | 내용 |
|------|------|
| **제품** | 스트리머 ↔ 사용자 양방향 실시간 디바이스 교감 플랫폼 (TCode 디바이스 연동) |
| **코드네임** | PULSE (코드 내부) / **Syncra** (도메인·브랜드 후보, syncra.uk 보유) |
| **목표** | 투자자 시연 데모 + 실서비스 가능 수준의 사이트 |
| **투자** | 시드 라운드 1억원 이하 |
| **타깃 투자자** | 엔젤·개인 투자자 + 전화방 운영자(프랜차이즈) |
| **전개 전략** | 오프라인 우선 → 온라인 확장 |
| **핵심 차별 기술** | 여성기기 ↔ 남성기기 **원격 연동** (양방향 햅틱 동기화) |

### 서비스 3축 (2026-07 개편)
```
영상 ─┐
라이브 ├─ 커스텀 태그로 서로 연결 (같은 태그 어휘 공유 → 교차 유입)
피드 ─┘

영상   : 통합 카탈로그 + 좌측 필터(타입·이용방식·태그)
라이브 : 서비스 태그 4종 = 매체(음성/영상) × 대상(1:1/1:다수)
피드   : 스트리머 홍보 SNS — 구간 클립 → 전체영상 유입 동선
```

### 라이브 서비스 4종 (`server/service_types.js` = 단일 기준)
| 코드 | 서비스 | 과금 |
|---|---|---|
| `voice_1on1` | 1:1 음성통화 | 분당 (`rate_per_minute`) |
| `video_1on1` | 1:1 영상통화 (함께보기·비공개방 흡수) | 분당 (`rate_cam`, 0이면 기본요율) |
| `voice_multi` | 음성방송 (스푼형) | **입장 무료 + 후원** |
| `video_multi` | 영상방송 (인터넷방송형) | **입장 무료 + 후원** |

`device_control`(기기제어 제공 여부)은 4종과 **직교하는 별도 플래그**.

### 핵심 사용자 워크플로우
```
[1:1]  사용자 → 스트리머 선택 → 옵션(음성/영상) → 무료체험 → 분당 결제
         → 스트리머가 모드·영상·디바이스 주도 (통화가 허브)
[1:N]  입장 무료 → 시청 → 후원(별풍선형) → 스트리머가 시청자 기기 일괄 제어
[영상]  카탈로그 → 무료/PPV 구매/구독 → funscript 자동 동기화 재생
[피드]  스트리머 포스트(클립·사진) → "전체 영상 보기" → 구독/구매 전환
```

---

## 2. 기술 스택

### 백엔드
- **Node.js / Express / EJS** (express-ejs-layouts)
- **SQLite** — `better-sqlite3` (PC), `node:sqlite` 내장 어댑터 폴백 (폰 Node 26)
- **세션** — express-session + session-file-store
- **인증** — bcryptjs (네이티브 빌드 불가 환경 대응)
- **실시간** — socket.io + simple-peer (WebRTC)
- **보안/운영** — helmet, compression, morgan, express-rate-limit, csrf-csrf (double-submit)
- **업로드** — multer (순수 JS, 폰에서 동작)

### 디바이스 / 스크립트
- **TCode V3 프로토콜** — `L0`(stroke) · `R0`(roll) · `R1`(twist) · `R2`(pitch) · `L1`(surge) · `L2`(sway)
  - 와이어 포맷은 `L050I100` → **`L0500I0100`**. 위치는 "0.xx" 소수라 **우측패딩 3자리**(`50`→`500`=50%),
    보간 `I`는 ms 정수라 **좌측패딩 4자리 + 1~9999 클램프**. 구현 `public/js/core/device_drivers.js` → `normTok()`
  - ⚠ `padStart`를 쓰면 `50`→`050`이 돼 **50%가 5%로 나간다.** 시리얼 **baud 115200**(2026-07-28 실기기 검증)
- 지원 기기: OSR2 / SR6 / TempestMAX (TempestMAX/XTPlayer 계열)
- **funscript** — `{actions:[{at, pos}]}`
- **연결** — Web Serial API (USB) + Web Bluetooth API (Nordic UART Service)
- **다축** — L0/R0/R2 동시 재생
- UE(언리얼엔진) 스크립트 → funscript 변환 지원

### WebRTC 데이터 채널 프로토콜
| 메시지 | 의미 |
|--------|------|
| `MODE:call` / `MODE:video` | 통화 모드 ↔ 영상 모드 전환 (BJ 주도) |
| `VIDEO:<path>\|<fs>` | 영상 + funscript 경로 전달 |
| `CTRL:script` / `CTRL:manual` | 스크립트 자동재생 / BJ 수동제어 |
| `L0xxIyyy` | TCode 실시간 제어 명령 |

### 배포 / 인프라
- **A82 공기계 서버** — Termux + SSH (포트 8022), 하루 사용자 10명 이내
- **외부 노출** — cloudflared **named tunnel** → **https://syncra.uk**(고정·영구, 무제한 대역폭). 도메인 syncra.uk(Cloudflare Registrar). 터널 `syncra`(id 54a9f992…), config `~/.cloudflared/config.yml`, 재시작 `~/pulse/restart_named.sh`, 로그 `~/pulse/named.log`. ⚠ 폐기: trycloudflare(주소 가변)·ngrok(월 ~1GB 한계로 영상 부적합, ERR_NGROK_725).
- ffmpeg NVENC 영상 압축 (VOD 50GB→2.7GB, VR 9.3GB→960MB)

---

## 3. 사이트 구조

### 라우트 (`server/routes/`)
| 파일 | 역할 |
|------|------|
| `auth.js` | 회원가입/로그인(아이디 허용)/비번변경·리셋/계정삭제/이메일인증 |
| `content.js` | **통합 영상 카탈로그 + 필터** · 게스트 성인확인 · 플레이어 |
| `bj.js` | 스트리머 목록 · 세션룸 · 콘솔 · 더미방 · 세션결제 · **후원 API** · 영상 라이브러리/구독/PPV |
| `bj_studio.js` | 스트리머 전용 — 대시보드/프로필(서비스태그·요율)/수익(통화+후원)/기록 + 영상 업로드·**영상별 태그** |
| `feed.js` | **SNS 피드** — 포스트·구간클립·사진·좋아요·댓글·신고 |
| `mypage.js` | 일반 마이페이지 (충전·시청기록·스트리머 신청) |
| `admin.js` | 관리자 — 회원/심사/콘텐츠·**콘텐츠 태그**/**태그 관리**/신고/문의/더미방/설정·VR기본값 |
| `support.js` | 고객센터 (FAQ·디바이스 가이드·신고) |

### 서버 핵심 모듈 (`server/`)
| 파일 | 역할 |
|---|---|
| `service_types.js` | **서비스 4종 단일 기준** — 고정 enum, 구코드 변환, tier 정규화, 요율 매핑(`rateOf`) |
| `tags.js` | 커스텀 태그 엔진 — 운영모드 3종, 판정, 스트리머/영상 태그 제출, `CORE_BLOCK` |
| `content_filter.js` | 피드 텍스트 필터 — 외부링크·연락처·메신저 차단 (플랫폼 이탈 방지) |
| `storage.js` | **파일 저장소 추상화** — 로컬↔S3 전환 대비 (DB엔 논리 키만) |
| `access.js` | 영상 접근권한 — OWNER / SUBSCRIBED / PURCHASED |
| `vr_config.js` | VR 재투영 관리자 기본값 |
| `middleware/gate.js` | 사이트 출입 게이트 (Basic 인증) |
| `signaling/io_ref.js` | HTTP 라우트 → 소켓 룸 알림 (후원 알림을 서버만 발송) |

### 주요 페이지 (`views/`)
- `home.ejs` — Netflix 스타일 홈
- `content/catalog.ejs` — **통합 카탈로그 + 좌측 필터**, `content/age.ejs` — 게스트 성인확인
- `content/player.ejs` — 플레이어 (funscript 다축 + VR 재투영 ⚙조절)
- `feed/index.ejs` — **SNS 피드** (클립 슬라이더 편집·사진·태그 필터)
- `bj/list.ejs` · `bj/call.ejs` · `bj/console.ejs` · `bj/broadcast.ejs`(모드 선택) · `bj/watch.ejs`(후원)
- `bj_studio/*`, `admin/*`(+`tags.ejs`), `auth/*`, `mypage/*`, `support/*`

### 핵심 클라이언트 JS (`public/js/`)
- `core/device_drivers.js` — **드라이버 레지스트리** (기기별 프로토콜 분리)
- `core/device.js` — Serial/BLE 연결 유지 + 기기 응답 읽기
- `core/funscript.js` — funscript 파싱 + 다축 재생 엔진
- `core/bj_session.js` — 결제 모듈(무료체험→결제→연장)
- `core/header.js` — 헤더 디바이스 버튼 + **모바일 드로어**
- `pages/bj_call.js` · `bj_console.js` · `broadcast.js` · `watch.js` · `player.js` · `vr_reproject.js`

---

## 4. 구현된 기능 (현재 기준)

### ✅ 영상
- **통합 카탈로그** — 사이트 VOD/VR + 스트리머 업로드를 한 목록. 좌측 필터(타입·이용방식·태그), 같은 카테고리 OR / 카테고리끼리 AND
- **구독전용 영상도 썸네일·제목 정상 노출**, 재생만 잠금 + 구독 CTA (스트리머가 노출 on/off)
- **비로그인 열람 가능** — 기준은 로그인이 아닌 **성인 확인**(유입 장벽↓, 법적요건 충족)
- VR 평면 재투영(WebGL, 새 파일 없음) + 사용자 ⚙조절(localStorage)
- funscript 다축(L0/R0/R2) 자동 동기화 + 강도 조절, 시청위치 기록
- **영상별 개별 태그** (없으면 스트리머 태그 폴백)

### ✅ 라이브 (서비스 태그 4종)
- 1:1 음성/영상통화 — 대기풀 자동매칭, 무료체험→분당결제→연장, 스트리머가 모드·영상·기기 주도
- 1:N 음성/영상방송 — 입장 무료 + **후원**, 방송 모드는 서버가 서비스 태그로 검증
- 1:N **시청자 기기 일괄 제어**(`bcast-tcode`), 방송 채팅(XSS 차단)
- 음성방송은 카메라 미요청, 시청자에겐 아바타 화면 표시

### ✅ 피드 (SNS)
- 스트리머 게시 / 사용자 좋아요·댓글·신고
- **구간 지정 클립**(최대 60초, 슬라이더 편집) — 새 파일 0개, 인코딩 0
- 클립 소스: 내 영상 + 사이트 콘텐츠 / 하단 "전체 영상 보기" → 구독·구매 전환
- **사진 첨부**(8MB) · 태그 필터 · 외부 유인 차단

### ✅ 태그
- 커스텀 태그 마스터(의상/주제/분위기/컨셉/기타) — **영상·라이브·피드 공용**
- **운영 모드 3종**(승인제 / 자유입력+금지어 / 자유입력) 관리자 전환
- ⚠ 모든 모드에서 미성년·불법 암시 **항상 차단**(법적 안전장치, 끌 수 없음)

### ✅ 결제·수익
- 무료체험(기본 60초) → 블록(기본 5분) 분당결제 → 연장 — **서버 권위**(activeSessions)
- 스트리머별 **구독**(기간제) · 영상 **PPV** · 1:N **후원**
- 정산 75:25 (`platform_fee_pct` 설정)

### ✅ 하드웨어
- TCode V3 (L0/R0/R2), Web Serial + Web Bluetooth, **baud 115200**
- 와이어 포맷 정규화, 기기 응답 표시(진단), **드라이버 레지스트리**(신규 기기=드라이버만 추가)
- **실기기 동작 검증 완료** (2026-07-28)

### ✅ 운영/보안
- 사이트 출입 게이트 · CSRF · 소켓 세션 인증 · 결제 서버권위화 · XSS 차단
- rate-limit · helmet · 점검모드 · 공지 · 백업/로테이션
- 관리자 백오피스(태그·신고·콘텐츠·더미방·설정)
- **모바일 대응** — 햄버거 드로어 + 하단 탭바(영상/라이브/피드/마이)

---

## 5. 배포 환경

| 서비스 | 포트 | 외부 URL |
|--------|------|----------|
| **PULSE (신규 사이트)** | **5501** | https://syncra.uk |
| IWeb (옛 데모) | 5500 | (별도 터널) |

**폰 서버 기동 (Termux SSH):**
```bash
ssh -p 8022 u0_a870@192.168.219.108
cd ~/pulse
setsid env PORT=5501 BEHIND_PROXY=1 node server/app.js > data/logs/run.log 2>&1 < /dev/null &
```
> `setsid`로 완전 분리 — SSH 세션 종료돼도 서버 생존.
> `pkill -f 'server/app.js'` 로 중지 (IWeb의 `app.js`와 경로가 달라 안전).

---

## 6. 검증 결과

- **스모크 테스트** 45/45 통과 (2026-06-10 세션 수정 후 재실행 — 45/45 유지)
- **시그널링 통합 테스트** (socket.io-client) 4/4 통과 — ⚠ 실행 시 주의: 같은 서버에 실제 BJ 콘솔(userId 3)이 온라인이면 busy 테스트가 오염되어 WRONGLY_PAIRED로 실패함. 콘솔 끄고 실행할 것. socket.io-client는 devDep 아님 → `npm install --no-save socket.io-client`
- **외부 검증** (cloudflared): health 200, 홈/통화 일원화/플레이어/권한차단 정상
- **BJ 콘솔 실연결 e2e** (2026-06-10, Chrome 2탭 실 WebRTC — BJ=localhost / 사용자=127.0.0.1 쿠키 분리):
  - 매칭·P2P 데이터채널 연결, 초기 `L050I500` 수신 ✓
  - `MODE:video`/`MODE:call` 전환 → 사용자 뷰 전환 ✓
  - 영상 푸시(`VIDEO:` BJ 업로드 영상+funscript 경로 전달) ✓ (자동재생은 브라우저 정책으로 차단될 수 있음 — catch 처리됨, 실사용자 제스처에선 재생)
  - `CTRL:script`/`CTRL:manual` 전환 ✓ + **부정 테스트**: script 모드 중 TCode 무시 확인 ✓
  - TCode 수동 제어 (슬라이더 L0, 키보드 ↑/W → L0/R2) 송수신 ✓
  - 무료체험 60초 만료 → 결제 모달(750 Ruby = 5분×150) → 결제 → DB 차감·call_log 기록 ✓
  - 종료 → BJ 풀 복귀 → 재통화 매칭 ✓

---

## 6-1. 보안 강화 (2026-06-10 다중 에이전트 리뷰 → 수정·검증 완료)

리뷰에서 나온 30여 건 중 코드 검증으로 진짜만 추려 수정. (거짓양성 기각: node:sqlite lastInsertRowid 미지원·adjustCredits 경쟁조건·TCode 정규식·extendPrompted — 모두 실제로는 정상)

| 수정 | 내용 | 검증 |
|------|------|------|
| **소켓 세션 인증** | bj_signaling이 Express 세션 공유(`io.engine.use`+`io.use`), 클라 userId 무시·세션에서 신원. bj-online/broadcast-start에 role 검증, signal/bcast-signal은 페어 관계에만 릴레이 | 시그널링 4/4(쿠키 인증), e2e 매칭 OK |
| **결제 서버 권위화** | charge/info가 클라 bjUserId 무시, 시그널링이 기록한 활성 세션(`server/signaling/active_sessions.js`)으로만 금액 산정. 종료 시 세션 정리 | 저가 BJ(6) 바꿔치기 시도 → sophia(750)로 청구·기록 / 통화없이 결제 → 403 / 종료후 → 403 |
| **채팅 XSS 차단** | 서버가 sender를 세션 닉네임으로 강제+text 500자 제한, watch.js·broadcast.js 렌더를 innerHTML→textContent | sender 스푸핑('관리자'→'테스터') 차단, 악성 text가 data로만 전달 |
| **prod 시크릿 강제** | config.js: 운영에서 기본 시크릿이면 부팅 중단 | 로컬(dev) 정상 기동 |
| **신고/문의 위조 방어** | support.js /report 로그인 필수+target/reason 화이트리스트, /contact 로그인 시 본인 이메일 강제 | 스모크 45/45 |
| 사소 | 디바이스 전환 replaceTrack await, funscript 로드중 취소 가드, BJ 두탭 중복등록 방지 | — |

⚠ 부수: 소켓 인증 적용으로 `scripts/test_signaling.js`가 로그인 쿠키로 접속하도록 갱신됨. `socket.io-client`를 **devDependency로 추가**(폰 --production 미설치). PC는 better-sqlite3 필수(절대 `npm install --omit=optional` 금지 — better-sqlite3 프루닝됨).

미수정(별도 작업): CSP nonce, 실 성인인증, 실 PG.

## 6-2. CSRF 배선 + 공개라이브 채팅 버그 + 인증/PG 스켈레톤 (2026-06-10, 폰 배포 완료)

| 작업 | 내용 | 검증 |
|------|------|------|
| **CSRF 실제 배선** | cookie-parser 추가, `middleware/csrf.js`(csrf-csrf v3.2.2 — 함수명 `generateToken`, `req.cookies` 필요), 전 폼 24개에 `<input name=_csrf>`, layout에 `<meta name=csrf-token>`, fetch(charge·track-watch)는 `x-csrf-token` 헤더, 멀티파트 업로드는 글로벌 스킵 후 multer 뒤 `doubleCsrfProtection`. 세션 id 안정화 위해 익명도 1회 세션 생성 | 토큰없는 POST→403, 폼 로그인·fetch 결제 정상, 스모크 46/46, 외부 URL 403 |
| **공개라이브 채팅 버그** | viewer-join에서 `socket.join('broadcast-N')` 누락 → 시청자가 chat-msg 미수신이던 것 수정(+leave 정리) | 시청자가 방송자 채팅 수신 확인 |
| **성인인증·PG 스켈레톤** | `services/age_verification.js`·`services/payment_gateway.js` 스텁 + config `ageVerification.provider`/`pg.provider`(기본 none, 현행 동작 유지). 운영 시 연동 지점만 마련 | 모듈 로드 OK |

배포: 폰 5501 재기동·검증, 외부 https://syncra.uk 정상.
신규 런타임 의존성 **cookie-parser**(폰 설치 완료). 폰 재기동은 `~/pulse/restart_pulse.sh`(pkill 자기-종료 회피).

## 6-3. VR 평면 재투영 + VOD 통합 (2026-06-10, 폰 배포 완료)

> 관리자 기본값(설정 `vr_reproject` JSON, 기본 100/100/30/0) + 사용자 ⚙ 조절(localStorage). server/vr_config.js. 플레이어 ⚙ 버튼으로 확대/직선보정/상하·좌우 시점 조절, "기본값으로" 복귀. 폰 5501 배포·외부 서빙 검증. 스크립트 캐시버스트 ?v=7.

임시 VR 영상(실서비스 시 정식 콘텐츠로 교체 예정)을 VOD 카탈로그에 노출 + 시연/기술홍보용 평면 변환.

- **포맷 확인**: 임시 VR = 180° SBS(좌우 3D) + 등거리 어안. 2560×1280(2:1), 구형 메타 없음, IPPA 워터마크(=라이선스 콘텐츠 → 실서비스 전 교체 전제).
- **재투영**: `public/js/core/vr_reproject.js` — WebGL 프래그먼트 셰이더로 한쪽 눈 크롭 + 어안→직선투영(정면 ~100° FOV). **새 파일 없이** 기존 mp4를 텍스처로 사용. 원본 영상은 캔버스 뒤에서 재생(텍스처·오디오·funscript 타이밍 소스). WebGL 실패 시 원본+네이티브 컨트롤 폴백.
- **플레이어**: `views/content/player.ejs` — VR이면 캔버스+커스텀 컨트롤(재생/탐색/음소거/전체화면)+"🅥🆁 재투영" 라벨. VOD는 기존 네이티브 그대로(분기).
- **카탈로그**: `server/routes/content.js` `/vod`가 VR도 함께 나열, `list.ejs`에서 VOD 맥락의 VR은 "VR 재투영" 뱃지.
- **검증**: VOD 목록 13개(VOD8+VR5, VR5개 '재투영' 뱃지), 재투영 캔버스 렌더 OK(좌우중복 lr_diff 32.9→78.1로 SBS 이중화면 제거 확인), 컨트롤 동작, VOD 회귀 정상, 스모크 46/46.
- **튜닝 여지**: 어안 모델은 180° 등거리 가정, 출력 FOV 100°. 렌즈가 다르면 직선이 약간 휠 수 있음 → vr_reproject.js opts(hFovDeg/fisheyeFovDeg/eye)로 조정.
- 변경: public/js/core/vr_reproject.js(신규), public/js/pages/player.js, views/content/{player,list}.ejs, server/routes/content.js.

## 6-4. BJ 구독(OnlyFans형) + 영상 PPV + 통화 2단계 요율 (2026-06-10, 폰 배포 완료)

사용자 결정: 기간제 구독 **+** 영상별 PPV 둘 다 / 구독자 자유열람 + 비구독자 개별구매 병행 / 통화 2단계 분당요율.

- **스키마**: bj_profiles에 `rate_with_video`(통화+영상 요율)·`sub_price`·`sub_days` 추가, bj_videos에 `price`(PPV) 추가. 신규 테이블 `bj_subscriptions`(기간제), `video_purchases`(PPV 영구). 기존 DB는 addColumnIfMissing/CREATE IF NOT EXISTS로 자동 마이그레이션.
- **접근제어**: `server/access.js` videoAccess(소유자/활성구독자/구매자 → 허용, 그 외 price>0이면 구매·구독 필요, price==0이면 구독전용).
- **라우트(bj.js)**: `/:bjId/library`(영상 라이브러리·잠금표시), `/:bjId/subscribe`(Ruby 구독·연장), `/vid/:videoId`(접근게이트 시청, content/player 재사용), `/vid/:videoId/purchase`(PPV). `views/bj/library.ejs`.
- **통화 2단계 요율**: bj_call.js가 선택한 tier('call'|'video')를 user-call로 전달 → signaling이 activeSessions에 tier 저장 → session/info·charge가 서버 권위로 tierRate 산정(영상=rate_with_video). call.ejs에 옵션 선택 UI.
- **스튜디오 확장**: profile.ejs에 통화+영상 요율·구독가·구독기간, videos.ejs에 업로드 PPV가 + 영상별 가격 변경.
- **검증**: 라이브러리 잠금/구매/구독 흐름 e2e(72000→71200 정확 차감), 통화 tier video=250·call=150, 스모크 46/46, 시그널링 4/4. 폰 배포·마이그레이션·외부 라우트 확인.
- 한계(운영 전 처리):
  1. **유료영상 원본 URL 정적서빙 우회** — `/vid/:id`(시청 페이지)는 게이트하지만 `video_path`(`/content/bj/...`)는 express.static으로 직접 접근 가능 → 비구독자가 URL만 알면 다운로드. 운영 시 인증 스트리밍 라우트(서명 URL/range 프록시)로 교체 필요. (현 콘텐츠가 임시 자산이라 데모 수준에선 허용)
  2. 구독/PPV 수익이 BJ earnings(call_logs 기준)에 미반영 — 정산 연동 필요.
  3. 실 PG/성인인증은 스텁(맨 나중).

## 6-5. 용어·구조 정리 (2026-06-10, 폰 배포 완료)

사용자 결정 반영:
- **용어**: 화면 노출 'BJ' → '스트리머' 전면 교체(뷰 30개). JS 식별자(`__BJ_CALL__`·`__BJ_CONSOLE__`·`/^BJ-?/`·`handleBJData`·`startBJCamera`)·라우트(`/bj`)·코드(bj_*)는 그대로. seed/DB 활동명 'BJ-소피아'→'소피아'(접두 제거).
- **라이브 2분할**: 헤더 메뉴 `1:1`(=/bj, 음성+디바이스 기반) / `🔴 인터넷 방송`(=/bj/live-lobby, 1:N). 
- **1:1 모델**: 음성+디바이스가 상수, 화면은 영상/캠 토글(스트리머가 세션 중 결정). 요금 2단계 — `기본`(음성+디바이스, rate_per_minute) / `프리미엄`(영상·캠, rate_with_video). call.ejs 옵션 라벨·스튜디오 프로필 '프리미엄 옵션(영상·캠)'로 정리.
- 검증: 주요 페이지 렌더 200, 헤더 1:1/인터넷방송 노출, 기본/프리미엄 라벨, 외부 URL에 구 'BJ' 잔존 0. 스모크 44/46(2건은 auth 레이트리밋 아티팩트 — 콘솔 실제 렌더 200 확인).
- **남은 것**: 1:1 세션 중 **캠 토글이 표준 통화 콘솔에 아직 미배선**(영상=MODE:video 동작, 캠은 별도 live-priv 플로우로만 존재). 프리미엄=영상·캠 모델을 완성하려면 콘솔에 캠 모드 토글 추가 필요(다음 작업). services 체크박스(call/cowatch/live-priv/broadcast)도 1:1/방송 2개로 단순화 여지.

## 6-6. 내비 통합 + 탭 명명 (2026-06-10, 폰 배포 완료)

- **탭 통합**: VOD·VR 메뉴 2개 → `영상` 하나. 영상 허브(/content/vod)가 플랫폼 VOD+VR(평면 재투영 포함) + **스트리머 라이브러리 섹션**(업로드 영상 있는 스트리머, 구독가/편수 배지)을 함께 노출. stmt `listStreamerLibraries`, content.js가 libraries 전달, list.ejs에 섹션 추가.
- **탭 명명**: `1:1` → **보이스**(목소리 기반 1:1), `인터넷 방송` → **🔴 라이브**. 요금제·스튜디오 유지. 보이스 목록 페이지 헤더·버튼도 '보이스'로.
- 헤더 메뉴 최종: 영상 · 보이스 · 🔴 라이브 · 요금제 · (스튜디오/관리자 역할별).
- 검증: 영상 허브 라이브러리 섹션 렌더(소피아 2편), 새 탭 노출, 구 탭 네비 제거, 스모크 46/46. 외부 배포 확인.
- 참고: 홈(home.ejs) 랜딩의 VOD/VR 쇼케이스 행은 네비와 별개라 그대로 — 필요 시 영상 허브로 합치기 가능.

## 6-7. 라이브(공개방송) 디바이스 제어 1:N (2026-06-10, 폰 배포 완료)

스트리머가 공개 방송 중 시청자 전원의 디바이스를 동시 제어.
- **시그널링**: `bcast-tcode` 이벤트 — 방송 중 소켓(`socket.broadcasterUserId` 보유)만 송신 가능, `socket.to('broadcast-N')`로 방 시청자에게만 중계(발신자 제외). cmd 64자 제한.
- **방송자(broadcast.ejs/js)**: 디바이스 제어 패널(L0/R0/R2 슬라이더 + 보간 + 방향키/W·S) → `bcast-tcode` 송신. 송출 시작 시 활성화, 중지 시 비활성.
- **시청자(watch.ejs/js)**: `bcast-tcode` 수신 → `PulseDevice.send`(연결 시), 디바이스 패널에 상태·수신 cmd 카운트. device.js는 layout 전역 로드라 별도 불필요.
- **보안 검증**: 방송자→시청자 중계 OK, 시청자의 bcast-tcode 주입은 무시(방송자 아님). 노드 테스트 통과.
- 무료(시청 무료·후원 모델 유지). 확장 여지: funscript 자동재생 브로드캐스트, 유료 제어 티어, 시청자별 강도 조절.
- **2026-06-10 버그 수정(재현)**: ① 송출 시작이 카메라 필수라 카메라 없으면 디바이스 제어가 통째로 안 켜지던 것 → 카메라 실패 시 음성만/미디어 없이(디바이스 전용)도 송출되게 폴백. ② 방송 페이지에서 스트리머 본인 하드웨어 연결이 방송과 무관하던 것 → sendTcode가 시청자 전송 + 본인 PulseDevice에도 같이 재생(미리보기), 본인 디바이스 상태 표시. 데이터 전송 자체는 정상이었음(슬라이더→시청자 수신 검증됨). broadcast.js/watch.js ?v=2 캐시버스트.

## 6-8. ~~보이스 능력별 옵션·요금~~ (2026-06-10) — ⚠ **폐기됨**

> **이 절은 더 이상 유효하지 않다.** 아래의 '능력 3종(통화/모니터링/캠)' 모델은
> **§9의 서비스 태그 4종 체계로 대체**됐고, `rate_with_video`(모니터링)는 `rate_cam`으로
> 흡수·마이그레이션됐다(`server/db/index.js`). 스튜디오에서도 더 이상 입력받지 않는다.
> **요금 로직은 `server/service_types.js`(단일 기준)를 볼 것.**
> 아래 원문은 이력 참고용으로만 남긴다.


스트리머가 보이스에서 제공하는 능력을 켜고 각각 가격 설정 → 사용자가 골라 그 요율로 진행.
- **능력 3종**: `통화`(음성+디바이스, rate_per_minute, 항상) / `모니터링`(영상 시청+제어, rate_with_video, 0=미제공) / `캠`(1:1 화상, **rate_cam 신규**, 0=미제공). 스키마+마이그레이션, listBJs에 요율 추가.
- **요율 산정**: tierRate(bj, tier) — cam→rate_cam, video(모니터링)→rate_with_video, else rate_per_minute. 세션 tier 'call'|'video'|'cam'(signaling doMatch·activeSessions). session/info·charge 서버 권위.
- **스튜디오 프로필**: '보이스 제공 옵션(능력별 요금)' — 모니터링·캠 분당요율 입력(0=미제공). bj_studio POST rate_cam 처리.
- **보이스 진입(call.ejs)**: 제공되는 옵션만 가격과 함께 라디오 노출(통화 항상, 모니터링/캠은 요율>0일 때). bj_call.js가 선택 tier를 user-call로 전달.
- **카드 태그(list.ejs)**: 📞통화 / 🎬모니터링 / 📷캠 능력 배지.
- **검증**: 통화150·모니터링250·캠350 요율 산정(로컬·외부), 옵션·태그 렌더 확인. 폰 마이그레이션·소피아 데모 세팅 완료.
- 참고: 스튜디오 '제공 서비스' 체크박스(call/cowatch/live-priv/broadcast)는 능력요율과 일부 중복 — 추후 단순화 여지.

## 6-9. 하드웨어 드라이버 모듈화 (2026-06-10, 폰 배포 완료)

여성용 등 신규 기기 추가 시 드라이버 1개만 손대면 되도록 입출력 분리.
- **`public/js/core/device_drivers.js`(신규)**: 드라이버 레지스트리(`window.PulseDrivers` — register/list/get/active/setActive). 기본 드라이버 `tcode_v3`(OSR2·SR6·PULSE) 등록. 드라이버 형태: `{id,name,serialBaud,ble:{service,txChar,write},init[],stop,idle,encode(cmd)→Uint8Array}`. 여성용 기기 예시 드라이버를 주석으로 포함(encode에서 캐노니컬 TCode→기기 프로토콜 매핑 자리).
- **캐노니컬 명령 = TCode 문자열**(앱 전체가 생성). 드라이버 `encode()`가 기기 바이트로 변환 → TCode 호환은 통과, 타 기기는 변환. 그래서 **앱 나머지(funscript·콘솔·통화·방송) 무수정**.
- **device.js 리팩터**: serialBaud·BLE UUID·init/stop/idle·encode·BLE write방식을 `drv()`(활성 드라이버)에서 가져옴. PulseDrivers 미로드 시 TCode V3 폴백 내장.
- **검증**: tcode_v3 encode('L050I500')→'L050I500\n'(호환), 가상 여성용 드라이버 register+setActive 시 같은 명령이 'V:51'로 변환됨(출력만 바뀜). 스모크 46/46. layout에 `?v` 캐시버스트.
- **나중에 할 일**: 여성용 기기 출시 시 device_drivers.js의 주석 예시를 채워 register + (기본으로 쓰려면) setActive. 사용자가 기기 종류를 고르게 하려면 헤더 디바이스 팝오버에 드라이버 선택 UI 추가.

## 6-10. 영상 페이지 4탭 분리 (2026-06-10, 폰 배포 완료)

영상 허브를 탭으로 분리(서버 렌더 라우트 + 공통 탭바 `content/_tabs.ejs`):
- **VOD**(`/content/vod`) — 플랫폼 vod, **VR**(`/content/vr`) — 플랫폼 vr(평면 재투영). VOD+VR 다시 분리(이전 통합 되돌림).
- **구독자전용 영상**(`/content/videos`) — 전체 스트리머 업로드 영상 플랫 그리드, 스트리머명 + 접근상태(시청/구매/구독전용 잠금). stmt `listAllBJVideos`, content/videos.ejs.
- **스트리머 채널**(`/content/streamers`) — 라이브러리 보유 스트리머 채널 카드. content/streamers.ejs.
- 헤더 '영상' → /content/vod(첫 탭), `path.startsWith('/content')`로 활성. 검증: 4탭 200·탭바·접근상태 렌더, 스모크 46/46, 외부 확인.

## 6-11. 콘텐츠 온보딩 파이프라인 + 용량 가드 (2026-08-26, 폰 배포 완료)

콘텐츠를 가진 외부 작업자에게 **관리자 계정을 주지 않고** 업로드만 맡기기 위해 만들었다.

- **계정 발급** — `server/services/account_provision.js` 하나를 CLI(`scripts/make_streamer.js`)와
  관리자 UI(`/admin/streamers`)가 **공유**한다. 양쪽에 따로 구현하면 정책이 조용히 갈라진다.
  `role='bj'` 고정 — admin을 주면 `requireRole`이 모든 역할 검사를 통과시켜
  회원목록·거래내역·점검모드까지 열린다. 기존 admin 계정은 강등 거부.
  비밀번호는 발급 화면에만 1회 표시 + 복사 버튼.
- **업로드 편의** — 다중 선택, 영상과 **같은 이름의 스크립트 자동 매칭**, 제목 자동채움,
  브라우저 canvas 썸네일 추출(폰에 ffmpeg이 없다).
- **용량 가드** — `server/disk_guard.js`. multer는 받으면서 디스크에 쓰므로
  **다 받은 뒤 거부하면 이미 늦다** → `Content-Length`로 사전 차단하는 미들웨어를 multer 앞에 세운다.
  설정 `upload_max_file_mb`(800) / `upload_quota_user_gb`(10) / `upload_min_free_gb`(5).
  폰이 차면 업로드만 실패하는 게 아니라 **SQLite 쓰기가 깨져 세션·결제·시청기록이 무너지고**
  같은 폰의 다른 프로젝트(릴레이·터널)까지 영향을 받는다.
- **카탈로그 승격** — `/admin/contents/promote`로 업로드분을 공개 카탈로그로 올린다.
- **구독 진입로** — 영상 상세에 구독하기 버튼 추가. 관리자가 구독가·기간을 직접 정한다.
  ⚠ 가격 0으로 올린 영상은 **구독가가 없으면 소유자 외에 아무도 볼 수 없다** — 목록에 경고 표시.

검증: 계정발급→업로드→승격→시청 e2e 14항목. 스모크 통과.
⚠ 남은 것: **기존 업로드분은 `thumb_key`가 없어 썸네일이 비어 있다.**

## 6-12. 스트리머 프로필 재편 — 라이브 미제공 허용 (2026-08-26, 폰 배포 완료)

**SSOT 변경** — `server/service_types.js`의 `normalizeList`가 **빈 배열을 허용**한다.
전에는 서비스 최소 1개를 강제해서, 업로드만 하는 계정도 통화 목록에 뜨고 분당요금 검사에 걸렸다.
소비쪽 6곳을 함께 고쳤다. **이 규칙을 되돌리면 업로드 전용 계정이 전부 깨진다.**

UI: 업로드 전용 마스터 스위치를 맨 위에 두고, 서비스별 옵션은 토글 + 펼침 설정으로 정리.

## 6-13. 스트로크 제어 시스템 + mosa식 전송 (2026-08-26, 폰 배포 완료)

스크립트 진폭이 좋은 기기에 비해 짧은 문제 → 사용자가 **이동 한계와 증폭률**을 직접 정한다.

**공식 (`public/js/core/funscript.js` → `shapeStroke`)** — 단일 진실원.

```
out = clamp(outMin, outMax,  center + (pos - srcCenter) * (1 + gain))
      center    = (outMin + outMax) / 2          ← 최소·최대가 중심을 정한다
      srcCenter = 스크립트 자체 중앙                ← 고정값 50이 아니다
      gain      = -0.8 ~ +0.8 (기본 0 = ×1)
```

- ⚠ **시간(`interp`)은 절대 건드리지 않는다.** T-Code는 위치 기반이라 증폭 = 좌표 변환이다.
  이동시간을 늘리는 순간 기능의 정의가 훼손된다. 빨라지는 건 증폭의 **결과지 부작용이 아니다.**
- `srcCenter`를 고정값 `50`으로 두면 치우친 스크립트(30~50)에서 증폭이 **한쪽으로만** 늘어난다.
- 관리자가 강도 범위를 정한다 — 설정 `stroke_gain_min` / `stroke_gain_max`,
  `layout.ejs`가 `window.PULSE_TUNING`으로 내려준다.
- 미리보기 UI는 공식을 **재구현하지 않고** `FSx.shapeStroke`를 그대로 부른다(두 번 구현하면 갈라진다).
- UI는 커스텀 세로 이중손잡이 슬라이더(`.v-range` / `.v-thumb`, `pages.css`).
  손잡이가 `margin -9px`로 트랙 끝에서 삐져나오므로 위아래 글자와 **14px** 이상 띄워야 겹치지 않는다.

**전송 계층 (`public/js/core/device.js`)** — 참고 구현 `tnxa/mosa` 방식으로 바꿨다.

- `writer.write()`에 **`await`을 걸지 않는다.** 쓰기 한 번이 지연되면 Web Streams 백압으로
  큐 전체가 멈추고, 그걸 연결 실패로 오판해 끊어버렸던 것이 리모컨 문제의 유력 원인이다.
- 타임아웃/fail-closed를 쓰기 경로에서 제거. `bounded()`는 **종료 경로에서만** 쓴다.
- 축별 **최신 키프레임만** 보낸다 — 화면이 가려졌다 돌아오면 rAF가 재개되면서
  밀렸던 토큰이 한꺼번에 터져 나가던 문제(40개 폭주)를 막는다.
- rAF는 페이지가 그려지지 않으면 멈춘다 → `setInterval(40ms)` 병행 + `visibilitychange`에 `resync()`.

⚠ **전송 계층 변경은 실기기 검증 전이다.** 끊김이 실제로 사라졌는지 확인되지 않았다.

## 7. 주요 트러블슈팅 기록

| 문제 | 해결 |
|------|------|
| 원격 MySQL ETIMEDOUT | 로컬 MySQL → DB-less(JSON) → SQLite |
| 폰 better-sqlite3/bcrypt 네이티브 빌드 실패 (Node 26, NDK 없음) | `node:sqlite` 어댑터 + bcryptjs |
| `pkill -f "node server/app"`가 SSH 세션까지 종료 | `'server/app.js'` 패턴 사용 |
| nohup이 SSH 종료 시 같이 죽음 | `setsid` 완전 분리 |
| 결제 팝업 항상 표시 + 확인버튼 무반응 | `.ps-modal-backdrop[hidden]{display:none!important}` |
| 재연결 시 오프라인 표시 | 시그널링 available/busy 모델 재작성 + 풀 복귀 |
| 업로드 http 000 (행) | Windows curl이 Git Bash `/tmp` 경로 못읽음 → 절대경로로 해결 (코드 정상) |
| **포트 충돌 EADDRINUSE :5500** | PULSE는 **5501**이 정답 (5500은 IWeb) |
| 손상 세션 파일(깨진 JSON 또는 cookie 필드 누락) → 해당 쿠키 사용자 500 | app.js에 세션 store get 래퍼 추가 — 손상 세션은 새 세션으로 대체 (2026-06-10) |
| CSRF가 "적용"으로 기재됐으나 실제 `app.use(doubleCsrfProtection)` 누락 | 2026-06-10 배선 완료 (cookie-parser + csrf-csrf v3 generateToken, 전 폼 _csrf, fetch는 헤더, 멀티파트는 multer 후) |
| CSRF _csrf 일괄삽입 정규식이 `<%= %>`(action 내) 폼에서 `%>`의 `>`를 태그 끝으로 오인 → hidden input이 태그 중간 삽입돼 폼 깨짐(403) | 2026-06-10 수정: bj_apps·dummy·reports·videos·reset 5폼 _csrf 위치 교정. (CSRF 배포 때부터 폰에도 깨진 채 나갔던 것 — 이번에 함께 배포) |

---

## 8. 남은 작업 (TODO)

- [x] 통화 콘솔 실연결 e2e (모드/영상/제어) — 2026-06-10, §6
- [x] CSRF 실제 배선 — 2026-06-10, §6-2
- [x] **하드웨어 실기기 동작 검증** — 2026-07-28 (하드웨어 담당 작업자 환경) — §9-2
- [x] 요금 필드·tier 정리 / 영상별 태그 — 2026-07-28, §9-11
- [ ] **1:N 방송 실연결 e2e** — 브라우저 탭 3개(방송자+시청자2)로 영상/음성방송·후원알림·기기제어 검증
      ※ **AWS와 무관** — WebRTC P2P mesh라 현 환경에서 검증 가능. AWS/SFU는 시청자 다수일 때 필요
- [ ] (운영 전) CSP nonce 도입 — 인라인 스크립트 多로 현재 비활성
- [ ] (운영 전) 실 성인인증·실 PG 연동 — `services/{age_verification,payment_gateway}.js` 스텁 존재,
      config `provider` 플래그만 바꾸면 붙는 구조. **별도 모듈로 구현 후 연결** 방침
- [ ] (확장) AWS 이전 — S3/CloudFront. `storage.js` 추상화 완료로 DB 수정 없이 전환 가능(§9-10).
      영상은 **서명 URL** 필요(구독전용 보호), 업로드는 presigned 직업로드 권장
- [ ] **스트로크/전송 실기기 검증** — mosa식 전송(§6-13)으로 끊김이 사라지는지. **최우선**
- [ ] 축 매핑 `R0`/`R1` 확정 — 코드는 `.roll`→R0 / `.twist`→R1, AI_NOTES `TCODE_GUIDE.md`는 반대로 적혀 있다. 실기기 필요
- [ ] 기존 업로드분 `thumb_key` 백필 — 썸네일이 빈 상태(§6-11)
- [ ] (옛 데모) 수익 시뮬레이터·합법성·로드맵·CTA / 데모 폰 재배포 — task #11·#12

> 3축(영상·라이브·피드) 구조 개편 완료. 핵심 워크플로우 전부 동작하며 실서비스 가능 수준.
> 운영 전 필수 잔여: CSP nonce · 실 성인인증 · 실 PG.

---

## 9. 2026-06~07 대규모 개편 (전체 기록)

> 서비스 구조를 **3축(영상·라이브·피드)** 으로 재편하고, 인프라를 고정 도메인으로 옮긴 기간.
> 모든 항목 폰(5501) 배포·검증 완료. 커밋은 `haptic-sync-platform` 레포 참조.

### 9-1. 인프라 — 고정 도메인 전환
- **cloudflared named tunnel → https://syncra.uk** (도메인 Cloudflare Registrar 등록)
- 터널 `syncra`(id `54a9f992-…`), 설정 `~/.cloudflared/config.yml`, 재시작 `~/pulse/restart_named.sh`
- **폐기**: trycloudflare(주소 매번 변경) · ngrok(무료 월 ~1GB 대역폭 → 영상에서 ERR_NGROK_725)
- 안드로이드 절전으로 서버가 죽던 문제 → `termux-wake-lock` + 배터리 설정 + 충전 연결

### 9-2. 하드웨어 — 동작 불능 원인 규명·수정 (검증 완료)
작동하는 레퍼런스 구현(TCode 웹 플레이어) 번들을 실측 대조해 원인 확정:
| 항목 | 우리(고장) | 레퍼런스 | 조치 |
|---|---|---|---|
| 시리얼 baud | **9600** | **115200** | 수정 — 🔴 근본 원인 |
| 위치 자릿수 | `L050`(2) | `L0500`(3) | 우측 패딩 정규화 |
| 보간 | `I100`, 상한 없음 | `I0100`, 1~9999 | 좌측 패딩 + 클램프 |
| 기기 응답 읽기 | 없음 | 있음 | 추가(진단용) |
> baud가 틀리면 **포트는 열려서 "연결됨"으로 보이지만** 기기가 명령을 해석 못 함 → 무반응.
> **2026-07-28 실기기 검증 완료.**

### 9-3. 접근 통제 — 출입 게이트 + 마스터 계정
- `middleware/gate.js` — 사이트 전체 앞단 Basic 인증(`data/gate.json`, watchFile로 5초 내 자동반영)
- 마스터 계정 `1111/2222` (role=admin → 모든 권한 통과 + 스트리머 프로필)
- 게이트 계정도 `1111/2222`로 통일

### 9-4. 모바일 대응
- 좁은 화면에서 **네비가 사라지고 대체 수단이 없던 문제** 해결
- 햄버거 드로어 + 하단 탭바(영상/라이브/피드/마이), 헤더 압축, 디바이스 연결을 드로어로

### 9-5. 서비스 태그 4종 (1단계)
- `service_types.js` = 단일 기준. **고정 enum**(자유입력 불가 — 런타임 동작을 결정하므로)
- 구 체계(`services` call/cowatch/live-priv/broadcast + `tier` call/video/cam) 이중구조 해소
- 함께보기·비공개방 → **1:1 영상통화의 기능으로 흡수**
- 보이스 탭 삭제 → 네비 **영상/라이브** 2축

### 9-6. 커스텀 태그 + 운영 모드 3종 (2단계)
- `tags` 마스터 + `bj_tags` 연결, 관리자 `/admin/tags`
- 모드: **승인제 / 자유입력+금지어 / 자유입력** — 운영하며 전환 가능
- ⚠ `CORE_BLOCK`(미성년·불법 암시)은 **모드 무관 항상 차단** — 법적 요구사항이라 끌 수 없게 설계

### 9-7. 통합 영상 카탈로그 (3단계)
- 탭 4개 분리 → **단일 카탈로그 + 좌측 필터**(타입·이용방식·태그)
- 구독전용 영상 **썸네일 노출 + 재생 잠금**(노출이 곧 구독 전환 경로)
- 게스트 성인확인 게이트 — 회원가입 없이 열람 가능

### 9-8. 후원 시스템 (4단계)
- 1:N 수익 모델. 서버 권위 결제 + `platform_fee_pct`(기본 25%)
- **후원 알림은 결제 확정 후 서버가 직접 발송**(`io_ref.js`) — 클라이언트가 소켓으로
  "후원했다"고 주장하는 경로를 두면 무료 위조가 가능하므로 아예 만들지 않음
- 차단 검증: 금액범위·자기후원·없는 스트리머·잔액초과·CSRF 없음(403)

### 9-9. 음성 방송 (5단계)
- 방송 모드(voice/video)를 **서버가 서비스 태그로 검증** — 안 파는 모드로 방송 불가
- 음성 모드는 카메라 미요청, 시청자에겐 아바타 안내 화면

### 9-10. SNS 피드 + 저장소 추상화
- 스트리머 게시 / 사용자 좋아요·댓글·신고 (C안)
- **구간 지정 클립** — 새 파일 0개·인코딩 0 (VR 재투영과 같은 접근)
- 사진 업로드 + `storage.js` — **DB엔 논리 키만**(`feed/3/x.png`), URL은 `publicUrl()`이 생성
  → `STORAGE_DRIVER`·`CDN_BASE_URL`만 바꾸면 **DB 수정 없이 S3 전환**
- `content_filter.js` — 외부링크·연락처·메신저 차단(플랫폼 이탈 방지)
- ⚠ 발견·수정한 버그 2건:
  1. **한글에 `\b`(단어경계) 미동작** → '텔레그램'·'카톡'이 필터를 통과하던 것 수정
  2. **업로드 디스크 채우기** — multer가 CSRF 검증 전에 파일을 쓰므로 403이어도 파일이 남음
     → 응답이 4xx/5xx면 파일을 되돌리는 미들웨어 추가

### 9-11. 요금·태그 정리 (2026-07-28)
- tier를 서비스 코드로 통일, 요율 매핑 `service_types.rateOf()` 일원화
- `rate_with_video`(옛 모니터링) → `video_1on1` 흡수, 값은 `rate_cam`으로 마이그레이션(컬럼 보존)
- **영상별 개별 태그** `video_tags(source, video_id, tag_id)` — 스튜디오·관리자에서 편집,
  카탈로그는 영상 태그 우선·없으면 스트리머 태그 폴백

### 9-12. 샘플 데이터
- `scripts/seed_samples.js`(멱등) / `scripts/clear_samples.js`
- 태그 16종·서비스 배분·더미방 활성화·피드 포스트 6건·좋아요·댓글
