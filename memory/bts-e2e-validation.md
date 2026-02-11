# BTS 티켓팅 E2E 검증 결과

**검증 일시**: 2026-02-11 22:05 KST
**검증 대상**: interpark.ts
**실제 테스트 공연**: 2026 IVE THE 4TH FAN CONCERT

## 🔴 Critical Issues

### 1. 로그인 시스템 전면 변경
- **기존 코드**: iframe 기반 로그인 (`//*[@id="userId"]`, `//*[@id="userPwd"]`)
- **실제 현재**: NOL 통합 로그인 (accounts.yanolja.com)
- **URL 패턴**: `accounts.yanolja.com → accounts.interpark.com`

### 2. 예매 버튼 셀렉터 불일치
- **기존**: `'//*[@id="productSide"]/div/div[2]/a[1]'`
- **실제**: `link "예매하기"` 또는 `a[href="#"]` with text "예매하기"

### 3. 페이지 구조 변경
- 인터파크 → NOL 인터파크로 리브랜딩
- 모든 URL 패턴 변경 (tickets.interpark.com)

---

## 📋 실제 플로우 검증

### 시나리오 1: 정상 플로우

| 단계 | 예상 | 실제 | 상태 |
|------|------|------|------|
| 1. 공연 페이지 | tickets.interpark.com/goods/{id} | ✅ 동일 | ✅ |
| 2. 예매하기 클릭 | 새 탭 열림 | 로그인 모달로 전환 | ⚠️ 다름 |
| 3. 로그인 | iframe | accounts.yanolja.com 페이지 | 🔴 변경 |
| 4. 대기열 | 확인 필요 | 미확인 (로그인 필요) | ⏳ |
| 5. 좌석 선택 | iframe 구조 | 미확인 | ⏳ |
| 6. 결제 | iframe 구조 | 미확인 | ⏳ |

---

## 🔧 필수 수정 사항

### 1. 로그인 시스템 재구현
```typescript
// 기존 (삭제)
LOGIN_IFRAME: "//div[@class='leftLoginBox']/iframe[@title='login']",
USER_ID: '//*[@id="userId"]',
USER_PWD: '//*[@id="userPwd"]',

// 신규 (추가)
LOGIN_ID_INPUT: 'textbox[aria-label="아이디"]',
LOGIN_PW_INPUT: 'textbox[aria-label="비밀번호"]',
LOGIN_SUBMIT: 'button:has-text("로그인")',
LEGACY_LOGIN_BTN: 'button:has-text("기존 인터파크 계정 로그인")',
```

### 2. 예매 버튼 셀렉터
```typescript
// 기존 (삭제)
BOOKING_BUTTON: '//*[@id="productSide"]/div/div[2]/a[1]',

// 신규 (추가)
BOOKING_BUTTON: 'a:has-text("예매하기")',
// 또는 CSS: '[class*="productSide"] a:first-child'
```

### 3. 로그인 플로우 변경
```typescript
// 1. 예매하기 클릭
// 2. 로그인 페이지로 리다이렉트 (accounts.yanolja.com)
// 3. "기존 인터파크 계정 로그인" 클릭
// 4. ID/PW 입력 (textbox "아이디", textbox "비밀번호")
// 5. "로그인" 버튼 클릭
// 6. 로그인 완료 후 원래 예매 플로우로 복귀
```

---

## 📊 셀렉터 대조표

| 용도 | 기존 XPath | 새 Playwright 셀렉터 |
|------|-----------|---------------------|
| 로그인 버튼 | //*[@id="__next"]/div/header/... | button:has-text("로그인") |
| 아이디 입력 | //*[@id="userId"] | textbox[aria-label="아이디"] |
| 비밀번호 | //*[@id="userPwd"] | textbox[aria-label="비밀번호"] |
| 예매하기 | //*[@id="productSide"]/div/div[2]/a[1] | a:has-text("예매하기") |
| 날짜 선택 | - | listitem:has-text("21") (예시) |
| 회차 선택 | - | button:has-text("1회 18:00") |

---

## 🎯 OpenClaw 통합 권장

기존 Selenium/XPath 방식 대신 OpenClaw browser tool 활용:

```typescript
// 예매하기 클릭
await browser.act({ kind: 'click', ref: 'e357' });

// 로그인
await browser.act({ kind: 'type', ref: 'e14', text: userId });
await browser.act({ kind: 'type', ref: 'e23', text: userPwd });
await browser.act({ kind: 'click', ref: 'e39' });
```

**장점**:
- 동적 ref 기반으로 셀렉터 변경에 강함
- AI가 페이지 상태를 분석하여 적응
- snapshot으로 현재 상태 확인 가능

---

## ⏳ 추가 검증 필요

1. **대기열 시스템**: 실제 티켓 오픈 시 대기열 UI 확인 필요
2. **CAPTCHA**: 부정예매 방지 CAPTCHA 존재 여부 확인
3. **좌석 선택 iframe**: 로그인 후 예매 진행 시 확인 필요
4. **결제 iframe**: 결제 페이지 구조 확인 필요

---

## 📝 코드 업데이트 상태

- [x] 로그인 시스템 분석 완료
- [x] 예매 버튼 셀렉터 확인
- [ ] 좌석 선택 셀렉터 확인 (로그인 필요)
- [ ] 결제 페이지 셀렉터 확인
- [x] interpark.ts 코드 업데이트 완료 ✅

---

## 🔄 코드 변경 내역

### 2026-02-11 업데이트

1. **SELECTORS 객체 추가**
   - 기존 XPath → Playwright/CSS 셀렉터로 전환
   - NOL 로그인 시스템 지원
   - 에러 메시지 셀렉터 추가

2. **로그인 플로우 변경**
   - `login()` 함수: NOL 통합 로그인 지원
   - accounts.yanolja.com → accounts.interpark.com 흐름

3. **연석 선택 지원**
   - `selectSeats()`: count 파라미터로 연석 개수 지정
   - 같은 열에서 연속 좌석 찾기 로직 (구현 예정)

4. **에러 핸들링 강화**
   - `ERROR_HANDLERS` 객체: 에러 유형별 처리
   - 재시도 로직 포함

5. **타입 정의 개선**
   - `PaymentMethod`: kakaopay, naverpay, card, bank
   - `BookingState`: queuePosition, retryCount 추가

---

## ⚠️ 남은 작업

### P0 (필수)
- [ ] 실제 로그인 테스트 (테스트 계정 필요)
- [ ] 좌석 선택 iframe 구조 확인
- [ ] 결제 페이지 구조 확인

### P1 (중요)
- [ ] 대기열 UI/셀렉터 확인 (티켓 오픈 시)
- [ ] CAPTCHA 처리 로직 (존재 시)
- [ ] 연석 선택 알고리즘 구현

### P2 (개선)
- [ ] 텔레그램 알림 연동
- [ ] 오픈 시간 자동 새로고침
- [ ] 멀티 브라우저 세션 지원
