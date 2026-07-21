# 🚀 PULSE / Syncra — 폰 배포 설정 (다른 채팅에 넘겨주는 파일)

> **새 채팅 첫 메시지 추천:**
> ```
> pulse/DEPLOY.md 읽고 폰 배포 환경 파악해줘. 이 절차대로 배포·재기동·점검할 거야.
> ```
> 이 파일 하나면 새 세션에서도 폰(A82, Termux) 배포를 그대로 이어갈 수 있다.
> 더 넓은 맥락은 `HANDOFF.md` + `PROJECT_STATUS.md` 참고.

---

## 0. 한 줄 요약
- 작업 폴더(PC): `D:\Leeminsoo\Project\Website\IWeb\IRealverse-main\pulse`
- 서버: 폰 Termux에서 `node server/app.js`, **포트 5501**
- 외부 주소(고정·영구): **https://syncra.uk** (Cloudflare named tunnel)
- 출입 게이트 + 로그인 모두 **`1111` / `2222`**

---

## 1. 폰 접속 (SSH)
```bash
ssh -o StrictHostKeyChecking=no -p 8022 u0_a870@192.168.219.108
```
- IP `192.168.219.108` (같은 LAN 가정. 바뀌면 폰에서 재확인). 포트 `8022`.
- 폰 홈 `~` = `/data/data/com.termux/files/home`, 프로젝트 `~/pulse`.
- **재부팅하면 Termux 서비스가 다 내려감.** 폰에서 `sshd` 한 줄 먼저 실행해야 SSH 가능(자동시작 안 됨). 그 뒤 아래 2·3번으로 서버+터널 기동.

---

## 2. 서버 기동 / 재기동
```bash
# 폰에 만들어둔 스크립트 사용 (pkill 자기-종료 회피 + wake-lock 포함)
ssh -o StrictHostKeyChecking=no -p 8022 u0_a870@192.168.219.108 'bash ~/pulse/restart_pulse.sh'
# → "spawned_pid_XXXX" 출력되면 기동됨
```
- 필수 env(스크립트에 내장): `PORT=5501 BEHIND_PROXY=1`. BEHIND_PROXY 빠지면 HTTPS secure 쿠키 깨짐.
- 로컬 health: `curl -s http://localhost:5501/health` → `{"ok":true,...}`
- 폰 Node 26 → DB는 `node:sqlite` 어댑터 자동, bcryptjs 사용(네이티브 빌드 X).

---

## 3. 외부 터널 (Cloudflare named tunnel → syncra.uk)
```bash
# 터널만 죽었을 때 (서버는 안 건드림)
ssh -o StrictHostKeyChecking=no -p 8022 u0_a870@192.168.219.108 'bash ~/pulse/restart_named.sh'
```
- 터널 이름 `syncra`, id `54a9f992-1739-414b-9fe6-b437688ecf42`.
- 설정 `~/.cloudflared/config.yml` (ingress: syncra.uk·www.syncra.uk → http://localhost:5501).
- 자격증명 `~/.cloudflared/<id>.json`, 계정 인증서 `~/.cloudflared/cert.pem`.
- 로그 `~/pulse/named.log`. 주소는 **재부팅에도 syncra.uk 영구 불변**.
- ⚠ **trycloudflare(`restart_cf.sh`)·ngrok(`restart_ngrok.sh`)는 폐기** — 쓰지 말 것. (ngrok=월 1GB 대역폭 한계, trycloudflare=주소 가변)

---

## 4. 코드 변경 → 폰 배포 (핵심 패턴)
PC에서 변경한 파일만 tar로 전송. **`data/`·`node_modules`는 절대 전송 금지**(폰 DB/세션 덮어쓰기 위험).
```bash
# PC(Git Bash)에서 — 바뀐 파일 나열해서 전송
tar -C "D:/Leeminsoo/Project/Website/IWeb/IRealverse-main/pulse" -cf - \
    views/components/header.ejs public/css/components.css public/js/core/header.js \
  | ssh -o StrictHostKeyChecking=no -p 8022 u0_a870@192.168.219.108 "cd ~/pulse && tar -xf -"
```
- **뷰(.ejs)·정적(css/js)은 서버 재시작 불필요** (EJS는 매 요청 읽음, static은 파일 교체 즉시).
- **server/ 코드(.js) 변경 시에만** 2번으로 서버 재기동.
- **CSS/JS 변경 시 캐시버스트 필수**: static은 1일 캐시(maxAge:1d). `views/layout.ejs`의 `?v=...` 숫자를 올려라 (예: `components.css?v=mnav2` → `mnav3`). 안 그러면 브라우저가 옛 파일 씀.
- `package.json` 바뀌면: 폰에서 `cd ~/pulse && npm install --omit=optional --production` (cookie-parser 등 런타임 의존성).

---

## 5. 출입 게이트 (사이트 앞단 관문, Basic 인증)
- 코드: `server/middleware/gate.js` (app.js 최상단 마운트). `/health`·`/favicon.ico`만 우회.
- 계정 관리: 폰 `~/pulse/data/gate.json` — **고치면 5초 내 자동 반영(재시작 불필요)**.
```json
{ "enabled": true, "realm": "Syncra", "users": [ { "user": "1111", "pass": "2222" } ] }
```
- 끄려면 `"enabled": false`. 여러 계정은 `users` 배열에 추가.

---

## 6. 마스터 계정 (관리자 + 스트리머)
- 로그인 `1111` / `2222`, role=`admin`(모든 권한 통과) + bj_profiles + 크레딧 99,999,999.
- 생성/갱신: 폰에서 `cd ~/pulse && node scripts/make_master.js` (멱등 — 있으면 갱신).
- 로그인 폼은 `type=text`(이메일 아닌 아이디 허용)로 변경돼 있음.

---

## 7. 검증 명령 (PC에서)
게이트가 있으니 모든 외부 요청에 `-u 1111:2222` 필요.
```bash
curl -s https://syncra.uk/health                              # 게이트 우회, {"ok":true} 기대
curl -s -o /dev/null -w "%{http_code}\n" https://syncra.uk/   # 무인증 → 401
curl -s -u 1111:2222 -o /dev/null -w "%{http_code}\n" https://syncra.uk/   # → 200
```
로그인 e2e(CSRF 필요):
```bash
JAR=./cj.txt; rm -f $JAR; G="1111:2222"
T=$(curl -s -u "$G" -c $JAR https://syncra.uk/auth/login | grep -oE 'name="_csrf" value="[^"]+"' | head -1 | sed 's/.*value="//;s/"$//')
curl -s -u "$G" -b $JAR -c $JAR -o /dev/null -w "login %{http_code}\n" \
  --data-urlencode "_csrf=$T" --data-urlencode "email=1111" --data-urlencode "password=2222" --data-urlencode "next=/" \
  https://syncra.uk/auth/login   # → 302 성공
```

---

## 8. 절대 잊지 말 것 (Gotchas)
1. **SSH 명령에 `pkill -f '...패턴...'`을 직접 넣지 말 것** — 그 문자열이 SSH 자기 명령줄과 매칭돼 세션이 죽음(exit 255, "출력 없음"으로 나타남). **항상 폰의 `restart_*.sh` 스크립트로 분리 실행.**
2. **PC에서 `npm install --omit=optional` 금지** — better-sqlite3(PC 필수) 프루닝됨. 복구: `npm install better-sqlite3 --no-save`. (폰은 node:sqlite라 무관)
3. **화면 꺼지면 서버·터널 죽음** = 안드로이드 절전(Doze). 회피: ① restart 스크립트에 `termux-wake-lock` 내장됨 ② **사용자가 폰 설정**: 설정→앱→Termux→배터리→"제한 없음", 삼성 절전앱서 Termux 제외 ③ **충전기 연결**. → 이거 안 하면 폰 꺼질 때마다 2·3번으로 되살려야 함.
4. **`data/`·`node_modules` tar 전송 금지** (폰 DB·세션 덮어씀).
5. 포트는 **5501** (5500은 옛 IWeb 데모).

---

## 9. 핵심 경로 빠른참조
| 항목 | 위치 |
|---|---|
| 서버 진입 | `server/app.js` (포트/보안/라우트) |
| DB | `server/db/index.js`, `schema.sql` (폰=node:sqlite) |
| 게이트 | `server/middleware/gate.js` + 폰 `~/pulse/data/gate.json` |
| 헤더/모바일네비 | `views/components/header.ejs`, `public/css/components.css`, `public/js/core/header.js` |
| 레이아웃(캐시버스트) | `views/layout.ejs` (`?v=` 올리기) |
| 터널 설정 | 폰 `~/.cloudflared/config.yml` |
| 폰 스크립트 | `~/pulse/restart_pulse.sh`(서버), `~/pulse/restart_named.sh`(터널) |
