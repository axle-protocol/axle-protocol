# BTS 티켓팅 매크로 - QA 리포트 🔍

**검토 일시:** 2026-02-10 19:34 KST  
**검토 파일:** `src/main.py`, `src/main_nodriver.py`, `src/interpark.ts`  
**테스터:** Clo (QA Subagent)

---

## 📊 요약

| 구분 | 개수 | 상태 |
|------|------|------|
| 🔴 치명적 버그 | 8 | 수정 필요 |
| 🟠 심각한 문제 | 6 | 수정 권장 |
| 🟡 개선 필요 | 9 | 개선 권장 |
| ⚪ 엣지 케이스 | 12 | 처리 권장 |

**종합 평가:** ⚠️ 실전 사용 전 반드시 수정 필요

---

## 🔴 치명적 버그 (Critical Bugs)

### C1. 로그인 성공 여부 검증 없음
**파일:** `main.py:112`, `main_nodriver.py:74-87`  
**문제:** `login()` 함수가 항상 `True` 반환. 실제 로그인 성공 여부를 확인하지 않음.  
**영향:** 로그인 실패 시 나머지 플로우가 모두 실패하지만 원인 파악 불가.  
**수정:**
```python
def login(driver):
    # ... 로그인 시도 ...
    
    # 로그인 성공 확인 (예: 마이페이지 버튼 존재 여부)
    try:
        WebDriverWait(driver, 10).until(
            EC.presence_of_element_located((By.LINK_TEXT, '마이페이지'))
        )
        print("✅ 로그인 완료")
        return True
    except TimeoutException:
        print("❌ 로그인 실패: 자격증명 확인 필요")
        return False
```

---

### C2. 예외 처리에서 조용한 실패 (Silent Failures)
**파일:** 다수  
**문제:** `except: pass` 또는 `except Exception:` 후 로깅 없이 진행  
**위치:**
- `send_telegram()` - 전송 실패 무시
- `click_booking()` - 버튼 클릭 실패 무시
- `handle_captcha()` - CAPTCHA 처리 실패 무시
- `select_seat()` - 좌석 선택 실패 무시

**영향:** 실패 원인 파악 불가, 디버깅 불가능  
**수정:**
```python
except Exception as e:
    logging.error(f"작업 실패: {e}", exc_info=True)
    # 필요시 재시도 또는 알림
```

---

### C3. iframe 전환 실패 시 crash
**파일:** `main.py:94, 133, 155`  
**문제:** `driver.switch_to.frame()` 실패 시 예외 처리 없음  
**영향:** iframe 로드 지연 시 전체 프로그램 crash  
**수정:**
```python
def switch_to_frame_safe(driver, frame_locator, timeout=10):
    try:
        frame = WebDriverWait(driver, timeout).until(
            EC.presence_of_element_located(frame_locator)
        )
        driver.switch_to.frame(frame)
        return True
    except TimeoutException:
        logging.error(f"iframe 전환 실패: {frame_locator}")
        return False
```

---

### C4. 자격증명 검증 없음
**파일:** `main.py:17-18`, `main_nodriver.py:27-28`  
**문제:** `USER_ID`, `USER_PWD`가 빈 문자열이어도 실행됨  
**영향:** 빈 자격증명으로 로그인 시도 → 실패 → 원인 모름  
**수정:**
```python
def validate_config():
    errors = []
    if not CONFIG['USER_ID']:
        errors.append("INTERPARK_ID 환경변수 설정 필요")
    if not CONFIG['USER_PWD']:
        errors.append("INTERPARK_PWD 환경변수 설정 필요")
    if 'XXXXXXX' in CONFIG['CONCERT_URL']:
        errors.append("CONCERT_URL에 실제 공연 URL 설정 필요")
    
    if errors:
        for e in errors:
            print(f"❌ {e}")
        sys.exit(1)
```

---

### C5. CONCERT_URL 플레이스홀더
**파일:** `main.py:21`, `main_nodriver.py:31`  
**문제:** `'https://tickets.interpark.com/goods/XXXXXXX'` 하드코딩  
**영향:** 실제 실행 시 404 에러  
**수정:** URL을 환경변수로 이동 + 실행 전 검증

---

### C6. Nodriver - 로그인 실패 시 계속 진행
**파일:** `main_nodriver.py:68-87`  
**문제:** `if login_btn:` 체크 후 else 없음. 로그인 버튼 못 찾으면 그냥 진행  
**영향:** 로그인 안 된 상태로 예매 시도 → 실패  
**수정:**
```python
login_btn = await page.find('로그인', timeout=10)
if not login_btn:
    send_telegram("❌ 로그인 버튼을 찾을 수 없습니다")
    raise Exception("로그인 버튼 미발견")
```

---

### C7. CAPTCHA 타임아웃 하드코딩
**파일:** `main.py:145`  
**문제:** `time.sleep(30)` 고정. 사용자가 30초 내 입력 못하면 그냥 진행  
**영향:** CAPTCHA 미입력 상태로 좌석 선택 시도 → 실패  
**수정:**
```python
# 사용자 입력 대기 + 확인
for _ in range(60):  # 최대 60초
    try:
        captcha_input = driver.find_element(By.ID, 'txtCaptcha')
        if captcha_input.get_attribute('value'):  # 입력됨
            break
    except:
        pass
    time.sleep(1)
else:
    raise TimeoutError("CAPTCHA 입력 시간 초과")
```

---

### C8. Nodriver - browser.stop() 메서드 확인 필요
**파일:** `main_nodriver.py:137`  
**문제:** `browser.stop()`이 nodriver의 올바른 종료 메서드인지 불확실  
**영향:** 브라우저가 제대로 종료되지 않을 수 있음  
**수정:** nodriver 공식 문서 확인 후 올바른 메서드 사용

---

## 🟠 심각한 문제 (Major Issues)

### M1. 로깅 시스템 부재
**문제:** `print()`만 사용, 파일 로깅 없음  
**영향:** 실행 후 문제 분석 불가  
**수정:**
```python
import logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    handlers=[
        logging.FileHandler('ticketing.log'),
        logging.StreamHandler()
    ]
)
```

---

### M2. 재시도 로직에 지수 백오프 없음
**파일:** `main.py:166-192`  
**문제:** 매번 같은 간격(0.5-1초)으로 재시도  
**영향:** 서버 과부하 시 감지/차단 가능성  
**수정:**
```python
for attempt in range(max_attempts):
    delay = min(30, 0.5 * (2 ** attempt))  # 지수 백오프, 최대 30초
    time.sleep(delay)
```

---

### M3. 세션 만료 처리 없음
**문제:** 로그인 후 오랜 대기 시 세션 만료 가능  
**영향:** 오픈 시간에 세션 만료 → 로그인부터 다시  
**수정:** 주기적 세션 체크 또는 쿠키 갱신 로직 추가

---

### M4. XPath 하드코딩
**파일:** `main.py`, `interpark.ts`  
**문제:** 모든 XPath가 하드코딩. 사이트 변경 시 전체 수정 필요  
**수정:** 상수 또는 설정 파일로 분리

---

### M5. 단일 실패 지점 (Single Point of Failure)
**문제:** 한 단계라도 실패하면 전체 실패  
**수정:** 각 단계별 롤백/재시도 로직 추가

---

### M6. 비동기 예외 누락 (Nodriver)
**파일:** `main_nodriver.py`  
**문제:** 일부 async 함수에서 예외가 조용히 무시될 수 있음  
**수정:** 모든 await에 try-except 추가

---

## 🟡 개선 필요 (Improvements)

### I1. 타이밍 정밀도
- 5초 미만 대기 시 0.1초 sleep은 CPU 낭비
- `time.sleep(0.01)` 또는 busy-wait 고려

### I2. 새로고침 빈도
- 60초 이상 남으면 30초마다 새로고침
- 너무 잦으면 감지 가능, 너무 드물면 세션 만료

### I3. 인간 딜레이 최대값
- 최대 2초 딜레이가 티켓팅에서 치명적
- 경쟁 상황에서는 최소 딜레이로 전환 필요

### I4. 텔레그램 메시지 상세화
- 현재: `"⚠️ CAPTCHA 입력 필요!"`
- 개선: 스크린샷 첨부, 남은 시간 표시

### I5. TypeScript 파일 미완성
- `interpark.ts`는 skeleton만 있음
- 실제 구현 또는 삭제 필요

### I6. 환경변수 vs 설정파일
- 모든 설정이 환경변수 의존
- `.env` 파일 지원 추가 권장

### I7. 결제 단계 자동화
- 현재 수동 결제
- 본인인증 외 단계는 자동화 가능

### I8. 멀티 인스턴스 지원
- 현재 단일 브라우저만 지원
- 3개 동시 실행 로직 필요

### I9. 테스트 모드 실효성
- `--test` 모드가 오픈 대기만 스킵
- 실제 테스트 공연 URL 필요

---

## ⚪ 엣지 케이스 (Edge Cases)

| # | 상황 | 현재 처리 | 권장 처리 |
|---|------|----------|----------|
| E1 | 네트워크 끊김 | Crash | 재연결 시도 + 알림 |
| E2 | 사이트 구조 변경 | Crash | 감지 + 알림 |
| E3 | CAPTCHA 이미지 로드 실패 | 무시 | 새로고침 + 재시도 |
| E4 | 예상치 못한 팝업 | 무시 | 닫기 시도 |
| E5 | 브라우저 크래시 | 종료 | 재시작 시도 |
| E6 | 좌석 선택 중 매진 | 재시도 | 다른 구역 시도 |
| E7 | 결제 시간 초과 | 미처리 | 알림 + 재시도 안내 |
| E8 | 중복 예매 감지 | 미처리 | 알림 |
| E9 | IP 차단 | 미처리 | 프록시 전환 |
| E10 | 계정 정지 | 미처리 | 백업 계정 전환 |
| E11 | Chrome 버전 불일치 | Crash | 버전 체크 + 안내 |
| E12 | 메모리 부족 | Crash | 리소스 모니터링 |

---

## 🛠️ 코드 수정 제안

### 1. 설정 검증 함수 추가
```python
def validate_config():
    """실행 전 설정 유효성 검증"""
    required = ['USER_ID', 'USER_PWD']
    for key in required:
        if not CONFIG.get(key):
            raise ValueError(f"필수 설정 누락: {key}")
    
    if 'XXXXXXX' in CONFIG.get('CONCERT_URL', ''):
        raise ValueError("CONCERT_URL을 실제 공연 URL로 변경하세요")
```

### 2. 로깅 설정 추가
```python
import logging

def setup_logging():
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s [%(levelname)s] %(message)s',
        handlers=[
            logging.FileHandler(f'ticketing_{datetime.now():%Y%m%d_%H%M%S}.log'),
            logging.StreamHandler()
        ]
    )
    return logging.getLogger(__name__)

logger = setup_logging()
```

### 3. 안전한 요소 찾기 함수
```python
def find_element_safe(driver, locator, timeout=10, description="요소"):
    """안전하게 요소 찾기 (타임아웃 + 로깅)"""
    try:
        element = WebDriverWait(driver, timeout).until(
            EC.presence_of_element_located(locator)
        )
        logger.debug(f"{description} 발견")
        return element
    except TimeoutException:
        logger.warning(f"{description} 타임아웃 ({timeout}초)")
        return None
    except Exception as e:
        logger.error(f"{description} 찾기 실패: {e}")
        return None
```

### 4. 재시도 데코레이터
```python
import functools

def retry(max_attempts=3, delay=1, backoff=2):
    """지수 백오프 재시도 데코레이터"""
    def decorator(func):
        @functools.wraps(func)
        def wrapper(*args, **kwargs):
            current_delay = delay
            for attempt in range(max_attempts):
                try:
                    return func(*args, **kwargs)
                except Exception as e:
                    if attempt == max_attempts - 1:
                        raise
                    logger.warning(f"{func.__name__} 실패, {current_delay}초 후 재시도")
                    time.sleep(current_delay)
                    current_delay *= backoff
        return wrapper
    return decorator
```

### 5. 상태 머신 패턴 도입
```python
from enum import Enum, auto

class BookingState(Enum):
    INIT = auto()
    LOGGED_IN = auto()
    NAVIGATED = auto()
    WAITING = auto()
    CAPTCHA = auto()
    SEAT_SELECTING = auto()
    PAYMENT = auto()
    COMPLETE = auto()
    FAILED = auto()

class BookingStateMachine:
    def __init__(self):
        self.state = BookingState.INIT
        self.error = None
    
    def transition(self, new_state):
        logger.info(f"상태 전환: {self.state.name} → {new_state.name}")
        self.state = new_state
    
    def fail(self, error):
        self.error = error
        self.transition(BookingState.FAILED)
```

---

## ✅ 테스트 체크리스트

### 실행 전 확인
- [ ] `INTERPARK_ID` 환경변수 설정
- [ ] `INTERPARK_PWD` 환경변수 설정
- [ ] `CONCERT_URL`을 실제 URL로 변경
- [ ] Chrome/ChromeDriver 버전 일치 확인
- [ ] 네트워크 연결 상태 확인

### 테스트 모드 실행
- [ ] `python main.py --test`로 기본 플로우 확인
- [ ] 로그인 성공 확인
- [ ] 페이지 이동 확인
- [ ] 예매 버튼 클릭 확인

### 실전 전 최종 확인
- [ ] 모든 Critical/Major 버그 수정
- [ ] 텔레그램 알림 테스트
- [ ] 다른 공연으로 리허설 완료
- [ ] 백업 계정 준비

---

## 📝 결론

현재 코드는 **프로토타입 수준**으로, 실전 티켓팅에 사용하기에는 위험합니다.

**반드시 수정해야 할 것:**
1. 로그인 성공 확인 로직 (C1)
2. 자격증명 검증 (C4)
3. CONCERT_URL 설정 (C5)
4. 예외 처리 개선 (C2)

**강력 권장:**
1. 로깅 시스템 추가 (M1)
2. iframe 전환 안전 처리 (C3)
3. CAPTCHA 대기 로직 개선 (C7)

**테스트 완료 후:**
- `tests/` 폴더에 단위 테스트 추가됨
- `pytest tests/` 로 실행 가능

---

*QA 완료: 2026-02-10 19:34 KST*
