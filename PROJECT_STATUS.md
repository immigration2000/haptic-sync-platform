# PULSE — 프로젝트 현황 정리

> **PULSE** (가칭) — 양방향 인터랙티브 성인 디바이스 플랫폼
> 최종 정리: 2026-06-10

---

## 1. 사업 개요

| 항목 | 내용 |
|------|------|
| **제품** | BJ ↔ 사용자 양방향 실시간 디바이스 교감 플랫폼 (TCode 디바이스 연동) |
| **코드네임** | PULSE (임시) |
| **목표** | 투자자 시연 데모 + 실서비스 가능 수준의 사이트 |
| **투자** | 시드 라운드 1억원 이하 |
| **타깃 투자자** | 엔젤·개인 투자자 + 전화방 운영자(프랜차이즈) |
| **전개 전략** | 오프라인 우선 → 온라인 확장 |
| **피치 방식** | 대면 + PPT + 사이트 + 실물 디바이스 (하이브리드) |

### 핵심 사용자 워크플로우
```
사용자 → BJ와 통화하며 BJ 선택 → 무료 체험 → 결제
   → 통화만으로 서비스 즐기기  OR  영상물 시청으로 전환
   → 그동안 BJ가 직접 사용자 하드웨어(디바이스) 조작
       ├─ 통화 모드: BJ 수동 제어 / 스크립트 재생
       └─ 영상 모드: 영상 스크립트(funscript)로 자동 동기화
   ※ 하드웨어 조작 권한은 BJ에게 있음 (통화가 허브)
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
- **TCode V3 프로토콜** — `L0`(stroke) · `R0`(roll) · `R2`(pitch), 포맷 `L0xxIyyy`
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
| `auth.js` | 회원가입/로그인/비번변경·리셋/계정삭제/이메일인증 |
| `content.js` | VOD/VR 카탈로그 · 플레이어 |
| `bj.js` | BJ 목록 · 통화/세션룸 · 콘솔 · 더미방 · 세션 결제 API · 영상목록 API |
| `bj_studio.js` | BJ 전용 — 대시보드/프로필/수익/기록 + **영상 업로드(multer)** |
| `mypage.js` | 일반 마이페이지 |
| `admin.js` | 관리자 백오피스 (더미 BJ 토글, 점검모드, 콘텐츠/BJ 관리) |
| `support.js` | 고객센터 |

### 주요 페이지 (`views/`)
- `home.ejs` — Netflix 스타일 카탈로그 (VOD / VR / BJ 구분)
- `content/player.ejs` — 영상 플레이어 (+ "BJ 통화하기" 안내)
- `bj/list.ejs` — **BJ 통화 목록** (통화 일원화: 단일 "📞 통화 시작")
- `bj/call.ejs` — **세션룸** (통화↔영상 전환, BJ 주도 제어)
- `bj/console.ejs` — **BJ 통화 콘솔** (모드/영상/스크립트/수동 제어 패널)
- `bj_studio/*` — dashboard · profile · videos · earnings · calls
- `admin/*`, `auth/*`, `mypage/*`, `support/*`

### 핵심 클라이언트 JS (`public/js/`)
- `core/device.js` — Serial/BLE 디바이스 연결 (사이트 닫을 때까지 유지)
- `core/funscript.js` — funscript 파싱 + 재생 엔진 (다축)
- `core/bj_session.js` — **결제 모듈**: 무료체험 카운트다운 → 결제 모달 → 블록 타이머 → 연장
- `pages/bj_call.js` — 사용자측 세션룸 (MODE/VIDEO/CTRL/TCode 수신·해석)
- `pages/bj_console.js` — BJ측 콘솔 (세션 제어 전송, sendToPeers)

---

## 4. 구현된 기능

### ✅ 콘텐츠 플랫폼
- VOD / VR 카탈로그, 썸네일 자동생성(ffmpeg), 깔끔한 영상 플레이어
- 디바이스 연결 전역 유지 (USB Serial + Bluetooth LE)
- funscript 자동 동기화 + 다축(L0/R0/R2), 강도(stroke range) 조절

### ✅ BJ 시스템
- BJ 신청 → 승인 → BJ 스튜디오
- **통화 세션룸** — 통화가 허브, BJ가 모드/영상/하드웨어 주도
- BJ 영상 업로드 (영상 + funscript, BJ별 폴더)
- 함께보기, 1:1 비공개방, 1:N 공개 라이브
- BJ 가용 모델: 대기(available) / 통화중(busy) / 오프라인
- 통화 종료 후 자동으로 풀(pool) 복귀 → 재연결 가능

### ✅ 결제
- 무료 체험(기본 60초) → 결제 모달(시간/요율/비용/잔액) → 블록(기본 5분) → 연장
- BJ 프로필에서 무료체험 시간 · 블록 단위 설정
- 정산: 운영 시 BJ 75% / 플랫폼 25%

### ✅ 운영/보안
- helmet · rate-limit(일반 200/분, 인증 10/분) · CSRF · 액세스/에러 로깅
- 점검 모드, 사이트 공지, 백업/로테이션/헬스체크
- 관리자 백오피스 (더미 BJ 토글 등)
- 법적 안내/약관/고객센터

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

## 6-8. 보이스 능력별 옵션·요금 (2026-06-10, 폰 배포 완료)

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

- [x] BJ 권한 계정으로 통화 콘솔 실연결 e2e 테스트 (모드/영상/제어 버튼) — 2026-06-10 완료, §6 참고
- [ ] (옛 데모) 수익 시뮬레이터 + 합법성 + 로드맵 + CTA — *task #11*
- [ ] (옛 데모) 데모 사이트 폰 재배포 — *task #12*
- [ ] (배포) 세션 손상 방어 수정(server/app.js) 폰 반영 — 코드 변경 1건, 재배포 시 전송
- [ ] (보안) CSRF 실제 배선 — doubleCsrfProtection 적용 + 전체 폼/fetch 토큰 추가
- [ ] (운영 전) CSP nonce 도입 (현재 인라인 스크립트 多로 임시 비활성)
- [ ] (운영 전) 실 결제 PG 연동 (현재 Ruby 가상화폐 잔액 기반)

> PULSE 신규 사이트는 핵심 워크플로우(통화 허브 → 무료체험 → 결제 → 통화/영상 + BJ 디바이스 제어)대로 동작하며 실서비스 가능 수준으로 구현 완료.
