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
- ⚠️ `--test`는 **목표 시간을 현재 시각으로 강제**해서 즉시 booking을 시도함(오픈 전이면 실패할 수 있음).

## 2) 오픈타임 당일 운영 플로우 (권장 — A 전략)

> 핵심: **공연(goods) 페이지 진입/로그인/Turnstile은 사람이 오픈 전에 끝낸다.**
> 매크로는 오픈 순간부터 (예매하기→큐→좌석)만 담당.

### Step 1) 사람(필수): 공연(goods) 페이지까지 수동 진입 + 로그인/Turnstile/야놀자 인증 완료
- NOL에서 목표 공연 페이지(goods)로 **수동 진입**한다.
- 로그인/Turnstile이 뜨면 **수동으로** 해결한다.
- 야놀자 로그인으로 리다이렉트되면 **수동으로 인증까지 끝내고**, 다시 공연(goods) 페이지로 돌아온다.
- 최종 목표 상태: **"예매하기" 버튼이 보이는 goods 페이지에서 대기**.

#### 세션 유지 팁 (오픈 전)
- 오픈 10~20분 전에 위 상태를 만들어두고 대기.
- 1~2분 간격으로 아주 가볍게 스크롤/클릭(빈 곳)로 세션이 죽지 않게 유지.
- 새로고침(F5)은 가급적 금지(허브 리다이렉트로 튕길 수 있음).

### Step 2) 오픈 직전 1~2분 전: 최종 실행 커맨드 준비

> 권장: **같은 Mac에서 이미 로그인 상태(storage_state)가 저장된 상태**로 실행.

```bash
cd bts-ticketing/src
python main_playwright.py \
  --hour 20 --minute 0 \
  --stop-after seats
```

#### 판매용 전략: 1석 먼저 확정 후 추가 1석 재도전
- 2석이 필요하지만 경쟁이 심하면:
```bash
python main_playwright.py --hour 20 --minute 0 --seats 2 --allow-partial
```
- `--allow-partial`은 1석만 잡혀도 다음 단계로 진행(확정)하고 종료할 수 있게 해준다.

- 기본값 `dry_run=True`라서 **결제는 스킵**한다.
- 좌석까지 잡힌 시점에서 사람이 결제 진행.

#### 오픈 직후 재시도 루틴(실전)
- `click_booking_button_failed`가 나면:
  1) 브라우저에서 여전히 goods 페이지인지 확인
  2) 야놀자/Turnstile 리다이렉트가 뜨면 수동 해결
  3) 다시 같은 커맨드로 재실행 (최대 2~3회)

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
