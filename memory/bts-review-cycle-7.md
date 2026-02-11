# BTS 티켓팅 매크로 리뷰 Cycle 7/10
**날짜**: 2026-02-11 15:01 KST

## 발견된 이슈

### 1. move_mouse_to 선형 이동만 구현 (Medium)
- 주석에는 "베지어 곡선"이라고 되어 있지만 실제로는 선형 이동
- 봇 탐지에서 비자연스러운 직선 움직임 감지 가능

### 2. setup_stealth 봇 탐지 우회 부족 (High)
- WebGL 렌더러/벤더 정보 미설정
- navigator.connection 미설정
- chrome 객체 불완전

### 3. navigator.plugins 비현실적 (Low)
- `[1,2,3,4,5]` 배열 반환
- 실제 PluginArray와 다름

## 수정 사항

1. **베지어 곡선 마우스 이동**:
   - 2차 베지어 곡선 공식 적용
   - 랜덤 제어점으로 자연스러운 곡선
   - 시작점 파라미터 추가
   - 불규칙한 딜레이

2. **Stealth 설정 강화**:
   - chrome 객체: runtime, loadTimes, csi 추가
   - navigator.plugins: 실제 Chrome 플러그인 목록
   - WebGL: Intel 렌더러/벤더 반환
   - 화면 해상도: 1920x1080 고정
   - navigator.connection: 4G 네트워크 정보

## 구문 검사
✅ python3 -m py_compile 통과
