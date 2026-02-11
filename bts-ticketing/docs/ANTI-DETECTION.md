# 감지 우회 기술 가이드 🛡️

## 웹사이트 봇 감지 방법

### 1. IP 분석 & 속도 제한
- 같은 IP에서 비정상적 요청 패턴 감지
- 데이터센터/VPN IP 차단
- 일정 시간 내 요청 수 제한

### 2. 브라우저 핑거프린팅
- 화면 해상도, 폰트, 플러그인 분석
- WebGL 정보 수집
- 봇은 일반 유저와 다른 패턴

### 3. Headless 브라우저 감지
- GUI 없는 환경 탐지
- JavaScript 테스트로 UI 요소 확인

### 4. 사용자 행동 분석
- 마우스 움직임 패턴
- 클릭 속도
- 비선형적 탐색 경로

---

## 우회 기술

### 1. selenium-stealth (Python)

```python
from selenium import webdriver
from selenium_stealth import stealth

options = webdriver.ChromeOptions()
options.add_argument("start-maximized")
options.add_argument('user-agent=Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)...')

driver = webdriver.Chrome(options=options)

stealth(driver,
    languages=["ko-KR", "ko", "en-US", "en"],
    vendor="Google Inc.",
    platform="MacIntel",
    webgl_vendor="Intel Inc.",
    renderer="Intel Iris OpenGL Engine",
    fix_hairline=True,
)
```

### 2. undetected-chromedriver (더 강력)

```python
import undetected_chromedriver as uc

options = uc.ChromeOptions()
options.add_argument('--no-sandbox')
options.add_argument('--disable-dev-shm-usage')

driver = uc.Chrome(options=options)
driver.get('https://tickets.interpark.com')
```

**장점:**
- Cloudflare, DataDome, Imperva 우회
- WebDriver 플래그 자동 제거
- 정기적으로 업데이트

### 3. 인간 행동 시뮬레이션

```python
import random
import time

def human_like_delay():
    """랜덤 딜레이 (0.5~3초)"""
    time.sleep(random.uniform(0.5, 3.0))

def human_like_mouse_move(driver, element):
    """곡선 마우스 이동"""
    from selenium.webdriver.common.action_chains import ActionChains
    
    actions = ActionChains(driver)
    # 직선이 아닌 곡선으로 이동
    actions.move_to_element(element)
    actions.pause(random.uniform(0.1, 0.3))
    actions.perform()

def human_like_typing(element, text):
    """한 글자씩 타이핑 (랜덤 속도)"""
    for char in text:
        element.send_keys(char)
        time.sleep(random.uniform(0.05, 0.15))
```

### 4. 프록시 로테이션

```python
# 주거용 프록시 사용 (데이터센터 IP는 차단됨)
PROXIES = [
    "http://user:pass@residential-proxy1.com:8080",
    "http://user:pass@residential-proxy2.com:8080",
]

proxy = random.choice(PROXIES)
options.add_argument(f'--proxy-server={proxy}')
```

### 5. 브라우저 설정

```python
options = webdriver.ChromeOptions()

# 창 크기 (일반적인 해상도)
options.add_argument('--window-size=1920,1080')

# WebGL 활성화
options.add_argument('--enable-webgl')

# GPU 가속
options.add_argument('--enable-gpu')

# 자동화 플래그 제거
options.add_experimental_option("excludeSwitches", ["enable-automation"])
options.add_experimental_option('useAutomationExtension', False)
```

---

## 인터파크 특화 설정

### CAPTCHA 처리

**옵션 1: OCR (easyocr)**
```python
import easyocr
reader = easyocr.Reader(['en'])
result = reader.readtext(captcha_image, detail=0)
```

**옵션 2: 2Captcha API (유료, 정확)**
```python
from twocaptcha import TwoCaptcha
solver = TwoCaptcha('API_KEY')
result = solver.normal('captcha.png')
```

**옵션 3: 수동 입력 (가장 안전)**
- CAPTCHA 이미지 캡처
- 텔레그램으로 전송
- Han이 입력

### iframe 처리

```python
# 로그인 iframe
driver.switch_to.frame(
    driver.find_element(By.XPATH, "//div[@class='leftLoginBox']/iframe[@title='login']")
)

# 좌석 iframe
driver.switch_to.frame(driver.find_element(By.ID, "ifrmSeat"))

# 결제 iframe
driver.switch_to.frame(driver.find_element(By.ID, "ifrmBookStep"))

# 메인 프레임으로 복귀
driver.switch_to.default_content()
```

---

## OpenClaw 활용 차별화

### 기존 매크로
```
스크립트 실행 → 고정된 행동 → 감지 위험
```

### OpenClaw 매크로
```
AI 페이지 분석 → 상황별 판단 → 자연스러운 행동 → 감지 회피
```

**장점:**
1. `browser.snapshot()` — 페이지 상태 AI 분석
2. 예외 상황 자동 대응
3. 랜덤 행동 패턴 생성
4. 텔레그램 즉시 알림

---

## 리스크 관리

| 리스크 | 대응 |
|--------|------|
| IP 차단 | 주거용 프록시 사용 |
| 계정 정지 | 테스트 계정 먼저 사용 |
| CAPTCHA | 수동 입력 준비 |
| UI 변경 | AI 분석으로 자동 적응 |

---

## 권장 설정 (BTS 티켓팅용)

```python
# 핵심 설정
USE_UNDETECTED_DRIVER = True
RANDOM_DELAY_MIN = 0.5
RANDOM_DELAY_MAX = 2.0
HUMAN_LIKE_TYPING = True
CAPTCHA_MODE = 'manual'  # 'ocr' | 'api' | 'manual'
TELEGRAM_NOTIFY = True
```

---

*Last updated: 2026-02-10*
