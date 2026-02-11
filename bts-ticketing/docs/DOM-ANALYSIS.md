# Interpark DOM 분석 (2026-02-11)

> 실제 브라우저 테스트 기반

## 로그인 플로우

### Step 1: 메인페이지
```
button "로그인" [ref=e18]   ← 클릭
```

### Step 2: 로그인 페이지
```
button "기존 인터파크 계정 로그인" [ref=e9]   ← 클릭
```

### Step 3: 로그인 폼 (iframe 없음!)
```
textbox "아이디" [ref=e3]      ← ID 입력
textbox "비밀번호" [ref=e5]    ← PW 입력
button "로그인" [ref=e9]       ← 제출
```

### Step 4: 로그인 확인
```
button "내 예약" [ref=e19]     ← 로그인 성공 시 표시
```

## 예매 플로우

### 콘서트 상세 페이지
```
button "예매대기" [ref=e36]    ← 오픈 전
link "예매하기" [ref=e78]      ← 예매 버튼 (링크!)
button "관람일" [ref=e72]      ← 날짜 캘린더
button "1회 18:00" [ref=e76]  ← 회차 선택
```

### 브릿지 페이지 (다중 공연)
```
button "...예매하기" [ref=e35~e40]  ← 각 공연별 예매
button "...판매종료"               ← 종료된 공연
```

## 좌석 선택 (추가 분석 필요)

- 예매하기 클릭 시 로그인 안 됐으면 → 로그인 리다이렉트
- 로그인 후 좌석 선택 페이지로 이동
- 좌석 선택 페이지는 iframe 또는 별도 창일 수 있음

## 셀렉터 전략

### 텍스트 기반 (nodriver 호환)
```python
# 로그인
await page.find('로그인')           # 메인 로그인 버튼
await page.find('기존 인터파크 계정 로그인')
await page.find('아이디')           # ID 필드 (접근성 텍스트)
await page.find('비밀번호')         # PW 필드

# 예매
await page.find('예매하기')         # 예매 버튼
await page.find('내 예약')          # 로그인 확인
```

### CSS 폴백
```python
'input[type="text"]'      # ID
'input[type="password"]'  # PW
'a[href*="#"]'            # 예매하기 링크
```

## 주의사항

1. **동일 텍스트 충돌**: "로그인" 텍스트가 여러 곳에 있음
   - 해결: 페이지 상태에 따라 다른 요소 찾기
   
2. **페이지 전환**: 로그인 버튼 클릭 시 새 페이지로 이동
   - 해결: 클릭 후 충분한 대기 + DOM 재검색

3. **리다이렉트**: 예매하기 클릭 시 로그인으로 리다이렉트 가능
   - 해결: 로그인 상태 먼저 확인

---
Last updated: 2026-02-11 09:40 KST
