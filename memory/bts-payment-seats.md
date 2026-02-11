# BTS 티켓팅 - 결제 자동화 + 고급 좌석 선택

> 작성일: 2026-02-11
> 모듈: seat_selector.py, payment_handler.py

## 📁 파일 구조

```
bts-ticketing/src/
├── main_seleniumbase_v2.py  # 메인 실행 파일 (통합)
├── seat_selector.py         # 고급 좌석 선택 모듈
├── payment_handler.py       # 결제 자동화 모듈
└── ...
```

## 🪑 좌석 선택 모듈 (seat_selector.py)

### 주요 기능

1. **구역 지정**
   - `SeatPreference.zone_priority`: 구역 우선순위 리스트
   - 예: `['스탠딩A', 'VIP', 'R석', 'S석']`

2. **열/번호 범위 지정**
   - `preferred_rows`: (min, max) 튜플
   - `preferred_seats`: (min, max) 튜플
   - `exclude_rows`: 제외할 열 번호 리스트

3. **연석 선택**
   - `consecutive_required`: True면 연속 좌석만 선택
   - `num_seats`: 필요한 좌석 수
   - 좌표 기반 인접 좌석 그룹화 알고리즘

4. **Canvas/SVG 좌석맵**
   - 픽셀 분석으로 가용 좌석 찾기
   - 색상 기반 좌석 상태 판별
   - 좌표 클릭 지원

### 사용 예시

```python
from seat_selector import SeatSelector, SeatPreference

# 설정
pref = SeatPreference(
    num_seats=2,
    consecutive_required=True,
    zone_priority=['스탠딩A', 'VIP', 'R석'],
    preferred_rows=(1, 5),
    exclude_zones=['3층', '시야제한']
)

# 선택
selector = SeatSelector(sb, pref)
if selector.select_best_seats():
    selector.complete_selection()
```

### 편의 함수

```python
# 빠른 선택
quick_select(sb, num_seats=2, consecutive=True)

# 스탠딩 선택
standing_select(sb, num_seats=2, area='A')

# 프리미엄 선택
premium_select(sb, num_seats=2)
```

## 💳 결제 모듈 (payment_handler.py)

### 결제 플로우

1. **가격/할인 선택** → `#PriceRow001 select`
2. **수령 방법 선택** → 현장수령/배송
3. **예매자 정보 입력** → `#YYMMDD` 생년월일
4. **결제수단 선택**
   - 카카오페이: `[class*="kakao"]`
   - 네이버페이: `[class*="naver"]`
   - 신용카드: `#Payment_22001`
   - 계좌이체: `#Payment_22004`
5. **약관 동의** → `#checkAll`
6. **결제하기** → `#LargeNextBtnImage`

### 주요 셀렉터

```python
SELECTORS = {
    # 프레임
    'seat_frame': '#ifrmSeat',
    'book_step_frame': '#ifrmBookStep',
    
    # 버튼
    'next_step_small': '#SmallNextBtnImage',
    'next_step_large': '#LargeNextBtnImage',
    
    # 입력
    'birth_input': '#YYMMDD',
    
    # 결제
    'payment_card': '#Payment_22001',
    'payment_transfer': '#Payment_22004',
    
    # 약관
    'agree_all': '#checkAll',
}
```

### 사용 예시

```python
from payment_handler import PaymentHandler, PaymentConfig, PaymentMethod

# 설정
config = PaymentConfig(
    birth_date='991013',
    auto_pay=False,  # True면 최종 결제까지 자동
    payment_methods=[
        PaymentMethod.KAKAO_PAY,
        PaymentMethod.CREDIT_CARD,
    ],
)

# 결제
handler = PaymentHandler(sb, config)
handler.process_payment()
```

### 편의 함수

```python
# 빠른 결제 (간편결제 우선)
quick_payment(sb, birth_date='991013', auto_pay=False)

# 카드 결제
card_payment(sb, birth_date='991013', card_company='삼성', installment=3)

# 계좌이체
bank_payment(sb, birth_date='991013', bank_name='국민')

# 결제 준비만 (수동 결제용)
prepare_payment_only(sb, birth_date='991013')
```

## 🚀 통합 사용법 (main_seleniumbase_v2.py)

### CLI 옵션

```bash
# 기본 실행
python main_seleniumbase_v2.py --url "https://..." --hour 20 --minute 0

# 좌석 옵션
python main_seleniumbase_v2.py \
    --seats 2 \
    --zone 스탠딩A VIP R석 \
    --rows 1-5

# 결제 옵션
python main_seleniumbase_v2.py \
    --payment kakao \
    --birth 991013

# 테스트 (즉시 실행)
python main_seleniumbase_v2.py --test --seats 2 --payment kakao
```

### 환경변수 (.env.local)

```env
INTERPARK_ID=your_email@example.com
INTERPARK_PWD=your_password
CONCERT_URL=https://tickets.interpark.com/goods/...
BIRTH_DATE=991013
```

## 📋 인터파크 페이지 구조

### iframe 구조

```
예매 페이지
├── #ifrmSeat (좌석 선택)
│   └── #ifrmSeatDetail (좌석 상세)
└── #ifrmBookStep (결제 스텝)
```

### 좌석 선택 요소

- 구역 선택: `#GradeRow`, `#GradeDetail`
- 좌석 컨테이너: `#Seats`
- 가용 좌석: `img[src*="seat"][src*="on"]`
- 완료 버튼: `#NextStepImage`

### 결제 스텝

1. 가격 선택: `#PriceRow001 select`
2. 생년월일: `#YYMMDD`
3. 결제수단: `#Payment_22001` (카드), `#Payment_22004` (이체)
4. 전체 동의: `#checkAll`
5. 결제하기: `#LargeNextBtnImage`

## ⚠️ 주의사항

1. **봇 탐지**
   - SeleniumBase UC Mode 사용 필수
   - Turnstile 캡차 처리 필요

2. **iframe 전환**
   - 좌석/결제 요소 접근 전 프레임 전환 필요
   - `switch_to.default_content()` → `switch_to.frame()`

3. **자동 결제**
   - `auto_pay=True`는 실제 결제 진행됨
   - 테스트 시 `auto_pay=False` 권장

4. **타이밍**
   - 예매 오픈 직전 로그인 완료
   - 새로고침 + 버튼 연타 전략

## 🔧 트러블슈팅

### 좌석 선택 안됨
- iframe 전환 확인
- 셀렉터 업데이트 필요할 수 있음
- Canvas 좌석맵이면 좌표 클릭 사용

### 결제 진행 안됨
- 생년월일 형식 확인 (YYMMDD)
- iframe 전환 확인
- 약관 동의 체크 확인

### 봇 탐지됨
- UC Mode 확인
- Turnstile 캡차 수동 처리
- 새 프로필로 재시도
