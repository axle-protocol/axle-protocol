# BTS 티켓팅 4차 리뷰 - 좌석 선택 + 결제 검증

**날짜:** 2026-02-11
**담당:** Subagent (bts-round4-codex)

## 📊 실제 테스트 결과 분석

- 좌석 2781개 발견 (SVG circle) ✅
- 좌석 JS 클릭 성공 ✅

## 🔍 코드 리뷰 및 발견된 문제점

### seat_selector.py

#### 1. 좌석 클릭 후 선택 확인 없음 (수정됨 ✅)
**문제:** `click_seat()` 함수에서 클릭만 하고 실제 선택 여부 검증 안함
**수정:** 
- 클릭 전 상태 저장 (class, fill)
- 클릭 후 `_verify_seat_selected()` 함수로 상태 변화 검증
- class에 'selected', 'active', 'on' 등 추가 여부 확인
- fill 색상 변경 확인

#### 2. 인터파크 핵심 셀렉터 누락 (수정됨 ✅)
**문제:** `#Seats` 셀렉터가 없었음 (인터파크 실제 사용)
**수정:** 
```python
SEAT_SELECTORS = [
    "#Seats",  # 인터파크 메인
    "#Seats circle",
    "circle.st0:not(.sold):not(.disabled)",  # 인터파크 클래스
    ...
]
```

#### 3. SVG 분석 deprecated 메서드 사용 (수정됨 ✅)
**문제:** `find_elements_by_tag_name` (Selenium 4에서 deprecated)
**수정:** JavaScript로 SVG 요소 분석하도록 전면 재작성
- 더 정교한 색상 필터링
- 매진/비활성 좌석 제외 로직 강화
- 좌석 크기 검증 (r < 3 또는 > 30 제외)

#### 4. 연석 선택 로직 개선 (수정됨 ✅)
**문제:** 고정 gap 값 사용 (60px) → SVG 좌표계와 맞지 않을 수 있음
**수정:**
- 동적 간격 계산 (실제 좌석 간 거리 통계 기반)
- 간격 일관성 검증 (편차 체크)
- 열 허용 오차도 동적 계산
- 상세 로깅 추가

### payment_handler.py

#### 5. 결제수단 셀렉터 구조 오류 (수정됨 ✅)
**문제:** `#Payment_22001` 만으로는 클릭 안됨. 실제는 `#Payment_22001 td input`
**수정:**
```python
PaymentMethod.CREDIT_CARD: [
    '#Payment_22001 td input',
    '#Payment_22001 input',
    ...
]
PaymentMethod.BANK_TRANSFER: [
    '#Payment_22004 td input',
    ...
]
```

#### 6. 간편결제 ID 추가 (수정됨 ✅)
**추가된 셀렉터:**
- 카카오페이: `#Payment_22019`
- 네이버페이: `#Payment_22020`
- PAYCO: `#Payment_22021`
- 토스: `#Payment_22022`
- 삼성페이: `#Payment_22023`

#### 7. 가격 선택 셀렉터 정확도 (수정됨 ✅)
**수정:** `#PriceRow001 > td:nth-child(3) > select` 추가

#### 8. 결제수단 클릭 로직 개선 (수정됨 ✅)
**문제:** 라디오 버튼 클릭이 불안정
**수정:**
- JS 클릭으로 라디오 버튼 처리
- 요소 타입 확인 후 적절한 클릭 방식 선택

## 🏗 인터파크 DOM 구조 (2024-2026 기준)

### 프레임 구조
```
- ifrmSeat: 좌석 선택
  - ifrmSeatDetail: 좌석 상세 (SVG 좌석맵)
- ifrmBookStep: 예매 단계 (가격/결제/확인)
```

### 주요 셀렉터
| 용도 | 셀렉터 |
|------|--------|
| 좌석 프레임 | `#ifrmSeat` |
| 좌석 상세 | `#ifrmSeatDetail` |
| 좌석 요소 | `#Seats`, `circle.st0` |
| 등급 선택 | `#GradeRow` |
| 구역 선택 | `#GradeDetail > div > ul > li > a` |
| 다음 버튼 | `#NextStepImage`, `#SmallNextBtnImage` |
| 가격 선택 | `#PriceRow001 td select` |
| 생년월일 | `#YYMMDD` |
| 신용카드 | `#Payment_22001 td input` |
| 계좌이체 | `#Payment_22004 td input` |
| 은행 선택 | `#BankCode` |

### 캡챠 관련
| 용도 | 셀렉터 |
|------|--------|
| 캡챠 영역 | `#divRecaptcha` |
| 캡챠 이미지 | `#imgCaptcha` |
| 캡챠 입력 | `#txtCaptcha` |

## ✅ 수정 완료 목록

1. ✅ 좌석 클릭 후 선택 상태 검증 추가
2. ✅ 인터파크 핵심 셀렉터 추가 (`#Seats`)
3. ✅ SVG 분석 로직 전면 재작성 (JS 기반)
4. ✅ 연석 선택 동적 간격 계산
5. ✅ 결제수단 셀렉터 `td input` 구조 반영
6. ✅ 간편결제 ID 추가 (22019~22023)
7. ✅ 라디오 버튼 JS 클릭 처리

## ⚠️ 추가 검증 필요 사항

1. **실제 예매 테스트 필요** - 셀렉터 변경은 사이트 업데이트에 따라 달라질 수 있음
2. **캡챠 처리** - OCR 기반 캡챠 입력 모듈 별도 검증 필요
3. **타이밍 조정** - 실제 네트워크 환경에서 딜레이 조정 필요 가능

## 📝 권장 사항

1. 실제 티켓팅 전 **리허설 테스트** 권장 (다른 공연으로)
2. 결제수단 ID는 인터파크 업데이트 시 변경 가능 → 주기적 확인 필요
3. SVG 좌석맵의 색상/클래스 패턴은 공연마다 다를 수 있음
