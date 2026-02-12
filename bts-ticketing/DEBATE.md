# DEBATE.md — 토론 규칙 🗣️

## 개요
코드 문제 또는 기술적 장애물 발견 시, **여러 최신 AI 모델에게 딥추론 리뷰**를 받아 최적의 해결책을 도출하는 프로세스.

---

## 토론 발동 조건

1. **테스트 실패** — 예상대로 작동하지 않을 때
2. **기술적 장벽** — 우회/해결 방법이 불명확할 때
3. **설계 결정** — 여러 방법 중 선택이 필요할 때
4. **성능 최적화** — 더 나은 방법이 있을 수 있을 때

---

## 토론 프로세스

### 1단계: 문제 정의
```
- 현재 상황 (코드, 에러 메시지)
- 기대 결과
- 실제 결과
```

### 2단계: 토론 의회 소집
```python
# 최소 2개 모델에게 동시 질문
sessions_spawn(
    task="문제 설명 + 질문",
    model="openai/o3",
    thinking="high",
    label="o3-review"
)
sessions_spawn(
    task="동일 질문",
    model="anthropic/claude-opus-4-6",
    thinking="high", 
    label="opus-review"
)
```

### 3단계: 결과 종합
- 공통점 추출 → **핵심 해결책**
- 차이점 분석 → 추가 고려사항
- 실행 가능한 코드 도출

### 4단계: 적용 및 테스트
- 코드 수정
- 테스트 실행
- 결과 기록

---

## 토론 모델 풀 (2026-02 기준)

| 모델 | 용도 | 강점 |
|------|------|------|
| `openai/o3` | 추론, 분석 | 깊은 사고, 웹 리서치 |
| `anthropic/claude-opus-4-6` | 코드, 분석 | 상세한 설명, 코드 예시 |
| `openai/codex-5.2` | 코드 생성 | 코드 특화 |

---

## 토론 로그

### 2026-02-12: Turnstile 토큰 주입 문제
- **문제:** CapSolver 토큰 획득 성공, 주입 후 버튼 비활성화
- **토론:** O3 + Opus 4.6 (딥추론 high)
- **공통 결론:** `add_init_script`로 콜백 인터셉트 필요
- **결과:** ✅ 로그인 성공!

---

## 규칙

1. **토론은 딥추론 모드(thinking: high)로**
2. **웹 리서치 포함** — 최신 정보 반영
3. **최소 2개 모델** — 단일 모델 편향 방지
4. **결과 문서화** — 나중에 참고
5. **테스트로 검증** — 토론 결과 적용 후 반드시 테스트

---

*"혼자 생각하지 말고, 의회를 열어라"* 🏛️

---

### 2026-02-12: 야놀자 SSO 리다이렉트 + 예매 버튼 문제

#### 🔍 문제 요약
| 문제 | 상태 | 심각도 |
|------|------|--------|
| 야놀자 로그인 후 예매 클릭 시 재로그인 요구 | 🔴 Critical | P0 |
| 모달 pointer intercept (backdrop 차단) | 🟡 해결됨 | P2 |
| 예매 버튼 `href="#"` (JS 이벤트만 작동) | 🟡 부분해결 | P1 |

#### 🏗️ 인터파크-야놀자 SSO 구조 분석

```
┌─────────────────────────────────────────────────────────────────┐
│                    NOL Universe (야놀자 플랫폼)                    │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────┐ │
│  │ accounts.       │    │ nol.interpark.  │    │ tickets.    │ │
│  │ yanolja.com     │◄──►│ com/ticket      │◄──►│interpark.com│ │
│  │ (중앙 인증)      │    │ (신규 UI)       │    │ (레거시)     │ │
│  └─────────────────┘    └─────────────────┘    └─────────────┘ │
│         │                       │                     │         │
│         ▼                       ▼                     ▼         │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │              쿠키 도메인: .yanolja.com (공유)               ││
│  │              쿠키 도메인: .interpark.com (별도)             ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
```

**핵심 발견:**
1. `accounts.yanolja.com` = 중앙 OAuth2 인증 서버
2. `.yanolja.com` 쿠키는 `nol.interpark.com`에서 접근 불가 (다른 도메인)
3. 로그인 성공 시 `redirect` 파라미터로 `accounts.interpark.com/login/success/nol`로 리다이렉트
4. 이 과정에서 `interpark.com` 도메인에 세션 쿠키 설정

#### ❌ 문제 원인

**1. 크로스 도메인 쿠키 동기화 실패**
```
로그인 플로우:
accounts.yanolja.com → 로그인 성공 
                     → accounts.interpark.com/login/success/nol
                     → nol.interpark.com/ticket (쿠키 설정됨)

예매 플로우:
tickets.interpark.com/goods/XXX → 예매 클릭
                                → 세션 확인 (interpark.com 쿠키)
                                → ❌ 세션 없음 → 재로그인 요구
```

**2. 레거시 vs 신규 도메인 충돌**
- `nol.interpark.com` (신규) ≠ `tickets.interpark.com` (레거시)
- 같은 `.interpark.com` 도메인이지만 서브도메인별 세션 격리

**3. 예매 버튼 JavaScript 이벤트**
```html
<a class="sideBtn is-primary" href="#">예매하기</a>
```
- `href="#"`는 페이지 이동 없음
- JavaScript `onclick` 핸들러가 모달/팝업 열기 담당
- Playwright의 `.click()`이 이벤트 버블링 문제로 실패 가능

#### ✅ 해결 전략 (3가지 방안)

##### 방안 1: Storage State 재사용 (권장) ⭐
```python
# 1. 로그인 후 상태 저장
login_url = "https://accounts.yanolja.com/signin/email?clientId=ticket-pc&..."
page.goto(login_url)
# ... 로그인 수행 ...

# 세션 저장 (쿠키 + localStorage)
context.storage_state(path="auth_state.json")

# 2. 새 세션에서 상태 복원
context = browser.new_context(storage_state="auth_state.json")
page = context.new_page()
page.goto("https://tickets.interpark.com/goods/XXX")  # 로그인 유지됨
```

##### 방안 2: 수동 쿠키 복사
```python
# 로그인 후 모든 쿠키 수집
all_cookies = context.cookies()

# interpark.com 도메인 쿠키 필터링 및 복사
for cookie in all_cookies:
    if "yanolja" in cookie["domain"] or "interpark" in cookie["domain"]:
        # 서브도메인에도 적용되도록 수정
        if cookie["domain"].startswith("."):
            continue  # 이미 와일드카드
        cookie["domain"] = "." + cookie["domain"].lstrip(".")
        context.add_cookies([cookie])
```

##### 방안 3: nol.interpark.com 도메인 유지
```python
# tickets.interpark.com 대신 nol 도메인 사용
CONCERT_URL = "https://nol.interpark.com/ticket/goods/XXX"  # ← 변경

# 또는 goods URL 변환
def convert_to_nol_url(tickets_url):
    """tickets.interpark.com → nol.interpark.com 변환"""
    if "tickets.interpark.com" in tickets_url:
        goods_id = re.search(r'/goods/(\d+)', tickets_url).group(1)
        return f"https://nol.interpark.com/ticket/goods/{goods_id}"
    return tickets_url
```

#### 🔧 예매 버튼 클릭 개선

```python
def click_booking_button_improved(self) -> bool:
    """개선된 예매 버튼 클릭"""
    
    # 방법 1: JavaScript 이벤트 직접 트리거
    clicked = self.page.evaluate('''() => {
        const btn = document.querySelector('a.sideBtn.is-primary');
        if (btn) {
            // 1. 네이티브 클릭 이벤트
            const clickEvent = new MouseEvent('click', {
                bubbles: true,
                cancelable: true,
                view: window
            });
            btn.dispatchEvent(clickEvent);
            
            // 2. onclick 핸들러 직접 호출
            if (typeof btn.onclick === 'function') {
                btn.onclick();
            }
            
            return true;
        }
        return false;
    }''')
    
    if clicked:
        # 팝업 대기
        try:
            with self.page.expect_popup(timeout=10000) as popup_info:
                pass  # 이미 클릭됨
            self.booking_page = popup_info.value
            return True
        except:
            pass
    
    # 방법 2: force=True + 좌표 클릭
    btn = self.page.locator('a.sideBtn.is-primary:has-text("예매하기")').first
    if btn.is_visible():
        box = btn.bounding_box()
        if box:
            # 정확한 중앙 클릭
            self.page.mouse.click(
                box['x'] + box['width'] / 2,
                box['y'] + box['height'] / 2
            )
            return True
    
    return False
```

#### 📋 추천 구현 순서

1. **즉시 적용**: `nol.interpark.com` 도메인으로 URL 변환 (방안 3)
2. **중기 개선**: `storage_state` 저장/복원 추가 (방안 1)
3. **장기 보완**: 쿠키 동기화 유틸리티 (방안 2)

#### 🧪 테스트 체크리스트

- [ ] `--login-only` 테스트 후 `auth_state.json` 생성 확인
- [ ] nol.interpark.com 도메인에서 예매 버튼 클릭 테스트
- [ ] 팝업 창 감지 및 핸들링 확인
- [ ] 대기열 → 좌석선택 플로우 정상 동작 확인

#### 📚 참고 자료

- [Playwright Authentication Docs](https://playwright.dev/docs/auth)
- [Cross-domain Cookie Sharing](https://scrapingant.com/blog/playwright-set-cookies)
- [SSO Redirect Handling](https://www.checklyhq.com/docs/learn/playwright/authentication/)

---

## 2026-02-12: 야놀자 SSO 리다이렉트 문제 (Opus 토론 의원)

### 🔴 문제 정의

**현재 상황:**
```
1. 인터파크 계정으로 accounts.yanolja.com 로그인 성공 ✅
2. 공연 상세 페이지(tickets.interpark.com/goods/...) 접속 ✅  
3. "예매하기" 버튼 클릭 → accounts.yanolja.com 으로 리다이렉트 ❌
```

**추가 발견:**
- `<html lang="ko">` 요소가 모든 클릭을 가로챔 (모달 백드롭)
- 예매 버튼: `<a class="sideBtn is-primary" href="#">예매하기</a>` (JS 이벤트만)

---

### 🔍 SSO 구조 분석

**야놀자-인터파크 NOL 통합 구조:**

```
┌─────────────────────────────────────────────────────────┐
│                  accounts.yanolja.com                    │
│                   (중앙 인증 서버)                        │
│                                                          │
│  ┌──────────────┐    ┌──────────────┐    ┌────────────┐ │
│  │ 야놀자 앱     │    │ NOL 통합     │    │ 인터파크   │ │
│  │ nol.yanolja  │    │ nol.interpark│    │ tickets.   │ │
│  └──────────────┘    └──────────────┘    └────────────┘ │
└─────────────────────────────────────────────────────────┘
```

**로그인 URL 분석:**
```
https://accounts.yanolja.com/signin/email
  ?clientId=ticket-pc              ← 인터파크 티켓 클라이언트
  &postProc=FULLSCREEN
  &origin=https://nol.interpark.com/ticket
  &service=interpark-ticket
```

**핵심 발견:**
1. `clientId=ticket-pc` → 인터파크 티켓 전용 세션
2. 야놀자 계정으로 로그인해도 **서비스별 세션 토큰**이 별도 발급됨
3. 예매 시 추가 인증 필요 → **티켓 구매 전용 세션** 요구

---

### 🎯 리다이렉트 원인 분석

**가설 1: 세션 토큰 스코프 불일치** ⭐ 유력
```
로그인 시: clientId=ticket-pc → 조회용 세션
예매 시: 구매용 세션 필요 → accounts.yanolja.com 리다이렉트
```

**가설 2: 쿠키 도메인 분리**
```
accounts.yanolja.com  → 인증 쿠키
nol.interpark.com     → 서비스 쿠키 (전파 안됨?)
tickets.interpark.com → 구매 쿠키 (별도 필요)
```

**가설 3: 예매 버튼 JS 로직**
```javascript
// 예매 버튼 클릭 시 내부 로직 (추정)
onClick: async () => {
  const authCheck = await checkPurchaseAuth();
  if (!authCheck.valid) {
    window.location.href = accounts.yanolja.com + '?returnUrl=...';
  }
}
```

---

### 💡 해결 전략 옵션

#### 옵션 A: 야놀자 계정 사전 연동 (최우선 ⭐)

**방법:** 인터파크 계정이 야놀자 NOL 계정과 연동되어 있는지 확인
```
1. https://nol.yanolja.com 접속
2. 마이페이지 → 계정 설정 → 연동 서비스 확인
3. "인터파크 티켓" 연동 활성화
```

**장점:** 한 번 설정하면 영구 해결
**단점:** 수동 설정 필요, 사용자마다 다름

---

#### 옵션 B: 동적 리다이렉트 처리 (코드 수정)

```python
def handle_yanolja_redirect(self) -> bool:
    """야놀자 리다이렉트 감지 및 재로그인"""
    
    for _ in range(30):  # 30초 대기
        current_url = self.page.url.lower()
        
        # 야놀자 로그인 페이지 감지
        if 'accounts.yanolja.com' in current_url:
            self._log('🔄 야놀자 재인증 필요 - 로그인 처리...')
            
            # 이미 입력 필드가 있으면 재로그인
            try:
                email_input = self.page.locator('input[name="email"]')
                if email_input.is_visible(timeout=3000):
                    return self._perform_login()
            except:
                pass
            
            # 자동 리다이렉트 대기 (이미 세션 있으면)
            adaptive_sleep(2)
            continue
        
        # 예매 페이지 도달 확인
        if 'book' in current_url or 'seat' in current_url:
            return True
        
        adaptive_sleep(1)
    
    return False
```

**장점:** 자동화 가능
**단점:** 2중 로그인 시간 소요

---

#### 옵션 C: 쿠키 사전 주입

```python
def inject_yanolja_cookies(self):
    """야놀자 쿠키를 사전에 주입"""
    
    # 1. 먼저 야놀자 도메인 방문
    self.page.goto('https://nol.yanolja.com', wait_until='domcontentloaded')
    
    # 2. 로그인 후 쿠키 저장
    cookies = self.context.cookies()
    
    # 3. 인터파크 도메인에도 쿠키 복사 (가능한 경우)
    for cookie in cookies:
        if 'yanolja' in cookie.get('domain', ''):
            # 관련 쿠키 저장
            pass
```

**장점:** 세션 공유 가능
**단점:** 쿠키 구조 분석 필요

---

#### 옵션 D: 야놀자에서 시작 (완전한 플로우)

```python
# 인터파크가 아닌 NOL 야놀자에서 시작
LOGIN_BASE = 'https://nol.yanolja.com'  # 변경

def login_via_yanolja(self):
    """야놀자 NOL에서 로그인 후 인터파크로 이동"""
    
    # 1. 야놀자 NOL 로그인
    self.page.goto('https://nol.yanolja.com')
    # 로그인 버튼 클릭 → accounts.yanolja.com
    # ... 로그인 수행 ...
    
    # 2. 인터파크 티켓으로 이동
    self.page.goto('https://nol.interpark.com/ticket')
    
    # 3. 공연 페이지로 이동
    self.page.goto(self.config.url)
```

**장점:** 완전한 세션 획득
**단점:** 플로우 복잡

---

### 📋 권장 실행 계획

```
1. [즉시] 옵션 A 확인 - 계정 연동 상태 체크
   └── 연동 안되어 있으면 수동 연동

2. [코드] 옵션 B 구현 - 동적 리다이렉트 처리
   └── click_booking_button() 이후 handle_yanolja_redirect() 호출

3. [폴백] 옵션 D - 야놀자에서 시작하는 플로우
   └── 옵션 B 실패 시 적용
```

---

### 🔧 모달/버튼 문제 해결 (이미 적용됨)

```python
# force=True로 모달 백드롭 우회
modal_btn.click(force=True, timeout=5000)

# JavaScript로 직접 클릭 (href="#" 버튼)
self.page.evaluate('''
    var links = document.querySelectorAll('a, button');
    for (var link of links) {
        if (link.textContent && link.textContent.includes('예매')) {
            link.click();
            break;
        }
    }
''')
```

---

### ✅ 다음 액션

1. **테스트:** `--login-only` 후 수동으로 예매 버튼 클릭 → 리다이렉트 URL 확인
2. **분석:** 리다이렉트 URL의 `returnUrl` 파라미터 확인
3. **구현:** `handle_yanolja_redirect()` 함수 추가
4. **검증:** 전체 플로우 테스트

---

*토론 완료: 2026-02-12 12:08 KST*

---

## 2026-02-12 13:00 KST: Codex 토론 의원 - 종합 코드 리뷰

### 📊 현재 상태 요약

| 단계 | 상태 | 비고 |
|------|------|------|
| 1. 로그인 | ✅ 완료 | CapSolver Turnstile ~5초 |
| 2. 모달 닫기 | ✅ 완료 | JS 제거 방식 |
| 3. 예매하기 클릭 | ✅ 완료 | force=True + JS 클릭 |
| 4. 야놀자 리다이렉트 | ⚠️ 감지 | 서버 점검 중 테스트 불가 |
| 5. 야놀자 로그인 | ⏳ 미완료 | 대기 중 |

---

### 🏗️ 질문 1: 코드 구조 개선점

#### 현재 구조 평가

**👍 장점:**
- 잘 정의된 클래스 구조 (`NOLTicketing`, `TicketingConfig`, `SeatInfo`)
- 타입 힌팅 활용 (`Optional`, `List`, `Dict`)
- 상수 분리 (셀렉터, URL 패턴)
- 재시도 로직 내장 (`max_retries`)
- Stealth 모드 + CapSolver 통합

**👎 개선 필요:**

#### 1. 거대 단일 파일 문제 (1807줄)
```
현재: main_playwright.py (모든 로직)
권장: 
├── src/
│   ├── config.py          # TicketingConfig, 환경변수
│   ├── browser.py          # 브라우저 시작/종료, Stealth
│   ├── auth/
│   │   ├── login.py        # 로그인 로직
│   │   ├── turnstile.py    # CapSolver, 캡챠 처리
│   │   └── yanolja_sso.py  # 야놀자 SSO 처리
│   ├── booking/
│   │   ├── navigation.py   # 페이지 이동
│   │   ├── seat_finder.py  # 좌석 검색
│   │   ├── seat_selector.py # 좌석 선택
│   │   └── payment.py      # 결제 처리
│   ├── selectors.py        # 모든 CSS/XPath 셀렉터
│   └── utils.py            # 로깅, 딜레이, 유틸리티
```

#### 2. 중복 패턴 제거
```python
# ❌ 현재: 반복되는 패턴
seat_frame = self._get_seat_frame()
target = seat_frame if seat_frame else self.page

# ✅ 권장: 데코레이터 또는 컨텍스트 매니저
@with_frame('seat')
def find_available_seats(self, target):
    # target이 자동으로 올바른 프레임/페이지
    pass

# 또는
with self.frame_context('seat') as target:
    elements = target.locator(selector).all()
```

#### 3. 예외 처리 구체화
```python
# ❌ 현재: bare except
except:
    continue

# ✅ 권장: 구체적 예외 + 로깅
except PlaywrightTimeout as e:
    self._log(f'타임아웃: {selector}', LogLevel.DEBUG)
except Exception as e:
    self._log(f'예외: {type(e).__name__}: {e}', LogLevel.WARN)
```

#### 4. 설정 주입 패턴
```python
# ❌ 현재: 전역 변수
USER_ID = os.getenv('INTERPARK_ID', '')
CAPSOLVER_KEY = os.getenv('CAPSOLVER_API_KEY', '')

# ✅ 권장: Config 객체에 통합
@dataclass
class AuthConfig:
    user_id: str
    user_pw: str
    birth_date: str
    capsolver_key: Optional[str] = None
    
    @classmethod
    def from_env(cls):
        return cls(
            user_id=os.getenv('INTERPARK_ID', ''),
            user_pw=os.getenv('INTERPARK_PWD', ''),
            ...
        )
```

---

### 🔐 질문 2: 야놀자 SSO 우회 방법

#### 핵심 문제

```
인터파크 로그인 → 야놀자 accounts → 인터파크 리다이렉트
                ↑
          여기서 세션 토큰 스코프가 "조회용"만 발급됨
          예매 시 "구매용" 세션 필요 → 재로그인 요구
```

#### 해결책 우선순위

##### ⭐ 방법 1: Storage State 완전 활용 (최우선)
```python
class NOLTicketing:
    AUTH_STATE_PATH = 'auth_state.json'
    
    def start_browser(self, playwright) -> bool:
        # 기존 세션 복원 시도
        storage_state = None
        if Path(self.AUTH_STATE_PATH).exists():
            storage_state = self.AUTH_STATE_PATH
            self._log('📦 기존 세션 복원 중...')
        
        self.context = self.browser.new_context(
            storage_state=storage_state,
            **context_options
        )
        
        # 세션 유효성 검사
        if storage_state:
            self.page = self.context.new_page()
            if self._verify_session():
                self._log('✅ 세션 유효!', LogLevel.SUCCESS)
                self.logged_in = True
                return True
            else:
                self._log('⚠️ 세션 만료, 재로그인 필요')
        
        return True
    
    def _verify_session(self) -> bool:
        """세션 유효성 검사"""
        self.page.goto('https://nol.interpark.com/mypage', 
                       wait_until='commit', timeout=10000)
        return 'signin' not in self.page.url.lower()
    
    def login(self) -> bool:
        # ... 로그인 로직 ...
        
        # 🔑 로그인 성공 후 세션 저장
        if success:
            self.context.storage_state(path=self.AUTH_STATE_PATH)
            self._log('💾 세션 저장 완료')
        
        return success
```

##### 방법 2: 야놀자 → 인터파크 플로우 (SSO 완전 통과)
```python
def login_full_sso(self) -> bool:
    """야놀자 NOL에서 시작하는 완전한 SSO 플로우"""
    
    # Step 1: 야놀자 NOL 홈에서 로그인 시작
    self.page.goto('https://nol.yanolja.com')
    login_btn = self.page.locator('text=로그인, a[href*="signin"]').first
    login_btn.click()
    
    # Step 2: accounts.yanolja.com에서 로그인
    # (기존 로직과 동일)
    
    # Step 3: 로그인 후 야놀자 NOL 복귀 확인
    self.page.wait_for_url('**/nol.yanolja.com/**', timeout=30000)
    
    # Step 4: 인터파크 티켓으로 이동 (세션 전파)
    self.page.goto('https://nol.interpark.com/ticket')
    adaptive_sleep(3)
    
    # Step 5: 실제 공연 페이지로 이동
    self.page.goto(self.config.url)
    
    return self._verify_login()
```

##### 방법 3: Persistent Context (브라우저 프로필)
```python
def start_browser_persistent(self, playwright) -> bool:
    """브라우저 프로필 유지 (세션 영구 보존)"""
    
    # 기존 프로필 디렉토리 사용
    user_data_dir = './browser_profile'
    
    self.context = playwright.chromium.launch_persistent_context(
        user_data_dir=user_data_dir,
        headless=self.config.headless,
        viewport={'width': 1280, 'height': 900},
        locale='ko-KR',
        # ... 기타 옵션
    )
    
    self.page = self.context.pages[0] if self.context.pages else self.context.new_page()
    
    # 이미 로그인되어 있는지 확인
    self.page.goto('https://nol.interpark.com/ticket')
    if self._verify_login():
        self._log('✅ 기존 브라우저 세션 유효!')
        self.logged_in = True
    
    return True
```

##### 방법 4: 리다이렉트 체인 처리 (현재 코드 개선)
```python
def handle_yanolja_redirect(self) -> bool:
    """야놀자 리다이렉트 체인 완전 처리"""
    
    max_redirects = 5
    for i in range(max_redirects):
        current_url = self.page.url.lower()
        self._log(f'🔄 URL 체크 [{i+1}]: {current_url[:60]}...')
        
        # 1. 야놀자 로그인 페이지
        if 'accounts.yanolja.com/signin' in current_url:
            self._log('🔐 야놀자 재로그인 필요')
            
            # 이메일로 시작하기 → 이메일/비번 입력
            email_start = self.page.locator('text=이메일로 시작하기')
            if email_start.is_visible(timeout=3000):
                email_start.click()
                adaptive_sleep(1)
            
            # 로그인 폼 처리
            self._fill_login_form()
            self._handle_turnstile()
            
            submit = self.page.locator('button[type="submit"]')
            submit.click()
            adaptive_sleep(5)
            continue
        
        # 2. 야놀자 메인 (이미 로그인됨)
        elif 'nol.yanolja.com' in current_url and 'signin' not in current_url:
            self._log('✅ 야놀자 로그인 완료, 인터파크로 이동...')
            self.page.goto(self.config.url)
            adaptive_sleep(3)
            continue
        
        # 3. 인터파크 예매 페이지
        elif any(kw in current_url for kw in ['book', 'seat', 'onestop', 'tickets.interpark']):
            self._log('✅ 예매 페이지 도달!')
            return True
        
        # 4. 알 수 없는 페이지
        else:
            self._log(f'⚠️ 알 수 없는 페이지: {current_url[:80]}')
            adaptive_sleep(2)
    
    self._log('❌ 리다이렉트 처리 실패', LogLevel.ERROR)
    return False
```

---

### ⚡ 질문 3: 속도 최적화 포인트

#### 1. 네트워크 레벨 최적화

```python
def start_browser_optimized(self, playwright) -> bool:
    """속도 최적화된 브라우저 설정"""
    
    self.context = self.browser.new_context(
        # ... 기존 옵션 ...
    )
    
    # 🚀 불필요한 리소스 차단
    async def block_resources(route, request):
        blocked = ['image', 'stylesheet', 'font', 'media']
        if request.resource_type in blocked:
            await route.abort()
        else:
            await route.continue_()
    
    # 예매 페이지에서만 차단 (로그인 시에는 필요할 수 있음)
    # self.page.route('**/*', block_resources)
    
    # 🚀 더 빠른 로딩 대기
    self.context.set_default_timeout(15000)  # 30초 → 15초
    
    return True

def navigate_fast(self, url: str) -> bool:
    """최소 대기 네비게이션"""
    
    # domcontentloaded 대신 commit (첫 응답 직후)
    self.page.goto(url, wait_until='commit', timeout=10000)
    
    # 필요한 요소만 대기
    self.page.wait_for_selector('a.sideBtn', timeout=5000)
    
    return True
```

#### 2. 코드 레벨 최적화

```python
# ❌ 현재: 순차적 셀렉터 시도
for selector in self.SEAT_SELECTORS:
    try:
        elements = target.locator(selector).all()
        ...

# ✅ 권장: 복합 셀렉터 (한 번에)
COMBINED_SEAT_SELECTOR = ', '.join([
    "circle[class*='st'][fill]:not([fill*='gray'])",
    "circle[class*='seat'][class*='available']",
    "[data-seat-status='available']"
])

elements = target.locator(COMBINED_SEAT_SELECTOR).all()
```

```python
# ❌ 현재: 과도한 대기
adaptive_sleep(3)  # 캡챠 처리 대기
adaptive_sleep(2)  # 버튼 클릭 후

# ✅ 권장: 조건부 대기
self.page.wait_for_function('''() => {
    const btn = document.querySelector('button[type="submit"]');
    return btn && !btn.disabled;
}''', timeout=10000)
```

#### 3. 예매 타이밍 최적화

```python
def prepare_for_booking(self):
    """예매 시간 직전 준비"""
    
    # 1. 예매 버튼 요소 사전 탐지
    self.booking_btn = self.page.locator('a.sideBtn.is-primary')
    
    # 2. 클릭 좌표 미리 계산
    box = self.booking_btn.bounding_box()
    self.click_x = box['x'] + box['width'] / 2
    self.click_y = box['y'] + box['height'] / 2
    
    # 3. JavaScript 실행 준비
    self.page.evaluate('''() => {
        window._quickClick = function() {
            var btn = document.querySelector('a.sideBtn.is-primary');
            if (btn) btn.click();
        }
    }''')

def instant_click(self):
    """최소 지연 클릭"""
    self.page.evaluate('window._quickClick()')
```

#### 4. 병렬 처리 (Async 전환)

```python
# 📈 비동기 버전 (향후 전환 권장)
import asyncio
from playwright.async_api import async_playwright

async def select_seats_parallel(self):
    """여러 구역 동시 검색"""
    
    zones = ['스탠딩A', '스탠딩B', 'VIP']
    
    async def check_zone(zone):
        # 병렬로 각 구역 확인
        seats = await self.find_seats_in_zone(zone)
        return (zone, seats)
    
    results = await asyncio.gather(*[check_zone(z) for z in zones])
    
    # 가장 좋은 좌석 선택
    best = max(results, key=lambda r: len(r[1]))
    return best
```

#### 5. 프리페칭 전략

```python
def prefetch_booking_page(self):
    """예매 페이지 DOM 미리 캐싱"""
    
    # 예매 버튼 href 추출 (팝업 URL)
    href = self.page.evaluate('''() => {
        var btn = document.querySelector('a.sideBtn.is-primary');
        return btn ? btn.getAttribute('onclick') : null;
    }''')
    
    # URL 추출 후 새 탭에서 미리 로드 (숨김)
    if 'window.open' in (href or ''):
        popup_url = re.search(r"window\.open\('([^']+)'", href).group(1)
        # 백그라운드 탭에서 미리 로드
        prefetch_page = self.context.new_page()
        prefetch_page.goto(popup_url, wait_until='commit')
```

---

### 📊 속도 비교 예상

| 구간 | 현재 | 최적화 후 |
|------|------|----------|
| 브라우저 시작 | ~3초 | ~2초 |
| 로그인 | ~10초 | ~7초 (캐시된 세션: 0초) |
| 페이지 네비게이션 | ~5초 | ~2초 (commit 대기) |
| 예매 버튼 클릭 | ~1초 | ~0.1초 (사전 캐싱) |
| 좌석 검색 | ~3초 | ~1초 (복합 셀렉터) |
| **총합** | **~22초** | **~12초 (첫 실행) / ~5초 (세션 유지)** |

---

### ✅ 즉시 적용 권장 사항

1. **세션 저장/복원 추가** (`storage_state`)
2. **복합 셀렉터로 변경** (셀렉터 순회 제거)
3. **`wait_until='commit'`** 사용 (네트워크 대기 감소)
4. **사전 클릭 준비** (좌표 미리 계산)
5. **야놀자 리다이렉트 핸들러 완성** (`handle_yanolja_redirect`)

---

### 🔮 장기 로드맵

1. **모듈 분리** (유지보수성)
2. **Async 전환** (병렬 처리)
3. **멀티 계정 병렬 실행** (성공률 증가)
4. **실패 자동 복구** (브라우저 크래시 시 재시작)

---

*Codex 토론 의원 리뷰 완료: 2026-02-12 13:00 KST*
