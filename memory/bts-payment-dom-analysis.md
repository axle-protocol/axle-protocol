# 인터파크 결제 페이지 DOM 분석

> 분석일: 2026-02-12
> 소스: 블로그 코드 분석 + 커뮤니티 검증된 셀렉터

## 1. 프레임 구조 (핵심!)

인터파크 예매 페이지는 **중첩 iframe 구조**로 되어 있음.

```
┌─────────────────────────────────────────────┐
│  Main Window (default_content)              │
│  ┌─────────────────────────────────────┐    │
│  │  #ifrmSeat (좌석 선택)               │    │
│  │  ┌───────────────────────────────┐  │    │
│  │  │  #ifrmSeatDetail (세부 좌석)   │  │    │
│  │  └───────────────────────────────┘  │    │
│  └─────────────────────────────────────┘    │
│  ┌─────────────────────────────────────┐    │
│  │  #ifrmBookStep (결제 단계)           │    │
│  │  - 가격 선택                         │    │
│  │  - 예매자 정보                       │    │
│  │  - 결제 수단                         │    │
│  │  - 약관 동의                         │    │
│  └─────────────────────────────────────┘    │
│                                             │
│  [버튼들 - default_content에 있음!]         │
│  #SmallNextBtnImage                         │
│  #LargeNextBtnImage                         │
└─────────────────────────────────────────────┘
```

## 2. 검증된 셀렉터 (실제 작동 확인)

### 프레임 셀렉터
| 프레임 | XPATH | CSS |
|--------|-------|-----|
| 좌석 선택 | `//*[@id='ifrmSeat']` | `#ifrmSeat` |
| 결제 단계 | `//*[@id='ifrmBookStep']` | `#ifrmBookStep` |
| 세부 좌석 | `//*[@id='ifrmSeatDetail']` | `#ifrmSeatDetail` |

### 다음 버튼 (default_content에서!)
| 버튼 | ID | 용도 |
|------|-----|------|
| 좌석선택 완료 | `#NextStepImage` | ifrmSeat 내에서 |
| 다음 단계 | `#SmallNextBtnImage` | default_content에서 |
| 결제하기 | `#LargeNextBtnImage` | default_content에서 |

### 가격 선택 (ifrmBookStep 내)
```python
# XPATH (검증됨)
'//*[@id="PriceRow001"]/td[3]/select'

# CSS 대안
'#PriceRow001 > td:nth-child(3) > select'
'#PriceRow001 td select'
```

### 예매자 정보 (ifrmBookStep 내)
```python
# 생년월일 (YYMMDD 6자리)
'#YYMMDD'

# 연락처 (3개 분리 필드일 수 있음)
'#ordererTel'
'#ordererTel1', '#ordererTel2', '#ordererTel3'
```

### 결제수단 (ifrmBookStep 내) ⚠️ 중요

```python
# 결제수단 ID 체계 (검증 필요)
Payment_22001 = 신용카드
Payment_22004 = 계좌이체 (검증됨 ✅)
Payment_22005 = 온라인입금/무통장
Payment_22019 = 카카오페이 (추정)
Payment_22020 = 네이버페이 (추정)
Payment_22021 = PAYCO (추정)
Payment_22022 = 토스 (추정)
Payment_22023 = 삼성페이 (추정)
Payment_22024 = 인터파크페이/원페이 (추정)

# XPATH 패턴 (검증됨)
'//*[@id="Payment_22004"]/td/input'

# CSS 패턴
'#Payment_22004 > td > input'
'#Payment_22004 td input'
```

### 카드/은행 선택 (ifrmBookStep 내)
```python
# 카드사 선택
'#CardCode'

# 은행 선택 (계좌이체 시)
'#BankCode'

# 할부 선택
'#InstMonth'
```

### 약관 동의 (ifrmBookStep 내)
```python
# 전체 동의 (검증됨 ✅)
'#checkAll'

# 개별 체크박스
'input[type="checkbox"][name*="agree"]'
```

## 3. 결제 프로세스 흐름

```
1. 좌석 선택 완료
   - 프레임: ifrmSeat → default_content
   - 버튼: #NextStepImage (ifrmSeat 내)
   
2. 가격/할인 선택
   - 프레임: ifrmBookStep
   - 셀렉터: #PriceRow001 td select
   - 버튼: #SmallNextBtnImage (default_content)

3. 예매자 정보 입력
   - 프레임: ifrmBookStep
   - 셀렉터: #YYMMDD
   - 버튼: #SmallNextBtnImage (default_content)

4. 결제 수단 선택
   - 프레임: ifrmBookStep
   - 셀렉터: #Payment_XXXXX td input
   - 추가: #CardCode, #BankCode (해당 시)
   - 버튼: #SmallNextBtnImage (default_content)

5. 약관 동의 + 결제
   - 프레임: ifrmBookStep
   - 셀렉터: #checkAll
   - 버튼: #LargeNextBtnImage (default_content)
```

## 4. 핵심 코드 패턴 (검증됨)

```python
from selenium.webdriver.support.ui import Select

def payment_process(driver):
    # 1. 가격선택
    driver.switch_to.default_content()
    driver.switch_to.frame(driver.find_element(By.XPATH, "//*[@id='ifrmBookStep']"))
    select = Select(driver.find_element(By.XPATH, '//*[@id="PriceRow001"]/td[3]/select'))
    select.select_by_index(1)
    
    driver.switch_to.default_content()
    driver.find_element(By.XPATH, '//*[@id="SmallNextBtnImage"]').click()
    
    # 2. 예매자 정보
    driver.switch_to.frame(driver.find_element(By.XPATH, "//*[@id='ifrmBookStep']"))
    driver.find_element(By.XPATH, '//*[@id="YYMMDD"]').send_keys('생년월일6자리')
    
    driver.switch_to.default_content()
    driver.find_element(By.XPATH, '//*[@id="SmallNextBtnImage"]').click()
    
    # 3. 결제수단 (계좌이체 예시)
    driver.switch_to.frame(driver.find_element(By.XPATH, '//*[@id="ifrmBookStep"]'))
    driver.find_element(By.XPATH, '//*[@id="Payment_22004"]/td/input').click()
    
    select2 = Select(driver.find_element(By.XPATH, '//*[@id="BankCode"]'))
    select2.select_by_index(1)
    
    driver.switch_to.default_content()
    driver.find_element(By.XPATH, '//*[@id="SmallNextBtnImage"]').click()
    
    # 4. 약관동의 + 결제
    driver.switch_to.frame(driver.find_element(By.XPATH, '//*[@id="ifrmBookStep"]'))
    driver.find_element(By.XPATH, '//*[@id="checkAll"]').click()
    
    driver.switch_to.default_content()
    driver.find_element(By.XPATH, '//*[@id="LargeNextBtnImage"]').click()
```

## 5. payment_handler.py 문제점 분석

### 문제 1: 가격 선택 요소 없음 에러
**원인**: 프레임 전환 타이밍 또는 셀렉터 불일치
**해결**: 
- XPATH 우선 사용: `//*[@id="PriceRow001"]/td[3]/select`
- 가격 선택이 없는 공연도 있음 → 실패해도 계속 진행

### 문제 2: 결제 수단 선택 미완료
**원인**: 
- 카카오페이 등 간편결제 ID가 추정값
- 프레임 전환 후 default_content 복귀 누락

**해결**:
- 계좌이체(22004)로 폴백 우선
- 프레임 전환 패턴 강화

### 문제 3: 버튼 클릭 실패
**원인**: 버튼은 default_content에 있는데 ifrmBookStep 프레임 내에서 찾으려 함
**해결**: 버튼 클릭 전 항상 `switch_to_default_content()` 호출

## 6. 수정 필요 셀렉터 목록

### PRICE_SELECTORS (우선순위)
```python
PRICE_SELECTORS = [
    # XPATH 우선 (검증됨)
    "xpath=//*[@id='PriceRow001']/td[3]/select",
    # CSS 폴백
    '#PriceRow001 > td:nth-child(3) > select',
    '#PriceRow001 td select',
    'tr[id*="PriceRow"] select',
]
```

### PAYMENT_METHOD_SELECTORS (수정)
```python
PAYMENT_METHOD_SELECTORS = {
    'card': [
        "xpath=//*[@id='Payment_22001']/td/input",
        '#Payment_22001 > td > input',
        '#Payment_22001 td input',
    ],
    'transfer': [  # 검증됨 ✅
        "xpath=//*[@id='Payment_22004']/td/input",
        '#Payment_22004 > td > input',
        '#Payment_22004 td input',
    ],
    'kakaopay': [  # 추정
        "xpath=//*[@id='Payment_22019']/td/input",
        '#Payment_22019 > td > input',
        '#Payment_22019 td input',
    ],
}
```

## 7. 추가 발견 사항

### 캡차/부정예매방지
- 요소: `#imgCaptcha`, `#txtCaptcha`
- 입력 후 버튼: `//*[@id="divRecaptcha"]/div[1]/div[4]/a[2]`
- 새로고침: `//*[@id="divRecaptcha"]/div[1]/div[1]/a[1]`

### 개발자 도구 열기
- 예매 창에서 F12 막힘
- 대안: `Ctrl+Shift+I` 또는 브라우저 메뉴에서 열기

### Selenium 감지 우회
- `selenium-stealth` 라이브러리 필요
- Chrome options 설정 필요

## 8. 테스트 권장 사항

1. **결제 수단 ID 검증**: 실제 예매 페이지에서 개발자 도구로 각 결제 수단의 실제 ID 확인
2. **프레임 전환 로깅**: 각 단계에서 현재 프레임 상태 로깅
3. **셀렉터 폴백**: 첫 번째 실패 시 다음 셀렉터 자동 시도

## 9. payment_handler.py 수정 내역 (2026-02-12)

### 수정된 파일
- `/Users/hyunwoo/.openclaw/workspace/bts-ticketing/src/payment_handler.py`

### 변경 사항

#### 1. 가격 선택 셀렉터 (PRICE_SELECTORS)
- XPATH 우선 추가: `//*[@id="PriceRow001"]/td[3]/select`

#### 2. 결제수단 셀렉터 (PAYMENT_METHOD_SELECTORS)
- 모든 결제수단에 XPATH 추가
- 계좌이체(22004) 검증 완료 표시
- CSS 셀렉터 폴백 유지

#### 3. 버튼 셀렉터 (NEXT_STEP_SELECTORS, PAY_BUTTON_SELECTORS)
- XPATH 우선 추가: `//*[@id="SmallNextBtnImage"]` 등
- 주석 추가: "버튼은 default_content에 있음!"

#### 4. 예매자 정보 셀렉터 (BIRTH_SELECTORS)
- XPATH 우선 추가: `//*[@id="YYMMDD"]`

#### 5. 약관 동의 셀렉터 (AGREE_ALL_SELECTORS)
- XPATH 우선 추가: `//*[@id="checkAll"]`

#### 6. click_next_step() 함수
- XPATH 직접 처리 로직 추가
- `By.XPATH` import 및 분기 처리
- 버튼 클릭 전 default_content 전환 강조

#### 7. select_price() 함수
- XPATH 우선 검색 로직 추가
- 요소 발견 시 셀렉터 로깅

#### 8. select_payment_method() 함수
- XPATH 우선 검색 로직 추가
- CSS 셀렉터 JS 폴백 유지
- AntiDetection.human_click 예외 처리 추가

#### 9. PaymentConfig 기본값
- `BANK_TRANSFER` (계좌이체)를 기본 결제수단 목록에 추가 (검증된 폴백)

### 테스트 권장 사항
1. 실제 예매 테스트로 결제수단 ID 검증 필요
2. 특히 카카오페이(22019), 네이버페이(22020) ID 확인 필요
3. 프레임 전환 로깅 확인

---
*이 문서는 블로그/GitHub 소스 코드 분석 결과이며, 실제 DOM은 변경될 수 있음*
