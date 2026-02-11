# 2025-2026 최신 감지 우회 기술 🚀

## 📊 도구 비교 (2026년 1월 기준)

| 도구 | Cloudflare Challenge | Turnstile CAPTCHA | 속도 | 리소스 | 스텔스 |
|------|---------------------|-------------------|------|--------|--------|
| **Nodriver** ⭐ | ✅ | ✅ | 빠름 | 낮음 | 매우 높음 |
| **Camoufox** ⭐ | ✅ | ✅ | 중간 | 중간 | 매우 높음 |
| undetected-chromedriver | ✅ | ❌ | 느림 | 높음 | 중간 |
| Puppeteer Stealth | ✅ | ❌ | 중간 | 높음 | 중간 |
| Playwright Stealth | ⚠️ | ❌ | 중간 | 높음 | 낮음 |

---

## 1️⃣ Nodriver (undetected-chromedriver 후속작)

**가장 추천! ⭐**

```bash
pip install nodriver
```

```python
import nodriver as nd

async def main():
    browser = await nd.start()
    page = await browser.get('https://tickets.interpark.com')
    
    # 요소 찾기 + 클릭
    btn = await page.find('예매하기')
    await btn.click()
    
    # 스크린샷
    await page.save_screenshot('result.png')

if __name__ == '__main__':
    nd.loop().run_until_complete(main())
```

**장점:**
- undetected-chromedriver보다 **더 빠르고 안정적**
- Selenium 없이 직접 CDP(Chrome DevTools Protocol) 사용
- Cloudflare, Imperva, DataDome 전부 우회
- **Turnstile CAPTCHA도 우회 가능!**

---

## 2️⃣ Camoufox (Firefox 기반)

**가장 스텔스! ⭐**

```bash
pip install camoufox[geoip]
playwright install firefox
```

```python
from camoufox.sync_api import Camoufox

with Camoufox(headless=False) as browser:
    page = browser.new_page()
    page.goto('https://tickets.interpark.com')
    
    # 자동으로 랜덤 핑거프린트 생성!
    page.click('text=예매하기')
```

**특징:**
- **C++ 레벨에서 핑거프린트 변경** (JS 인젝션 아님 → 감지 불가)
- Firefox 기반이라 Chrome 감지 로직 우회
- 매 실행마다 랜덤 핑거프린트 자동 생성
- Tor 프로젝트 + Arkenfox 연구 기반

**핑거프린트 커스텀:**
```python
from camoufox.sync_api import Camoufox

with Camoufox(
    os='windows',  # Windows로 위장
    screen={'width': 1920, 'height': 1080}
) as browser:
    page = browser.new_page()
    page.goto('https://example.com')
```

---

## 3️⃣ Patchright (Playwright 패치)

```bash
pip install patchright
```

```python
from patchright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page()
    page.goto('https://tickets.interpark.com')
```

**특징:**
- Playwright와 동일한 API
- `--disable-blink-features=AutomationControlled` 자동 적용
- navigator.webdriver 감지 우회

---

## 4️⃣ Rebrowser-Puppeteer

```bash
npm install rebrowser-puppeteer
```

```javascript
const { launch } = require('rebrowser-puppeteer');

(async () => {
    const browser = await launch({ headless: false });
    const page = await browser.newPage();
    await page.goto('https://tickets.interpark.com');
})();
```

**특징:**
- Puppeteer 패치 버전
- 자동화 플래그 자동 제거
- Turnstile CAPTCHA 처리 가능

---

## 🎯 인터파크 티켓팅 권장 설정

### Option A: Nodriver (Python) — 추천!

```python
import nodriver as nd
import random
import asyncio

async def ticketing():
    # 브라우저 시작
    browser = await nd.start(
        headless=False,
        browser_args=[
            '--window-size=1920,1080',
            '--lang=ko-KR',
        ]
    )
    
    page = await browser.get('https://tickets.interpark.com')
    
    # 랜덤 딜레이
    await asyncio.sleep(random.uniform(1, 3))
    
    # 로그인 등 진행...

nd.loop().run_until_complete(ticketing())
```

### Option B: Camoufox (가장 안전)

```python
from camoufox.sync_api import Camoufox
import random
import time

with Camoufox(
    headless=False,
    humanize=True,  # 인간처럼 행동
) as browser:
    page = browser.new_page()
    page.goto('https://tickets.interpark.com')
    
    # 랜덤 딜레이
    time.sleep(random.uniform(1, 3))
    
    # 로그인 등 진행...
```

---

## 🛡️ 추가 스텔스 팁

### 1. 타이밍 랜덤화
```python
import random
import asyncio

async def human_delay():
    await asyncio.sleep(random.uniform(0.5, 2.0))
```

### 2. 마우스 곡선 이동
```python
# Nodriver 예시
await page.mouse.move(100, 100)  # 직선 대신
# → bezier curve 라이브러리로 곡선 이동 구현
```

### 3. 실제 브라우저 프로필 사용
```python
# 기존 Chrome 프로필 사용 (쿠키, 히스토리 포함)
browser = await nd.start(
    user_data_dir='/Users/han/Library/Application Support/Google/Chrome'
)
```

### 4. 프록시 로테이션
```python
# 주거용 프록시 (데이터센터 IP 차단됨)
browser = await nd.start(
    browser_args=['--proxy-server=http://residential-proxy:8080']
)
```

---

## 📋 최종 권장 스택

| 용도 | 도구 | 이유 |
|------|------|------|
| **메인** | Nodriver | 빠르고 안정적, Turnstile 우회 |
| **백업** | Camoufox | 감지 거의 불가능, Firefox 기반 |
| **CAPTCHA** | 수동 입력 | 가장 안전 |
| **프록시** | 주거용 | 데이터센터 IP는 차단 |

---

## 🔄 업데이트 필요 사항

1. **requirements.txt 업데이트:**
```
nodriver>=0.35.0
camoufox[geoip]>=0.4.0
```

2. **main.py를 Nodriver로 전환** (undetected-chromedriver 대신)

---

*Last updated: 2026-02-10*
