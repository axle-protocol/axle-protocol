# BTS v5.1.0 검증 결과

**검증일시:** 2026-02-11 15:50 KST  
**검증 대상:**
- `bts-ticketing/src/main_nodriver_v5.py`
- `bts-ticketing/src/multi_runner.py`

---

## 📊 요약

| 등급 | 항목 수 | 구현됨 | 미구현 | 부분 |
|------|---------|--------|--------|------|
| Critical | 3 | ✅ 3 | 0 | 0 |
| High | 4 | ✅ 4 | 0 | 0 |
| Medium | 5 | ✅ 5 | 0 | 0 |
| Low | 3 | ✅ 3 | 0 | 0 |
| **Total** | **15** | **15** | **0** | **0** |

---

## Critical

### 1. HTTP 세션 Context Manager 패턴
**✅ 구현됨** (main_nodriver_v5.py L237-268)

```python
class HTTPSessionManager:
    @asynccontextmanager
    async def get_session(self):
        async with self._lock:
            if self._session is None or self._session.closed:
                self._session = aiohttp.ClientSession(...)
            self._ref_count += 1
        try:
            yield self._session
        finally:
            async with self._lock:
                self._ref_count -= 1
```

사용 예시 (L292):
```python
async with http_manager.get_session() as session:
    async with session.post(url, data=...) as resp:
```

---

### 2. 멀티세션 성공 감지 - 완료 태스크별 결과 확인 후 취소
**✅ 구현됨**

**multi_runner.py (L41-52):**
```python
async def claim_victory(self, instance_id: int) -> bool:
    """원자적으로 승리 선언 - 먼저 호출한 인스턴스만 True 반환"""
    async with lock:
        if self.winner_instance is None:
            self.winner_instance = instance_id
            self.success_event.set()
            self.shutdown_event.set()
            return True
        return False
```

**main_nodriver_v5.py (L1629-1670):**
```python
while tasks:
    done, pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
    for task in done:
        result = task.result()
        if result:
            success_found = True
            break
    if success_found:
        break
    tasks = list(pending)
```

---

### 3. 클로저 루프 변수 캡처 방지
**✅ 구현됨** (multi_runner.py L172-177)

```python
# 태스크 생성 (스태거링 딜레이 포함 - 클로저 캡처 방지)
async def run_with_delay(idx, acc, prx, log, stagger_delay):
    if idx > 0 and stagger_delay > 0:
        await asyncio.sleep(idx * stagger_delay)
    return await run_instance(idx + 1, config, acc, prx, log, test_mode)

task = asyncio.create_task(
    run_with_delay(i, account, proxy, inst_logger, multi_cfg.stagger_delay),
    name=f"instance-{i+1}"
)
```

모든 변수가 함수 파라미터로 전달되어 캡처 문제 없음.

---

## High

### 4. Rate Limiting 감지 (429/rate + 백오프)
**✅ 구현됨** (main_nodriver_v5.py L689-718, L772-778)

**AdaptiveRefreshStrategy 클래스:**
```python
def get_interval(self, is_error: bool = False, is_rate_limited: bool = False) -> float:
    if is_rate_limited:
        self.rate_limited = True
        self._rate_limit_until = time.time() + 2.0  # 2초 백오프
        return 2.0
```

**감지 로직:**
```python
is_rate_limited = '429' in error_str or 'rate' in error_str or 'too many' in error_str
interval = strategy.get_interval(is_error=True, is_rate_limited=is_rate_limited)
if is_rate_limited:
    logger.warning(f"⚠️ Rate limiting 감지 - {interval:.1f}초 대기")
```

---

### 5. Stealth 설정 (WebGL, plugins, connection)
**✅ 구현됨** (main_nodriver_v5.py L364-426)

| 항목 | 라인 | 구현 |
|------|------|------|
| WebGL 렌더러/벤더 | L398-406 | `getParameter` 오버라이드 |
| plugins | L381-393 | Chrome PDF Plugin 등 3개 |
| connection | L415-424 | effectiveType, rtt, downlink |
| webdriver 숨김 | L369 | `navigator.webdriver = undefined` |
| languages | L395 | `['ko-KR', 'ko', 'en-US', 'en']` |
| chrome 객체 | L372-380 | runtime, loadTimes, csi |

---

### 6. Canvas CORS - rect 먼저 추출 + 에러 타입 처리
**✅ 구현됨** (main_nodriver_v5.py L1119-1187)

**rect 먼저 추출 (L1143-1151):**
```python
const rect = canvas.getBoundingClientRect();
const baseInfo = {
    rect: {
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
        ...
    }
};
```

**에러 타입 처리 (L1176-1179):**
```python
} catch (e) {
    if (e.name === 'SecurityError') {
        return { error: 'cors_blocked', ...baseInfo };
    }
    return { error: e.message, ...baseInfo };
}
```

**폴백 로깅 (L1357):**
```python
if seats and seats.get('error') == 'cors_blocked':
    logger.debug("Canvas CORS 차단 - 폴백 모드 사용")
```

---

### 7. step_wait_open - 0.3초 간격 + 15회 제한
**✅ 구현됨** (main_nodriver_v5.py L637-670)

```python
refresh_count = 0
max_rapid_refresh = 15  # 최대 고속 새로고침 횟수 (rate limiting 방지)

if remaining <= 5:
    refresh_count += 1
    if refresh_count <= max_rapid_refresh:
        await page.reload()
        await asyncio.sleep(0.3)  # 0.1 → 0.3 (rate limiting 방지)
```

---

## Medium

### 8. Turnstile 3회 재시도
**✅ 구현됨** (main_nodriver_v5.py L546-556)

```python
checkbox_attempts = 0
max_checkbox_attempts = 3

checkpoint_times = [5, 15, 30]  # 5초, 15초, 30초에 시도
if checkbox_attempts < max_checkbox_attempts:
    if elapsed > checkpoint_times[checkbox_attempts]:
        checkbox_attempts += 1
        clicked = await _try_checkbox_click()
        if clicked:
            logger.info(f"✅ Turnstile 체크박스 클릭 {checkbox_attempts}/{max_checkbox_attempts}")
```

---

### 9. 쿠키 기반 로그인 검증
**✅ 구현됨** (main_nodriver_v5.py L621-633)

```python
# 5. 쿠키 기반 확인 (마지막 수단)
try:
    cookies = await page.send(cdp.network.get_cookies())
    if cookies and cookies.cookies:
        auth_cookies = [c for c in cookies.cookies 
                      if 'token' in c.name.lower() or 
                         'session' in c.name.lower() or
                         'auth' in c.name.lower()]
        if auth_cookies:
            logger.info(f"✅ 로그인 성공! (인증 쿠키 {len(auth_cookies)}개 발견)")
            return True
```

---

### 10. NTP 한국 서버 (time.bora.net, KRISS)
**✅ 구현됨** (main_nodriver_v5.py L151-160)

```python
ntp_servers = [
    ('time.bora.net', 123),      # 한국 1순위
    ('time.kriss.re.kr', 123),   # 한국표준과학연구원
    ('ntp.kornet.net', 123),     # KT
    ('time.google.com', 123),    # 글로벌 폴백
    ('pool.ntp.org', 123),
]
```

---

### 11. 베지어 곡선 마우스 이동
**✅ 구현됨** (main_nodriver_v5.py L430-455)

```python
async def move_mouse_to(page, x: float, y: float, steps: int = 10, ...):
    # 제어점 생성 (랜덤 곡선)
    ctrl_x = (start_x + x) / 2 + random.uniform(-50, 50)
    ctrl_y = (start_y + y) / 2 + random.uniform(-30, 30)
    
    for i in range(steps):
        t = (i + 1) / steps
        # 2차 베지어 곡선: B(t) = (1-t)²P0 + 2(1-t)tP1 + t²P2
        current_x = (1-t)**2 * start_x + 2*(1-t)*t * ctrl_x + t**2 * x
        current_y = (1-t)**2 * start_y + 2*(1-t)*t * ctrl_y + t**2 * y
        
        await page.send(cdp.input_.dispatch_mouse_event(
            type_='mouseMoved', x=int(current_x), y=int(current_y)
        ))
        await asyncio.sleep(random.uniform(0.008, 0.025))
```

---

### 12. asyncio.Lock 지연 초기화
**✅ 구현됨** (multi_runner.py L35-40)

```python
def _ensure_lock(self):
    """Lock 지연 초기화 (이벤트 루프 내에서)"""
    if self._lock is None:
        self._lock = asyncio.Lock()
    return self._lock

async def claim_victory(self, instance_id: int) -> bool:
    lock = self._ensure_lock()  # 이벤트 루프 컨텍스트에서 생성
    async with lock:
        ...
```

---

## Low

### 13. psutil 모듈 상단 import
**✅ 구현됨** (main_nodriver_v5.py L33-38)

```python
# psutil 선택적 import (브라우저 프로세스 정리용)
try:
    import psutil
    HAS_PSUTIL = True
except ImportError:
    HAS_PSUTIL = False
```

사용 예시 (L1590):
```python
if not HAS_PSUTIL:
    logger.debug("psutil 미설치 - 강제 종료 건너뜀")
    return
```

---

### 14. __version__ 상수
**✅ 구현됨** (main_nodriver_v5.py L18)

```python
__version__ = "5.1.0"
__author__ = "BTS Ticketing Bot"
```

사용 예시 (L1676):
```python
logger.info(f"🎫 BTS 티켓팅 v{__version__}")
```

---

### 15. 특수문자 escape
**✅ 구현됨** (main_nodriver_v5.py L495-498)

```python
# 특수문자 실패 시 JS로 직접 입력 (모든 특수문자 escape)
escaped_char = char.replace('\\', '\\\\').replace('"', '\\"').replace("'", "\\'").replace('\n', '\\n').replace('\r', '\\r')
script = f'document.activeElement.value += "{escaped_char}"; ...'
await evaluate_js(page, script)
```

---

## 🎉 결론

**모든 15개 검증 항목이 정상적으로 구현되어 있습니다.**

v5.1.0은 10회 리뷰에서 지적된 모든 사항이 반영된 상태입니다.
