# Step 5 — KakaoTalk Desktop 통합 계획 (macOS)

작성일: 2026-02-08

## 전제(필수)
- Mac mini에 KakaoTalk for Mac 설치
- 로그인 완료
- macOS 권한:
  - 접근성(Accessibility)
  - 화면 기록(Screen Recording)

## 목표
- KakaoTalk PC에서 특정 채팅방(화이트리스트)만 대상으로
  - 새 메시지 관찰(Training 모드: 승인 요청)
  - 답장안 생성
  - 승인/Autopilot Window 조건 만족 시 전송
- 모든 행동은 텔레그램 관제 로그로 남김

## 구현 접근
- Reverse engineering/API 금지
- **UI 자동화(Computer Use)**
  - Peekaboo CLI로 화면 캡처/요소 탐지/클릭/타이핑

## 최소 기능(MVP)
1) 채팅방 포커스
2) 마지막 수신 메시지 텍스트 추출(가능한 범위에서 OCR/복사)
3) 입력창에 답장 텍스트 붙여넣기
4) 전송 버튼 클릭(또는 Enter)

## 안전장치
- 화이트리스트(chatName)
- 금칙어/Boundary Filter
- Autopilot Window(10/30/60/<=120)
- STOP/PAUSE 즉시 반영
- 전송 전/후 스크린샷(증적)

## 다음 실행 체크리스트
- [ ] KakaoTalk 설치/로그인 확인
- [ ] Peekaboo permissions OK
- [ ] Peekaboo로 KakaoTalk 화면 `see` 스냅샷 캡처
- [ ] 요소 ID 매핑(채팅 리스트/메시지 영역/입력창/전송 버튼)
- [ ] send() 경로 자동화 스크립트화
