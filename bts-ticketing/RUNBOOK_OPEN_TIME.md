# BTS/NOL 티켓팅 매크로 런북 (오픈타임)

> 목표: **오픈 순간(예매하기 → 팝업/iframe → 좌석 선택)** 구간을 Playwright로 최대한 자동화.
> 
> 원칙: **캡챠/Turnstile은 기본 수동**. CapSolver는 `--capsolver` opt-in.

## 0) 준비물
- `.env.local`에 Interpark/NOL 계정 정보 세팅
  - `INTERPARK_ID`, `INTERPARK_PWD`
  - (선택) `CONCERT_URL` 또는 `CONCERT_QUERY`
- 파이썬 deps:
  ```bash
  cd bts-ticketing
  python3 -m venv .venv && source .venv/bin/activate
  pip install -r requirements.txt
  python -m playwright install chromium
  ```

## 1) 사전 리허설 (오픈 전날/당일)
### A. 로그인만 점검
```bash
cd bts-ticketing/src
python main_playwright.py --login-only
```
- 성공하면 `/tmp/login_test.png` 생성

### B. 공연 페이지까지 진입 점검 (결제/좌석은 안함)
```bash
cd bts-ticketing/src
python main_playwright.py --test --stop-after concert
```
- 성공하면 `/tmp/stop_after_concert.png`

## 2) 오픈타임 당일 운영 플로우 (권장)
### Step 1) 사람: 로그인/Turnstile 처리 + 공연 페이지까지 진입
- `--stop-after concert` 모드로 공연 상세 페이지까지 안정적으로 가져간다.
- Turnstile이 뜨면 **수동으로** 해결.

### Step 2) 오픈 직전 1~2분 전: 최종 실행 커맨드 준비
```bash
cd bts-ticketing/src
python main_playwright.py \
  --hour 20 --minute 0 \
  --stop-after seats
```
- 기본값 `dry_run=True`라서 **결제는 스킵**한다.
- 좌석까지 잡힌 시점에서 사람이 결제 진행(또는 dry-run 해제 후 자동 결제).

### Step 3) (옵션) CapSolver 사용
> 기본 OFF. 정말 필요할 때만.
```bash
python main_playwright.py --capsolver --hour 20 --minute 0 --stop-after seats
```

## 3) 안전장치 / 옵션 설명
- `--stop-after <stage>`
  - `login|concert|booking|queue|seats`
  - 각 단계에서 스크린샷을 `/tmp/stop_after_*.png`로 저장
- **결제 스킵(dry-run)**
  - 기본 ON (코드에서 기본값 True)
  - 결제를 실제로 진행하려면: `--auto-pay`를 켠 상태에서 `--dry-run`을 *주지 않는다*

## 4) 트러블슈팅
### A. 실패 덤프 확인
- `/tmp/bts-debug/<timestamp>_<reason>/{meta.json,page.html,screenshot.png}`

### B. 대기열 스냅샷
- `/tmp/queue_debug_*.png`

### C. 공연 페이지 진입 실패
- `CONCERT_URL`이 리다이렉트로 막히면 `CONCERT_QUERY`(공연명 검색어)로 우회.

---

## 운영 결론
- 브라우저 툴(OpenClaw `browser.act`) 기반 실시간 조작은 현재 **불안정/타임아웃** → 오픈타임 핵심 구간에는 비권장.
- Playwright 단독 실행이 **재현성/속도/디버그** 측면에서 승률이 높다.
