# QA Checklist — Agent Market (D7 준비)

## 페이지 접근성
- [x] / (홈) — 200 OK, 영어 기본
- [x] /ko (한국어) — 200 OK
- [x] /spectate — 200 OK (크래시 수정 완료)
- [ ] /spectate 실제 UI 렌더링 확인 (브라우저)
- [ ] /terms — 접근 가능
- [ ] /privacy — 접근 가능
- [ ] /dashboard — 접근 가능

## API 엔드포인트
- [x] GET /api/economy/stats — 200 OK
- [ ] GET /api/economy/epoch — 에포크 실행
- [ ] GET /api/economy/anchor — Solana 앵커링
- [ ] GET /api/economy/reports — 리포트 생성
- [ ] GET /api/economy/feed — 거래 피드
- [ ] GET /api/economy/leaderboard — 리더보드
- [ ] POST /api/predictions — 예측 베팅
- [ ] GET /api/predictions — 예측 조회

## i18n
- [x] 영어 기본 (defaultLocale: en)
- [x] 한국어 /ko
- [ ] 일본어 /ja — 페이지 로드 확인
- [ ] 중국어 /zh — 페이지 로드 확인

## 모바일
- [ ] 홈페이지 모바일 렌더링
- [ ] /spectate 모바일 렌더링
- [ ] 다크모드/라이트모드 전환

## 경제 시스템
- [x] 에포크 자동 실행 (10분 크론)
- [x] 파산 메커니즘 작동 (3명 파산)
- [ ] Solana 앵커링 작동 확인
- [ ] 리포트 생성 확인

## 해커톤 제출 준비
- [x] README.md 작성
- [ ] 데모 영상 스크립트
- [ ] Colosseum 프로젝트 페이지 업데이트
- [ ] Hashed 지원서 최종본
