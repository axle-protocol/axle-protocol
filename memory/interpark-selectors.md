# 인터파크 티켓 예매 셀렉터 조사
> 조사일: 2026-02-11
> 상태: 웹 검색 기반 정보 (실제 테스트 필요)

## ⚠️ 주의사항
- 인터파크는 셀레니움 감지 시스템이 있음 (`selenium-stealth` 필요)
- 사이트 구조가 자주 변경되므로 셀렉터 검증 필수
- 2024년 12월 서버 개편 이후 일부 구조 변경됨
- NOL 티켓으로 리브랜딩됨 (tickets.interpark.com)

---

## 1. 로그인 페이지

### URL
```
https://ticket.interpark.com/Gate/TPLogin.asp
```

### 구조
- 로그인 폼이 **iframe** 내부에 있음 → 프레임 전환 필수

### 셀렉터
| 요소 | 셀렉터 | 비고 |
|------|--------|------|
| 로그인 iframe | `iframe[title='login']` 또는 첫 번째 iframe | 클래스: leftLoginBox 하위 |
| 아이디 입력 | `#userId` | ID 속성 |
| 비밀번호 입력 | `#userPwd` | ID 속성 |
| 로그인 버튼 | `#btn_login` | ID 속성 |

### 예시 코드
```python
# iframe 전환
driver.switch_to.frame(driver.find_element(By.TAG_NAME, "iframe"))
# 또는
driver.switch_to.frame(driver.find_element(By.XPATH, "//div[@class='leftLoginBox']/iframe[@title='login']"))

# 로그인
driver.find_element(By.ID, "userId").send_keys("아이디")
driver.find_element(By.ID, "userPwd").send_keys("비밀번호")
driver.find_element(By.ID, "btn_login").click()
```

---

## 2. 공연 상세 페이지

### URL 패턴
```
https://tickets.interpark.com/goods/{GoodsCode}
예: https://tickets.interpark.com/goods/L0000062
```

### 셀렉터
| 요소 | 셀렉터 | 비고 |
|------|--------|------|
| 예매하기 버튼 | `a.sideBtn.is-primary` | CSS 클래스 |
| 예매하기 버튼 (XPath) | `//*[@id="productSide"]/div/div[2]/a[1]` | |
| 현재 월 표시 | `//*[@id='productSide']/div/div[1]/div[1]/div[2]/div/div/div/div/ul[1]/li[2]` | "2024년 1월" 형식 |
| 다음 달 버튼 | `//*[@id='productSide']/div/div[1]/div[1]/div[2]/div/div/div/div/ul[1]/li[3]` | 달력 넘기기 |
| 날짜 선택 | `//li[text()='{일}']` | 동적 XPath |
| 회차 선택 | `.timeTableItem` | 클래스명 (리스트) |

### 예시 코드
```python
# 날짜 선택
find_day = driver.find_element(By.XPATH, f"//li[text()='{want_day}']")
find_day.click()

# 회차 선택 (1회차=0, 2회차=1)
turn_list = driver.find_elements(By.CLASS_NAME, "timeTableItem")
turn_list[want_turn - 1].click()

# 예매하기 버튼 클릭
go_button = driver.find_element(By.CSS_SELECTOR, "a.sideBtn.is-primary")
go_button.click()
```

---

## 3. 예매 팝업창 (좌석 선택)

### 구조
예매 팝업은 **새 창**으로 열리며, 여러 **중첩 iframe** 구조:
```
body
├── divBookMain (메인 영역)
├── divBookSeat (좌석 선택 영역)
│   └── iframe#ifrmSeat (메인 프레임)
│       ├── iframe#ifrmSeatDetail (좌석 상세 선택)
│       └── iframe#ifrmSeatView (미니맵)
└── iframe#ifrmBookStep (예매 단계 진행)
```

### 창 전환
```python
# 새 창으로 전환
main_window = driver.current_window_handle
all_windows = driver.window_handles
new_window = [h for h in all_windows if h != main_window][0]
driver.switch_to.window(new_window)
```

### iframe 셀렉터
| iframe | 셀렉터 | 용도 |
|--------|--------|------|
| 좌석 메인 | `#ifrmSeat` 또는 `name="ifrmSeat"` | 좌석 선택 영역 |
| 좌석 상세 | `#ifrmSeatDetail` | 실제 좌석 클릭 |
| 좌석 미니맵 | `#ifrmSeatView` | 구역 선택 미니맵 |
| 예매 단계 | `#ifrmBookStep` | 결제 진행 |

### 좌석 관련 셀렉터
| 요소 | 셀렉터 | 비고 |
|------|--------|------|
| 가용 좌석 이미지 | `//img[@class='stySeat']` | 클릭 가능한 좌석 |
| 좌석 등급 선택 | `//*[@id="GradeRow"]/td[1]/div/span[2]` | 등급별 |
| 세부 구역 선택 | `//*[@id="GradeDetail"]/div/ul/li[1]/a` | 첫 번째 구역 |
| 좌석 선택 완료 버튼 | `#NextStepImage` | ID |
| 미니맵 구역 | `//*[@id='TmgsTable']/tbody/tr/td/map` | 구역 이동 |

### 부정예매 방지 (캡차)
| 요소 | 셀렉터 | 비고 |
|------|--------|------|
| 캡차 이미지 | `#imgCaptcha` | 이미지 OCR 필요 |
| 캡차 입력창 | `#txtCaptcha` | 문자 입력 |
| 캡차 영역 | `#divRecaptcha` | 표시 여부 확인 |
| 입력완료 버튼 | `//*[@id="divRecaptcha"]/div[1]/div[4]/a[2]` | |
| 새로고침 버튼 | `//*[@id="divRecaptcha"]/div[1]/div[1]/a[1]` | 캡차 틀렸을 때 |

### 좌석 선택 예시 코드
```python
# ifrmSeat으로 전환
driver.switch_to.frame(driver.find_element(By.NAME, "ifrmSeat"))
# ifrmSeatDetail로 전환
driver.switch_to.frame("ifrmSeatDetail")

# 가용 좌석 찾기
seats = driver.find_elements(By.XPATH, "//img[@class='stySeat']")

# 좌석 정보 예: "VIP석 3층-2열-15" (alt 속성)
for seat in seats:
    info = seat.get_attribute('alt')
    seat.click()  # 좌석 선택

# 좌석 선택 완료
driver.switch_to.default_content()
driver.switch_to.frame(driver.find_element(By.ID, "ifrmSeat"))
driver.find_element(By.ID, "NextStepImage").click()
```

---

## 4. 결제 페이지

### 구조
결제 과정은 `#ifrmBookStep` iframe 내에서 진행

### 단계별 셀렉터

#### 가격/매수 선택
| 요소 | 셀렉터 | 비고 |
|------|--------|------|
| 가격 드롭다운 | `//*[@id="PriceRow001"]/td[3]/select` | Select 모듈 사용 |
| 다음 단계 버튼 | `#SmallNextBtnImage` | |

#### 예매자 확인
| 요소 | 셀렉터 | 비고 |
|------|--------|------|
| 생년월일 입력 | `#YYMMDD` | YYMMDD 형식 |
| 다음 단계 버튼 | `#SmallNextBtnImage` | |

#### 결제수단 선택
| 요소 | 셀렉터 | 비고 |
|------|--------|------|
| 무통장입금 | `#Payment_22004` 또는 `//*[@id="Payment_22004"]/td/input` | |
| 카카오페이 | `#Payment_22084` 또는 `//*[@id="Payment_22084"]/td/input` | |
| 은행 선택 드롭다운 | `#BankCode` | |
| 다음 단계 버튼 | `#SmallNextBtnImage` | |

#### 최종 결제
| 요소 | 셀렉터 | 비고 |
|------|--------|------|
| 전체 동의 체크박스 | `#checkAll` | |
| 결제하기 버튼 | `#LargeNextBtnImage` | 최종 버튼 |

### 결제 예시 코드
```python
# 가격 선택
driver.switch_to.frame(driver.find_element(By.ID, "ifrmBookStep"))
select = Select(driver.find_element(By.XPATH, '//*[@id="PriceRow001"]/td[3]/select'))
select.select_by_index(1)

driver.switch_to.default_content()
driver.find_element(By.ID, "SmallNextBtnImage").click()

# 생년월일 입력
driver.switch_to.frame(driver.find_element(By.ID, "ifrmBookStep"))
driver.find_element(By.ID, "YYMMDD").send_keys("991231")

driver.switch_to.default_content()
driver.find_element(By.ID, "SmallNextBtnImage").click()

# 무통장입금 선택
driver.switch_to.frame(driver.find_element(By.ID, "ifrmBookStep"))
driver.find_element(By.XPATH, '//*[@id="Payment_22004"]/td/input').click()
bank_select = Select(driver.find_element(By.ID, "BankCode"))
bank_select.select_by_index(1)

driver.switch_to.default_content()
driver.find_element(By.ID, "SmallNextBtnImage").click()

# 최종 동의 및 결제
driver.switch_to.frame(driver.find_element(By.ID, "ifrmBookStep"))
driver.find_element(By.ID, "checkAll").click()

driver.switch_to.default_content()
driver.find_element(By.ID, "LargeNextBtnImage").click()
```

---

## 5. URL 패턴

### 직접 접근 URL (직링)
```
# 예매 팝업 직접 호출
http://poticket.interpark.com/Book/BookSession.asp?GroupCode={GroupCode}

# 공연 상세 페이지
https://tickets.interpark.com/goods/{GoodsCode}

# 구 예매 페이지
https://ticket.interpark.com/Ticket/Goods/TPBridge.asp?GoodsCode={GoodsCode}
```

---

## 6. 셀레니움 감지 우회

인터파크는 셀레니움 감지를 하므로 우회 필요:

```python
from selenium import webdriver
from selenium_stealth import stealth

options = webdriver.ChromeOptions()
options.add_argument("--disable-blink-features=AutomationControlled")
options.add_experimental_option("excludeSwitches", ["enable-automation"])
options.add_experimental_option('useAutomationExtension', False)

driver = webdriver.Chrome(options=options)

stealth(driver,
    languages=["ko-KR", "ko"],
    vendor="Google Inc.",
    platform="Win32",
    webgl_vendor="Intel Inc.",
    renderer="Intel Iris OpenGL Engine",
    fix_hairline=True,
)
```

---

## 7. 참고 자료

### GitHub 저장소
- https://github.com/yeeeze/auto-ticketing (Electron + Puppeteer)
- https://github.com/clyde0813/Interpark-Ticketing (Python + Selenium)

### 블로그
- https://spectrum20.tistory.com (전체 플로우 코드)
- https://seongjuk.tistory.com (단계별 상세 설명)

---

## 8. TODO (검증 필요)

- [ ] 실제 페이지에서 셀렉터 검증
- [ ] 2024년 12월 서버 개편 이후 변경점 확인
- [ ] Canvas 기반 좌석맵 대응 방법 조사
- [ ] 모바일 페이지 구조 조사
