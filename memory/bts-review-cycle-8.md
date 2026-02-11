# BTS 티켓팅 매크로 리뷰 Cycle 8/10
**날짜**: 2026-02-11 15:04 KST

## 발견된 이슈

### 1. NUM_SESSIONS 검증 없음 (Medium)
- 음수, 0, 또는 과도한 수 입력 시 문제 발생 가능
- 리소스 과부하 위험

### 2. concert_url 유효성 검증 부족 (Medium)
- http:// 또는 잘못된 URL 입력 가능
- HTTPS 강제 필요

### 3. NTP 서버 지연 (Medium)
- 한국 서버 없이 글로벌 서버만 사용
- 타이밍 정밀도 저하

### 4. human_type 특수문자 escape 불완전 (Low)
- 백슬래시, 작은따옴표, 개행 등 미처리
- JS 실행 시 에러 발생 가능

## 수정 사항

1. **NUM_SESSIONS 검증**:
   - `max(1, min(10, ...))` 범위 제한
   - 1-10 사이로 강제

2. **concert_url 검증**:
   - http:// → https:// 자동 변환
   - 스킴 없으면 에러

3. **NTP 한국 서버 추가**:
   - time.bora.net (1순위)
   - time.kriss.re.kr (한국표준과학연구원)
   - ntp.kornet.net (KT)

4. **특수문자 escape 강화**:
   - 백슬래시, 작은따옴표, 개행, 캐리지리턴 처리

## 구문 검사
✅ python3 -m py_compile 통과
