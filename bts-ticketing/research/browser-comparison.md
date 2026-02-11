# 안티-디텍션 브라우저 비교 분석
> 업데이트: 2026-02-10 | BTS 광화문 티켓팅 프로젝트

## ⚠️ 면책 조항
이 문서는 웹 검색 결과를 기반으로 작성됨. 각 항목에 출처 URL 표기. 확인되지 않은 정보는 "확인 필요"로 표시.

## 📊 요약 비교표

| 도구 | 언어 | 유지보수 상태 | Cloudflare 우회 | 사용 난이도 |
|------|------|--------------|----------------|------------|
| **Camoufox** | Python | ⚠️ 활발 (갭 있었음) | 높음 | 중상 |
| **Nodriver** | Python | ✅ 활발 | 중상 | 중 |
| **SeleniumBase UC** | Python | ✅ 매우 활발 | 중상 | 하 |
| **Playwright Stealth** | Python/JS | ⚠️ 제한적 | 낮음 | 중 |
| **Puppeteer Stealth** | JS | ❌ 중단됨 | 낮음 | 중 |

---

## 1. Camoufox 🦊

> 출처: https://github.com/daijro/camoufox, https://camoufox.com

### 개요
- **GitHub**: [daijro/camoufox](https://github.com/daijro/camoufox)
- **기반**: Firefox 커스텀 빌드 (현재 v146 베타)
- **언어**: Python (Playwright 래퍼)

### 핵심 특징
```python
# 설치
pip install -U camoufox[geoip]
python -m camoufox fetch  # 브라우저 다운로드 (수백 MB)

# 사용
from camoufox.sync_api import Camoufox
with Camoufox(humanize=2.0) as browser:  # 인간 행동 에뮬레이션
    page = browser.new_page()
    page.goto("https://example.com")
```

### 장점 (GitHub README 기반)
> 출처: https://github.com/daijro/camoufox
- ✅ "data is intercepted at the C++ implementation level, making the changes undetectable through JavaScript inspection"
- ✅ Navigator, WebGL, AudioContext, 폰트 등 스푸핑
- ✅ "WebRTC IP spoofing at the protocol level"
- ✅ "Human-like cursor movement"
- ✅ "Geolocation, timezone, and locale spoofing"

> 출처: https://roundproxies.com/blog/selenium-cloudflare-bypass/
- ✅ "Camoufox uses Firefox instead of Chrome, which can bypass Chrome-specific detection"

### 단점 (GitHub README 기반)
> 출처: https://github.com/daijro/camoufox
- ⚠️ "There has been a year gap in maintenance due to a personal situation"
- ⚠️ "FF146 only works for MacOS. Linux support is coming... windows support by the end of January"
- ⚠️ "Camoufox does not fully support injecting Chromium fingerprints"

### Cloudflare 우회 능력
> 출처: https://roundproxies.com/blog/bypass-bot-detection/ (2026-01-08)
```
"Camoufox passes detection tests on CreepJS, BrowserLeaks, and other 
fingerprinting analysis tools. It remains undetected against Cloudflare 
Turnstile, DataDome, and Imperva."
```

---

## 2. Nodriver (구 undetected-chromedriver v2)

> 출처: https://github.com/ultrafunkamsterdam/undetected-chromedriver, https://roundproxies.com/blog/selenium-cloudflare-bypass/

### 개요
- **GitHub**: ultrafunkamsterdam/undetected-chromedriver (Nodriver 모드)
- **기반**: Chrome DevTools Protocol (CDP) 직접 통신
- **언어**: Python

### 핵심 특징
```python
# 설치
pip install nodriver

# 사용
import nodriver as uc
async def main():
    browser = await uc.start()
    page = await browser.get("https://example.com")
    await browser.stop()
```

### 장점
> 출처: https://www.zenrows.com/blog/undetected-chromedriver-alternatives
- ✅ "Direct CDP communication reduces WebDriver fingerprints"

> 출처: https://github.com/seleniumbase/SeleniumBase/discussions/2536
- ✅ 빠른 시작 속도 (~0.5초)

### 단점
> 출처: https://roundproxies.com/blog/selenium-cloudflare-bypass/ (2026-01)
- ⚠️ "Nodriver offers slightly better evasion but less stability" (SeleniumBase 대비)
- ⚠️ VPS/헤드리스 환경에서 탐지 가능 (GitHub 이슈 참조)
- ⚠️ 휴먼라이크 행동 별도 구현 필요

### Cloudflare 우회 능력
> GitHub 이슈 참조: https://github.com/ultrafunkamsterdam/undetected-chromedriver/issues/1875
- VPS에서 Cloudflare 우회 어려움 보고됨
- 로컬 환경에서는 대부분 성공

### 추가 플러그인
```python
# nodriver-cf-bypass 플러그인
from nodriver_cf_bypass import CFBypass
result = await CFBypass(_browser_tab=tab).bypass(_max_retries=10)
```

---

## 3. SeleniumBase UC Mode

> 출처: https://seleniumbase.io/help_docs/uc_mode/, https://roundproxies.com/blog/seleniumbase-uc-mode/

### 개요
- **GitHub**: seleniumbase/SeleniumBase
- **기반**: undetected-chromedriver 통합 + 자체 개선
- **언어**: Python

### 핵심 특징
```python
# 설치
pip install seleniumbase

# 사용
from seleniumbase import SB
with SB(uc=True, headless=False) as sb:
    sb.uc_open_with_reconnect("https://example.com", 4)
    sb.uc_gui_click_captcha()  # CAPTCHA 자동 처리
```

### 장점
> 출처: https://seleniumbase.io/help_docs/uc_mode/
- ✅ "SeleniumBase UC Mode allows bots to appear human, which lets them evade detection from anti-bot services"
- ✅ **자동 드라이버 관리** (버전 매칭)
- ✅ **CAPTCHA 헬퍼 내장** (`uc_gui_click_captcha`)

> 출처: https://roundproxies.com/blog/seleniumbase-uc-mode/ (2025-12-08)
- ✅ "The regular undetected-chromedriver library requires manual driver management... SeleniumBase handles driver downloads and version matching automatically"

> 출처: https://brightdata.com/blog/web-data/web-scraping-with-seleniumbase (2025-09-16)
- ✅ CDP Mode: "While regular UC Mode cannot perform WebDriver actions when the driver is disconnected, the CDP-Driver can still interact"

### 단점
> 출처: https://github.com/seleniumbase/SeleniumBase/discussions/2536
- ⚠️ "Chrome, when used with SeleniumBase, takes about 3 seconds to open, whereas Undetected Chromedriver opens in 0.5 seconds"

> 출처: https://roundproxies.com/blog/selenium-cloudflare-bypass/
- ⚠️ "Camoufox uses Firefox instead of Chrome, which can bypass Chrome-specific detection"

---

## 4. Playwright Stealth

> 출처: https://pypi.org/project/playwright-stealth/

### 개요
- **PyPI**: playwright-stealth
- **기반**: Playwright + puppeteer-stealth 포트
- **언어**: Python, JavaScript

### 공식 경고
> 직접 인용 (PyPI):
> "Don't expect this to bypass anything but the simplest of bot detection methods. 
> Consider this a proof-of-concept starting point."

### 핵심 특징
```python
# 설치
pip install playwright-stealth

# 사용
from playwright.async_api import async_playwright
from playwright_stealth import stealth_async

async with async_playwright() as p:
    browser = await p.chromium.launch()
    page = await browser.new_page()
    await stealth_async(page)
    await page.goto("https://example.com")
```

### 평가
> 출처: https://kameleo.io/blog/camoufox-vs-kameleo-bypass-bot-blocks (2025-07-03)
- "Independent tests show Kameleo passing Browserscan and bypassing Cloudflare WAF where Playwright Stealth and Undetected ChromeDriver fail"

⚠️ Cloudflare 고급 보호 우회에는 부적합

---

## 5. Puppeteer Stealth ❌

> 출처: https://scrapfly.io/blog/posts/how-to-bypass-cloudflare-anti-scraping (2025-11-18)

### 개요
- **상태**: ❌ **2025년 2월 유지보수 중단**
- **GitHub**: berstend/puppeteer-extra
- **언어**: JavaScript (Node.js)

### 현재 상태
> 직접 인용: "IMPORTANT DEPRECATION NOTICE: As of February 2025, puppeteer-extra-stealth 
> is no longer actively maintained. The original maintainer announced the project 
> will not receive further updates."

> 출처: https://blog.castle.io/is-puppeteer-stealth-dead-not-yet-but-its-best-days-are-over/ (2025-11-06)
- 탐지 시스템들이 Puppeteer Stealth 패턴을 학습함

### 대안 권장
- JavaScript 필요 시: Nodriver Node.js 버전, Playwright Stealth
- Python 가능 시: **Camoufox** 또는 **SeleniumBase UC**

---

## 🇰🇷 한국 티켓팅 사이트 관련

### 인터파크/예스24 관련 블로그 (확인 필요)
> 출처: https://spectrum20.tistory.com/entry/python-Selenium-활용-인터파크-티켓예매-매크로-만들기 (2025-10-26)
- "반복적으로 사용시, 매크로로 감지하여 정지먹음 주의 (selenium 연습용으로만 사용하자)"
- selenium-stealth로 기본 우회 시도 가능

> 출처: https://spectrum20.tistory.com/entry/python-Selenium-활용-Yes24-티켓예매-매크로-만들기 (2025-07-14)
- 예스24도 유사한 탐지 시스템 있음

### 권장 도구 (웹 검색 기반)
> 출처: https://scrapfly.io/blog/posts/how-to-bypass-cloudflare-anti-scraping (2025-11-18)
```
"Implement stealth tools: Nodriver (2025 recommended), SeleniumBase UC Mode, 
or Camoufox for Python projects"
```

> 출처: https://roundproxies.com/blog/how-to-bypass-anti-bots/ (2026-01-01)
```
"If still blocked, switch tools (Camoufox → Nodriver → SeleniumBase)"
```

⚠️ **실제 한국 티켓팅 사이트 성공률은 확인 필요** - 위 출처들은 일반적인 안티봇 우회에 관한 것

---

## 🔧 2025-2026 업데이트 현황

| 도구 | 상태 | 출처 |
|------|------|------|
| Camoufox | 🟡 FF146 베타 개발중, 1년 갭 있었음 | GitHub README |
| Puppeteer Stealth | 🔴 2025-02 중단 | scrapfly.io |

⚠️ 다른 도구들의 정확한 업데이트 현황은 각 GitHub 저장소에서 확인 필요

---

## 📌 최종 권장사항 (웹 검색 기반)

### 권장 도구 우선순위
> 출처: https://scrapfly.io/blog/posts/how-to-bypass-cloudflare-anti-scraping (2025-11-18)

1. **Nodriver** - "2025 recommended"
2. **SeleniumBase UC Mode** - 안정성, CAPTCHA 헬퍼
3. **Camoufox** - Firefox 기반, Chrome 탐지 우회

### 피해야 할 것
> 출처: https://scrapfly.io/blog/posts/how-to-bypass-cloudflare-anti-scraping
- "Avoid deprecated tools like puppeteer-stealth (discontinued February 2025)"

### 추가 권장사항
> 출처: https://roundproxies.com/blog/how-to-bypass-anti-bots/ (2026-01-01)
- "For Cloudflare, DataDome, PerimeterX, or Akamai-protected sites, residential proxies significantly improve success rates"
- "When detection increases, update to latest versions first. If still blocked, switch tools"

⚠️ **BTS 광화문 티켓팅 특정 성공률은 확인 필요** - 실제 테스트 권장

---

## 📚 참고 자료
- [Camoufox 공식 문서](https://camoufox.com)
- [SeleniumBase UC Mode](https://seleniumbase.io/help_docs/uc_mode/)
- [Scrapfly Cloudflare 우회 가이드](https://scrapfly.io/blog/posts/how-to-bypass-cloudflare-anti-scraping)
- [Bright Data 2026 안티봇 우회](https://brightdata.com/blog/web-data/bypass-cloudflare)
