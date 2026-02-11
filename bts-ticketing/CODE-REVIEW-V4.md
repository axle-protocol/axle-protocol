# BTS 티켓팅 코드 리뷰 v4.0

## 5회 반복 리뷰/수정 완료

### 라운드 1: nodriver API 수정
- ❌ `find_all` → ✅ `select_all` (nodriver 공식 API)
- ❌ `query_selector_all` 직접 호출 → ✅ `select_all` 래퍼 함수

### 라운드 2: wait_for_navigation 실제 구현
- ❌ TODO 스텁 (sleep만) → ✅ URL 변경 감지 + `await page` 
- nodriver에서 `page.url` vs `page.target.url` 둘 다 시도

### 라운드 3: iframe 진입 강화
- 여러 셀렉터 시도 (seat, seatFrame, class, src)
- `content_frame`, `frame` 속성 둘 다 시도
- 실패시 iframe 자체 반환 (폴백)

### 라운드 4: 예매 버튼/새 창 처리
- 30회 재시도 (20→30)
- 다양한 셀렉터: 텍스트, CSS, href 기반
- `_get_new_tab` 함수 분리
- 매진 감지 추가

### 라운드 5: 로그인 검증 강화
- 성공 지표 5개 (로그아웃, 마이페이지, 내 예약, 님, 예매확인)
- 실패 지표 8개 (비밀번호, 잠금, 보안문자 등)
- URL 기반 성공 추정 추가

---

## v3 → v4 변경 요약

| 항목 | v3 | v4 |
|------|----|----|
| 코드 라인 | 447 | 818 |
| 로그인 재시도 | ❌ | ✅ 3회 |
| wait_for_navigation | TODO 스텁 | 실제 구현 |
| iframe 처리 | 단순 | 5개 셀렉터 |
| Canvas 클릭 | offset (미지원) | JS dispatchEvent |
| 예매 재시도 | 20회 | 30회 |
| 매진 감지 | ❌ | ✅ |
| CAPTCHA 감지 | ❌ | ✅ |

---

## 남은 이슈 (수동 처리 필요)

1. **본인확인 CAPTCHA** - 자동화 불가, 알림 후 수동
2. **좌석 Canvas 정확한 클릭** - 실제 좌석맵 구조에 따라 조정 필요
3. **결제** - 수동 처리 (자동화 위험)

---

## 다음 단계

1. 실제 테스트 (테스트 모드)
2. 좌석 선택 로직 실제 DOM에 맞게 조정
3. 텔레그램 알림 테스트

---

## 파일

- `src/main_nodriver_v4.py` - 수정된 버전
- `src/main_nodriver_v3.py` - 이전 버전 (백업)
