# DASHBOARD.md — 2026-02-13 07:38 KST

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
- 안전장치:
  - `--stop-after (login|concert|booking|queue|seats)` 단계별 리허설
  - dry-run(결제 스킵) 기본값 ON
- 오픈타임 안정화 패치(핵심):
  - 팝업/새탭 예매 진입 시 `self.page`도 같이 교체 (downstream가 원탭을 보던 P0 수정)
  - seat/book iframe을 FrameLocator가 아닌 **실제 Frame**으로 탐색/반환
  - 좌표 클릭은 `page.mouse.click()`로 absolute 좌표 사용(미스클릭 감소)
  - Next 버튼을 `ifrmBookStep` → page 순으로 탐색
- 리소스 차단 수정:
  - first-party(interpark/nol/interparkcdn/ticketimage) 허용
  - 3rd-party 이미지/폰트만 차단 (svg 제외)
- goods 진입 불안정 대응:
  - goods → nol 허브 후속 리다이렉트 감지 시 **검색 우회**
  - query 없으면 goodsCode로 검색어 폴백
  - 검색 아이콘(실제 링크: `/contents/search`) 클릭 → input 찾기/입력
- 디버그 덤프: `/tmp/bts-debug/<timestamp>_<reason>/`

**현재 블로커 / 리스크**
- ✅ concert(goods) 진입은 “허브 리다이렉트 + 검색 우회”로 복구 성공 확인 (search가 실제로 `/contents/search`로 이동 후 input 입력)
- ⚠️ 예매하기 클릭 후 종종 **야놀자 로그인으로 리다이렉트** 발생 → storage state가 만료/세션 끊김 케이스.
  - 해결 전략(실전): **오픈 전 사람이 로그인/Turnstile 통과** + 예매하기 버튼 화면에서 대기(세션 유지)
  - 코드 측면: 야놀자 리다이렉트 감지/재로그인 핸들러는 있음(하지만 Turnstile이 변수)
- ⚠️ 자동 Turnstile 클릭만으로는 불안정 → 기본 전략은 수동, CapSolver는 opt-in
- `browser.act` 기반 자동화는 act 타임아웃/불안정 → Playwright 런 기반 유지

### AXLE Protocol (Colosseum)
- ✅ Colosseum 필수 필드 완료 (상금 수령 자격 OK)
- ⏸️ 포럼 모니터링: **BTS 티켓팅 집중 요청으로 일시 중지**
  - (필요 시) 다시 10분 주기로 재개

---

## 📋 Han 할 일
- [ ] BTS 티켓팅 운영 방식 확정: **오픈 전 수동 진입 + 오픈 후 자동화**로 진행
- [ ] (Colosseum) Human Claim 완료 확인 (클레임 안 하면 상금 대상 제외 리스크)
- [ ] X OAuth 1.0a 설정 (자동 트윗용)
- [ ] (BTS) 오픈 전 수동 준비: 로그인/Turnstile 통과 + 예매하기 버튼 화면에서 대기(세션 유지)

## 🐾 Clo 작업현황
- [x] 메모리 검색: local 고정( OpenAI billing 이슈 회피 )
- [x] BTS 코드: CapSolver opt-in + 성능/안티봇/관측 리팩터링 커밋 완료
- [x] BTS 런북: `bts-ticketing/RUNBOOK_OPEN_TIME.md`
- [x] BTS 안전장치: `--stop-after` + dry-run(결제 스킵 기본) 추가
- [x] BTS P0 패치 적용 완료 (팝업 tab/page 일관성 + real Frame + absolute 좌표 클릭 + Next in book frame)
- [ ] BTS: `--stop-after booking/seats` 리허설로 “야놀자 리다이렉트 없이 좌석까지” 성공률 끌어올리기
  - 현재 상태: 예매하기 버튼 탐지는 성공(렌더 대기 + fast selector) + 클릭까지 성공.
  - 남은 문제: 클릭 후 **야놀자 로그인 리다이렉트 빈번**(세션 만료/Turnstile). → 오픈 전 수동 준비가 핵심.
  - 참고: goods→허브 리다이렉트는 검색 우회로 복구 성공(단, 검색 결과가 목표 goods가 아닐 수도 있음).
- [ ] (일시중지) Colosseum 댓글 작업

---

## 📊 세션 상태
- Model: openai-codex/gpt-5.2
- Context: 59% (235k/400k)
- Usage: session ~99% left (~2h27m)
