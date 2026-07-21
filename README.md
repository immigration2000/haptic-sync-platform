# PULSE

양방향 실시간 인터랙티브 콘텐츠 플랫폼.

## 빠른 시작

```bash
npm install
npm run seed     # SQLite 초기 데이터 (회원·BJ·콘텐츠)
npm start        # 기본 5500 포트 (PORT=5501 처럼 변경 가능)
```

http://localhost:5500

**테스트 계정**:
- 사용자: `test@pulse.dev` / `1234` (50,000 Ruby 보유)
- 관리자: `admin@pulse.dev` / `1234`
- BJ: `sophia@pulse.dev`, `aimee@pulse.dev`, `luna@pulse.dev`, `jenny@pulse.dev`, `aria@pulse.dev` 모두 `/1234`

## 폴더 구조

```
pulse/
├── server/
│   ├── app.js                Express + Socket.IO 부팅
│   ├── config.js             port, session secret
│   ├── db/
│   │   ├── schema.sql        SQLite schema
│   │   └── index.js          DB 헬퍼 (prepared statements)
│   ├── routes/               auth · content · bj · mypage
│   ├── middleware/auth.js    requireLogin · requireAgeVerified · requireRole
│   └── signaling/            BJ 통화 시그널링 (Socket.IO)
├── views/
│   ├── layout.ejs            공통 레이아웃
│   ├── components/           header, footer
│   ├── auth/                 login, register, verify_age
│   ├── content/              list, player
│   ├── bj/                   list, call, console
│   ├── mypage/               home, billing, history
│   └── home, pricing, about, legal, error
├── public/
│   ├── css/                  theme · components · pulse_device · pages
│   ├── js/
│   │   ├── core/             device · funscript · header
│   │   ├── pages/            player · bj_call · bj_console
│   │   └── vendor/           simple-peer
│   ├── content/              실제 영상·funscript (vods/, vrs/)
│   └── images/
├── data/
│   ├── pulse.db              SQLite DB 파일
│   └── sessions/             세션 파일 저장
└── scripts/
    └── seed.js               초기 데이터 시드
```

## 기능 매트릭스

| # | 기능 | Phase | 상태 |
|---|---|---|---|
| 01 | 영상 플레이 (2D + funscript + 디바이스) | P1 | ✅ |
| 02 | BJ 통화 (WebRTC P2P 음성 + 디바이스 데이터채널) | P2 | ✅ |
| 03 | BJ 함께보기 | P2 | 🔵 (다음) |
| 04 | VR 플레이 (다축 funscript L0+R0+R2) | P2 | ✅ |
| 05 | BJ 라이브 (비공개 / 공개방) | P3 / P5 | 🔵 (다음) |
| - | 디바이스 USB Serial | - | ✅ |
| - | 디바이스 Bluetooth LE (NUS) | - | ✅ |
| - | 사이트 전역 디바이스 유지 (auto-reconnect) | - | ✅ |
| - | 회원가입 / 로그인 / 세션 / 비밀번호 해시 | - | ✅ |
| - | 연령 인증 (19+) | - | ✅ |
| - | Ruby 충전 / 구독 / 거래 내역 (mock PG) | - | ✅ |
| - | 시청 기록 / 진행률 저장 | - | ✅ |
| - | BJ 콘솔 (방송 시작 · 키보드 조작 · 모니터링) | - | ✅ |

## 핵심 기술

- **Express 4 + EJS** — 익숙하고 가벼움, 폰 서버 호환
- **better-sqlite3** — 외부 DB 서버 없이 단일 파일. 동기 API라 코드 깔끔
- **express-session + session-file-store + bcrypt** — 실서비스급 인증
- **socket.io + simple-peer** — WebRTC 시그널링 + P2P 음성/데이터
- **TCode V3 표준** — OSR2+ / SR6 / Handy 등 호환

## 디바이스 연결

우측 상단 알약 버튼:
- 🔌 **USB Serial** — Chrome/Edge 데스크탑. 페이지 이동해도 자동 재연결
- 📡 **Bluetooth LE** — Chrome 모바일/데스크탑. NUS (Nordic UART Service)

## 환경 변수

```
PORT=5500
SESSION_SECRET=change-me-in-production
```

## 폰 배포

기존 IWeb 배포 절차와 동일:
1. `pulse/` 폴더 전체를 폰 `~/IWeb-new/` 등으로 복사
2. 폰에서 `npm install --production`
3. `node server/app.js`
4. cloudflared 터널은 기존과 동일하게 사용

## 다음 마일스톤

- [ ] #03 BJ 함께보기 (영상 시간 동기)
- [ ] #05 BJ 라이브 비공개방 (WebRTC 비디오 트랙 추가)
- [ ] 실제 PG 연동 (KG이니시스 / 토스페이먼츠)
- [ ] 본인인증 / KYC (NICE / KCB)
- [ ] 다국어 (한 · 일 · 영)
- [ ] PWA 모바일 앱

---

© 2026 PULSE — Codename. 최종 브랜드 확정 시 일괄 교체.
