# CAPTCHA 서비스 심층 분석

> 작성일: 2026-02-10
> 목적: BTS 광화문 티켓팅 자동화를 위한 CAPTCHA 해결 서비스 비교
> ⚠️ 모든 정보는 웹 검색 기반. 출처 URL 명시.

---

## 1. 서비스 비교: 2Captcha vs Anti-Captcha vs CapSolver

### 가격 비교 (1000건 기준)

| CAPTCHA 타입 | 2Captcha | Anti-Captcha | CapSolver |
|-------------|----------|--------------|-----------|
| **이미지/텍스트** | $0.50 - $1.00 | $0.50 | *확인 필요* |
| **reCAPTCHA v2** | $1.00 - $2.99 | *확인 필요* | $0.65 (대량 시) |
| **reCAPTCHA v3** | $1.00 - $2.99 | *확인 필요* | *확인 필요* |

**출처:**
- 2Captcha 이미지: https://2captcha.com/p/image-picture-captcha-solver ("$0.5 — $1 for 1000")
- 2Captcha reCAPTCHA: https://2captcha.com/for-customer ("$1.00 — $2.99 per 1000")
- Anti-Captcha 이미지: https://medium.com/@datajournal/best-captcha-solving-services-of-2024-b5af8e6e1e94 ("$0.5 for 1000 images")
- CapSolver reCAPTCHA: https://docs.capsolver.com/en/ ("as low as $0.65/1000 request under large usage")

### 속도 비교

| 서비스 | 이미지 CAPTCHA | reCAPTCHA v2 |
|--------|---------------|--------------|
| **2Captcha** | ~20초 평균 | ~20-22초 평균 |
| **Anti-Captcha** | ~5초 (광고) | *확인 필요* |
| **CapSolver** | 0.1초 (광고) | *확인 필요* |

**출처:**
- 2Captcha 속도: https://dolphin-anty.com/blog/en/comparison-of-captcha-solving-services/ ("reCAPTCHA via 2Captcha ~20-22s averages")
- CapSolver 속도: https://www.g2.com/products/capsolver/reviews ("0.1s is the slowest speed ever measured" - 광고성 주장, 실제 검증 필요)

### 정확도 및 방식

| 서비스 | 방식 | 정확도 |
|--------|------|--------|
| **2Captcha** | 사람 기반 | 더 정확 (사람이 해결) |
| **Anti-Captcha** | 사람 기반 | 더 정확 (사람이 해결) |
| **CapSolver** | AI 기반 | 속도 우선, 정확도는 *확인 필요* |

**출처:**
- https://brightdata.com/blog/web-data/best-captcha-solvers ("2Captcha is more accurate than many of the other alternatives")
- https://multilogin.com/blog/best-captcha-solver-in-2025/ ("human-backed services like 2Captcha and Anti-Captcha excel at accuracy")

---

## 2. 인터파크 CAPTCHA 종류 분석

### 조사 결과

#### ✅ GitHub 프로젝트에서 확인된 정보

**yeeeze/auto-ticketing** (https://github.com/yeeeze/auto-ticketing):
> "캡챠 문자열 입력 화면이 뜰텐데 직접 키보드로 입력하시고 엔터 눌러주셔야 합니다"

→ **이미지 텍스트 CAPTCHA** 사용 확인

**clyde0813/Interpark-Ticketing** (https://github.com/clyde0813/Interpark-Ticketing):
> "Captcha Decryption Algorithm Description" 언급

→ 자체 CAPTCHA 복호화 시도한 프로젝트 존재

**Selenium 탐지 관련** (https://spectrum20.tistory.com):
> "반복적으로 사용시, 매크로로 감지하여 정지먹음 주의"
> "셀레늄 감지 방지 코드... selenium-stealth 셀레늄 감지 방지"

→ 인터파크가 Selenium 탐지 시스템 사용

#### ❓ 확인 필요 사항
- reCAPTCHA 사용 여부: 직접 확인 필요 (검색 결과에서 명확한 정보 없음)
- BTS 콘서트 등 대형 공연 시 추가 보안: *확인 필요*
- 현재(2026년) CAPTCHA 종류: 사이트 변경 가능성 있음

### 기존 프로젝트 분석

| 프로젝트 | CAPTCHA 처리 | 출처 |
|----------|-------------|------|
| `yeeeze/auto-ticketing` | 수동 입력 | https://github.com/yeeeze/auto-ticketing |
| `clyde0813/Interpark-Ticketing` | 자체 알고리즘 | https://github.com/clyde0813/Interpark-Ticketing |

**⚠️ 주의**: yeeeze/auto-ticketing README에 "티켓팅 사이트 변경으로 인해 현재는 작동하지 않을 수도 있습니다" 명시됨.

---

## 3. Python 연동 코드 예시

### 2Captcha 연동

```bash
pip install 2captcha-python
```

```python
from twocaptcha import TwoCaptcha

# 초기화
solver = TwoCaptcha('YOUR_API_KEY')

# 1) 이미지 CAPTCHA 해결 (인터파크용)
result = solver.normal('captcha_image.png')
print(result['code'])  # 인식된 텍스트

# 2) reCAPTCHA v2 해결
result = solver.recaptcha(
    sitekey='6Le-wvkSVVABCPBMRTvw0Q4Muexq1bi0DJwx_mJ-',
    url='https://tickets.interpark.com/...'
)
print(result['code'])  # g-recaptcha-response 토큰

# 3) Base64 이미지로 전송
import base64

with open('captcha.png', 'rb') as f:
    captcha_base64 = base64.b64encode(f.read()).decode()

result = solver.normal(captcha_base64, numeric=1)  # 숫자만
```

### Anti-Captcha 연동

```bash
pip install python-anticaptcha
```

```python
from python_anticaptcha import AnticaptchaClient, ImageToTextTask

client = AnticaptchaClient('YOUR_API_KEY')

# 이미지 CAPTCHA
with open('captcha.png', 'rb') as f:
    task = ImageToTextTask(f)
    
job = client.createTask(task)
job.join()
print(job.get_captcha_text())
```

### CapSolver 연동

```bash
pip install capsolver
```

```python
import capsolver

capsolver.api_key = "YOUR_API_KEY"

# 이미지 CAPTCHA
solution = capsolver.solve({
    "type": "ImageToTextTask",
    "body": "BASE64_ENCODED_IMAGE"
})
print(solution['text'])

# reCAPTCHA v2
solution = capsolver.solve({
    "type": "ReCaptchaV2TaskProxyLess",
    "websiteURL": "https://tickets.interpark.com/...",
    "websiteKey": "SITE_KEY_HERE"
})
print(solution['gRecaptchaResponse'])
```

### Selenium + 2Captcha 통합 예시

```python
from selenium import webdriver
from selenium.webdriver.common.by import By
from twocaptcha import TwoCaptcha
import time

solver = TwoCaptcha('YOUR_API_KEY')

# Selenium 감지 우회
options = webdriver.ChromeOptions()
options.add_argument('--disable-blink-features=AutomationControlled')
driver = webdriver.Chrome(options=options)

def solve_interpark_captcha(driver):
    # 1. CAPTCHA 이미지 요소 찾기
    captcha_img = driver.find_element(By.CSS_SELECTOR, 'img.captcha-image')
    
    # 2. 스크린샷으로 저장
    captcha_img.screenshot('captcha.png')
    
    # 3. 2Captcha로 해결
    result = solver.normal('captcha.png')
    
    # 4. 결과 입력
    input_field = driver.find_element(By.CSS_SELECTOR, 'input.captcha-input')
    input_field.send_keys(result['code'])
    
    return result['code']
```

---

## 4. 실제 사용자 후기

### Reddit 검색 결과

**r/beermoneyglobal** (https://www.reddit.com/r/beermoneyglobal/comments/syniax/is_2captcha_undervalued_i_think_it_is/):
> "You will get paid literal pennies while you slowly go nuts from the captchas (they aren't all as easy as OP makes out, some of them have really tricky text-based ones)"

→ 2Captcha worker 관점: 복잡한 텍스트 CAPTCHA 존재

**r/u_2captchacom** (https://www.reddit.com/user/2captchacom/comments/1g1bqye/top_10_best_captcha_solving_services_for/):
> "2Captcha is arguably the most popular CAPTCHA solving service on the market today"

→ 2Captcha 공식 계정 글 (편향 주의)

**r/beermoneyph** (https://www.reddit.com/r/beermoneyph/comments/1iofx6i/2captcha_experience/):
> "There are admins who... Still rejected" (정확도 관련 불만)

→ Worker 측면 품질 관리 이슈 존재

### 한국어 블로그

**floyd21.tistory.com** (https://floyd21.tistory.com/5):
> "잔액 충전 버튼을 누르면... 신용카드/직불카드로 결제를 진행하시면 됩니다"

→ 한국 카드 결제 가능 확인

### ⚠️ 주의사항
- Reddit 후기 대부분 2021-2022년 작성 (최신 상황과 다를 수 있음)
- CapSolver 관련 독립적 Reddit 후기: *검색 결과에서 찾지 못함*
- Anti-Captcha 사용자 후기: *검색 결과에서 찾지 못함*

---

## 5. 한국 결제 가능 여부

### 확인된 정보

**2Captcha 한국 결제:**
- ✅ 신용카드/직불카드 결제 가능
- 출처: https://floyd21.tistory.com/5 ("신용카드/직불카드로 결제를 진행하시면 됩니다")

**Anti-Captcha / CapSolver:**
- *확인 필요* - 검색 결과에서 한국 결제 관련 정보 찾지 못함
- 일반적으로 해외 Visa/MC 결제 지원 예상 (확인 필요)

### 결제 방법 (2Captcha 기준)
1. 해외결제 가능한 Visa/Mastercard 신용카드
2. 직불카드 (체크카드)

### ⚠️ 확인 필요 사항
- Anti-Captcha 한국 카드 결제: 직접 확인 필요
- CapSolver 한국 카드 결제: 직접 확인 필요
- 최소 충전 금액: 각 서비스 사이트에서 확인 필요

---

## 6. 티켓팅용 분석 요약

### 검색 결과 기반 비교

| 서비스 | 장점 (출처 기반) | 단점/불확실 |
|--------|-----------------|-------------|
| **2Captcha** | 사람 기반 정확도 높음, 한국 결제 확인됨 | 속도 느림 (~20초) |
| **CapSolver** | AI 기반 속도 빠름 (광고 기준), 저렴 | 정확도/안정성 *확인 필요* |
| **Anti-Captcha** | 2007년부터 운영 | 한국 결제/상세 정보 *확인 필요* |

### ⚠️ 추가 조사 필요 사항

1. **인터파크 현재 CAPTCHA 종류**: 직접 접속해서 확인 필요
2. **CapSolver 실제 정확도**: 광고 vs 실사용 차이 검증 필요
3. **BTS 콘서트 특수 보안**: 대형 공연 시 추가 보안 여부 *확인 필요*

### 예상 비용 (출처 기반)

- 2Captcha 이미지 CAPTCHA: $0.50-$1.00 / 1000건
  - 출처: https://2captcha.com/p/image-picture-captcha-solver
- 100회 시도 기준: 약 $0.05 - $0.10

---

## 7. 다음 단계

- [ ] **인터파크 직접 확인**: 현재 CAPTCHA 종류 스크린샷 수집
- [ ] 2Captcha 계정 생성 (한국 카드 결제 확인됨)
- [ ] CapSolver 계정 생성 (결제 방법 확인 필요)
- [ ] 실제 CAPTCHA 이미지로 서비스별 정확도/속도 테스트
- [ ] Selenium + CAPTCHA solver 연동 테스트

---

## 출처 URL 목록

### 가격/속도 비교
- https://2captcha.com/p/image-picture-captcha-solver
- https://2captcha.com/for-customer
- https://docs.capsolver.com/en/
- https://dolphin-anty.com/blog/en/comparison-of-captcha-solving-services/
- https://brightdata.com/blog/web-data/best-captcha-solvers
- https://multilogin.com/blog/best-captcha-solver-in-2025/

### 인터파크 CAPTCHA 분석
- https://github.com/yeeeze/auto-ticketing
- https://github.com/clyde0813/Interpark-Ticketing
- https://spectrum20.tistory.com/entry/python-Selenium-활용-인터파크-티켓예매-매크로-만들기

### Python API
- https://github.com/2captcha/2captcha-python
- https://2captcha.com/lang/python
- https://github.com/capsolver/capsolver-python

### 한국 결제
- https://floyd21.tistory.com/5

### 사용자 후기
- https://www.reddit.com/r/beermoneyglobal/comments/syniax/is_2captcha_undervalued_i_think_it_is/
- https://www.reddit.com/user/2captchacom/comments/1g1bqye/top_10_best_captcha_solving_services_for/
