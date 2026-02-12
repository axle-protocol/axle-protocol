# DASHBOARD.md — 2026-02-13 00:49 KST

## 🎯 현재 프로젝트

### BTS 티켓팅 매크로 (Interpark / NOL)

**현상 요약**
- `tickets.interpark.com/goods/...` URL로 바로 진입하면 종종 `https://nol.interpark.com/ticket` (대기/허브)로 리다이렉트되어 **goods 페이지의 “예매하기” 버튼을 못 찾는 케이스** 발생
- Turnstile(Cloudflare) 캡챠는 자동 클릭만으로는 불안정 → **사람이 미리 통과**하는 전략이 가장 안정

**현재 전략(실전형)**
- Han이 오픈 전:
  - NOL에서 공연 페이지까지 **수동으로 진입 + 로그인/Turnstile 해결**
  - “예매하기” 버튼 보이는 화면에서 대기
- 매크로는 오픈 직후:
  - 예매하기 → 팝업/iframe 전환 → 좌석 선택 → 다음 단계까지 자동화
  - 결제 자동화는 기본 OFF 유지(리스크/실수 방지)

**코드 상태 (최근 반영)**
- CapSolver: `--capsolver` **옵션일 때만** 사용 (기본 수동)
- 성능/안정화 리팩터링:
  - booking path `networkidle` 제거
  - selector 순차 탐색 → 콤마 selector로 단축
  - `expect_popup` 고정 대기 제거 → 새 탭 이벤트 vs URL change 레이스
  - 리소스 차단: interpark/nol 도메인만 + `.svg` 제외 (Turnstile/seatmap 안정)
  - 디버그 덤프 강화: frames + console buffer 저장
- 추가 우회(옵션): goods 리다이렉트 시 **NOL 메인에서 공연명 검색 → 결과 클릭**으로 goods 진입 (`--query` / `CONCERT_QUERY`)

**현재 블로커**
- “사람처럼 들어가기(검색/탐색)”를 자동화로 100% 재현하기가 까다로움 → 탭 붙잡고 자동화(브라우저 릴레이/붙이기)가 더 적합

### AXLE Protocol (Colosseum)
- ✅ Colosseum 필수 필드 완료 (상금 수령 자격 OK)
- 🔄 포럼 모니터링 중 (10분)
  - 최신 5개 포스트 중 AXLE 직접 언급은 없음
  - 신뢰/투명성/온체인 추적 관련 글(#6062 SlotScribe 등)은 시너지 후보
  - 우리 포스트(ID:2212) 새 댓글 없음(최신 2026-02-10)

---

## 📋 Han 할 일
- [ ] BTS 티켓팅 운영 방식 확정: **오픈 전 수동 진입 + 오픈 후 자동화**로 진행
- [ ] (원하면) 브라우저 릴레이로 ‘현재 탭’ 자동화 붙이기
- [ ] X OAuth 1.0a 설정 (자동 트윗용)

## 🐾 Clo 작업현황
- [x] 메모리 검색: local 고정( OpenAI billing 이슈 회피 )
- [x] BTS 코드: CapSolver opt-in + 성능/안티봇/관측 리팩터링 커밋 완료
- [ ] BTS: “현재 탭” 붙잡는 자동화 루트 확정(브라우저 릴레이 or 다른 방식)
- [ ] Colosseum: 시너지 포스트에 댓글 초안 작성(한 승인 후 게시)

---

## 📊 세션 상태
- Model: openai-codex/gpt-5.2
- Context: 39% (157k/400k)
