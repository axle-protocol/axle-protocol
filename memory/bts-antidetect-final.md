# BTS 티켓팅 - 봇 탐지 회피 최종 구현

> 날짜: 2026-02-11
> 목표: Cloudflare Turnstile 100% 통과율

## 📁 생성/수정 파일

### 1. `captcha_solver.py` (업데이트)
**CapSolver API 연동 완료**

```python
# CapSolver API 키 내장 (기본값)
CAPSOLVER_API_KEY = "CAP-D9FA14F8C7D8A878EAD098EDA676F64D99F8F65D84CD1143E6510CF4F4CA1A9F"
```

**주요 기능:**
- ✅ CapSolver AntiTurnstileTaskProxyLess 지원
- ✅ 자동 sitekey 추출 (5가지 방법)
- ✅ 토큰 자동 주입 (6가지 필드 타겟)
- ✅ 폴백 체인: CapSolver → 2captcha → 수동
- ✅ 세션별 독립 처리 (session_id 로깅)
- ✅ SeleniumBase 동기 래퍼 (`solve_turnstile_sync`)

**사용법:**
```python
from captcha_solver import TurnstileSolver, detect_and_solve

# 방법 1: 기본 사용
solver = TurnstileSolver(session_id=1)
result = await solver.solve(page)
if result.success:
    await solver.inject_token(page, result.token)

# 방법 2: 원스톱
success = await solver.solve_and_inject(page)

# 방법 3: 간편 함수
token = await detect_and_solve(page, session_id=1)

# 방법 4: SeleniumBase (동기)
from captcha_solver import solve_turnstile_sync
token = solve_turnstile_sync(driver, session_id=1)
```

---

### 2. `stealth.py` (신규)
**봇 탐지 회피 스텔스 스크립트**

**포함 기능:**
| 기능 | 설명 |
|------|------|
| Canvas Fingerprint | 노이즈 주입으로 매번 다른 해시 생성 |
| WebGL 스푸핑 | GPU 정보 위장 (Mac/Windows 지원) |
| Navigator 위장 | hardwareConcurrency, deviceMemory, platform |
| WebDriver 제거 | `navigator.webdriver = undefined` |
| Screen 스푸핑 | 해상도, pixelRatio 랜덤화 |
| AudioContext | 오디오 fingerprint 노이즈 |
| Timezone | KST 고정 |
| 마우스 인간화 | 베지어 곡선 기반 경로 생성 |

**세션 격리:**
```python
from stealth import create_fingerprint_profile, get_all_stealth_scripts

# 각 세션에 독립 fingerprint
profile1 = create_fingerprint_profile(session_id=1, proxy=proxy1)
profile2 = create_fingerprint_profile(session_id=2, proxy=proxy2)

# 프록시별 다른 시드 → 다른 fingerprint 해시
print(profile1.get_fingerprint_hash())  # 예: c5958eb49c6b438f
print(profile2.get_fingerprint_hash())  # 예: a7b2c3d4e5f6a7b8
```

**Playwright 통합:**
```python
from stealth import inject_stealth_playwright, create_fingerprint_profile

profile = create_fingerprint_profile(session_id=1)
await inject_stealth_playwright(page, profile)
```

**SeleniumBase 통합:**
```python
from stealth import inject_stealth_selenium, create_fingerprint_profile

profile = create_fingerprint_profile(session_id=1)
inject_stealth_selenium(driver, profile)
```

---

## 🔧 통합 예시 (multi_session_runner.py)

```python
from stealth import create_fingerprint_profile, get_all_stealth_scripts
from captcha_solver import TurnstileSolver

async def run_session(session_id: int, proxy: dict):
    # 1. 세션별 fingerprint 생성
    profile = create_fingerprint_profile(
        session_id=session_id,
        proxy=proxy
    )
    
    # 2. 브라우저 시작 (SeleniumBase UC Mode)
    from seleniumbase import SB
    with SB(uc=True, proxy=proxy) as sb:
        # 3. 스텔스 스크립트 주입
        sb.execute_cdp_cmd('Page.addScriptToEvaluateOnNewDocument', {
            'source': get_all_stealth_scripts(profile)
        })
        
        # 4. 페이지 이동
        sb.open("https://tickets.interpark.com/...")
        
        # 5. Turnstile 해결
        from captcha_solver import solve_turnstile_sync
        token = solve_turnstile_sync(sb, session_id=session_id)
        
        if token:
            print(f"[S{session_id}] ✅ Turnstile 통과!")
```

---

## 📊 테스트 결과

```
Profile: c5958eb49c6b438f
UA: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/...
Script: 18037 chars
```

- stealth.py 구문 검증: ✅ 통과
- captcha_solver.py 구문 검증: ✅ 통과
- fingerprint 독립성: ✅ 세션별 다른 해시

---

## ⚠️ 주의사항

1. **CapSolver 크레딧**: 내장 API 키 사용 시 잔액 확인 필요
2. **프록시 필수**: IP 밴 방지를 위해 각 세션에 다른 프록시 할당
3. **타이밍**: Turnstile 해결에 10-60초 소요 → 티켓 오픈 전 미리 해결
4. **Rate Limit**: CapSolver는 동시 요청 제한 있음 (세션 수 고려)

---

## 🎯 다음 단계

1. [ ] 실제 인터파크 테스트
2. [ ] Turnstile 통과율 측정
3. [ ] 프록시 풀 최적화
4. [ ] 좌석 선택 로직 연동
