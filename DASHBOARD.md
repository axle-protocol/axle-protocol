# DASHBOARD.md — 2026-02-15 20:50 KST

## 🎯 현재 프로젝트

### 스마트스토어 주문/송장 자동화 + 사장님 포털 (1순위)

**목표 (실운영 플로우)**
1) 스마트스토어 주문 엑셀(암호 1234) 업로드/파싱 → 주문라인 저장
2) 상품번호(+옵션)로 사장님 자동 매핑 (초기엔 주문별 수동 할당 병행)
3) 사장님 포털: 주문 확인(주소/전화 포함) + 송장번호 입력
4) Han 승인
5) 발송처리 업로드 엑셀(4열) 자동 생성(대량이면 분할)
6) (추후) 네이버 업로드 자동화(Playwright)

**엑셀 구조 확인(실데이터)**
- 주문조회(export): CDFV2 암호화 xlsx
  - 시트: `주문조회`
  - 핵심 컬럼: `상품주문번호`, `주문번호`, `상품번호`, `상품명`, `옵션정보`, `수량`
  - 절대키: **상품주문번호(라인아이템)**
  - 매핑키: **상품번호(+옵션정보로 세분화 가능)**
- 발주발송 템플릿(export): CDFV2 암호화 xlsx
  - 시트: `발주발송관리`
  - 안내문 행 존재(업로드 시 삭제 규칙 있음)
- 발송처리 업로드 템플릿: `.xls`
  - 시트: `발송처리`
  - 필수 4열: `상품주문번호` / `배송방법` / `택배사` / `송장번호`
  - 업로드 시 2~3행 삭제 필요

**정책/현실 체크 (리서치 결과)**
- 대량 업로드는 실패할 수 있어 **파일 분할 업로드 권장**
- 택배사/배송방법 값은 UI 선택값과 **문자열 정확히 일치**해야 함
- 주소/전화 등 개인정보 공유는 위탁(배송대행) 관점으로 운영해야 안전:
  - vendor별 접근제어(서버 강제) + 감사로그 + 강한 비번/락아웃
  - 보관 기간 최소화(예: 7일) + 포털로만 전달

---

## 📋 Han 할 일
- [ ] (운영) Cloudflare로 옮길 **운영용 도메인 결정** (기존 가비아 도메인 vs 새 도메인)
  - 형태: `vendor.<domain>` / `admin.<domain>` (서브도메인 분리)
- [ ] (선택) Codex CLI를 쓰려면 OpenAI **API Billing/Quota** 활성화 필요 (ChatGPT Pro와 별개)
- [ ] (선택) Codex 자동화용 OpenRouter는 일단 보류 (키 노출 이슈로 revoke 권장)
- [ ] (결정) 매핑 운영 초기: **상품번호 기반 자동 매핑(권장)** + 미매핑은 ‘미분류’로 처리

## 🐾 Clo 작업현황

### 인스타(뷰티 제품 판매) — 팔로워 성장 + 게시 직전 자동
- [x] (IG) 뷰티(팔로워 성장) 30일 캘린더/템플릿/샘플 패키지 v1
  - 파일: `ops/ig/calendar-30d.md`, `ops/ig/templates.md`, `ops/ig/examples.md`
  - 커밋: `b4b9202`
- [x] (Research) 20~30대 반응 포맷/훅/Do&Don’t 1차 정리 완료
  - 핵심: 15~30초 릴스(증상/결과 훅) + 캐러셀(저장형 체크리스트) 조합
- [x] (Research) 레퍼런스 계정 후보 15개(브랜드 9 + 크리에이터 6) 링크/패턴 1차 정리
- [x] (Browser) 인스타 웹(로그인 세션) Chrome Relay attach로 연결 확인 + 크롤링 성공
  - rom&nd / AMUSE에서 실제 캡션 기반 훅/CTA 패턴 추출(토글로 복구 포함)
- [x] (Insight) 사업모델=멀티 카테고리 리셀(유명 브랜드 저가 소싱)
  - 성장 콘텐츠 축=딜/큐레이션/선택피로 해결(Top3/비교/피부타입 매칭)
- [x] (Phase B) “게시 직전까지만 자동” 상태머신 설계(만들기→파일→캡션→공유 직전 STOP) 완료
  - 가드레일: Share/Post/공유/게시 버튼 절대 클릭 금지 + 2FA/챌린지 즉시 중단

---

## 🐾 Clo 작업현황
- [x] (Ops) 대시보드 서버 nohup 재기동 (SIGKILL 방지)
  - PID: 55095 (latest)
  - Log: /tmp/automation-dashboard.log
- [x] (Infra) Chrome Remote Desktop 접속 불가 이슈 복구
- [x] (Dashboard v2) 큐 JSON 저장 + 승인/보류 API + 실데이터 렌더링
- [x] (SmartStore) 주문조회 엑셀/발송처리 템플릿 구조 파악 + 키 확정
- [x] (Vendor Portal MVP) 사장님 포털 “실동작 버전” 구현 완료
  - 로그인(세션), 내 주문(주소/전화), 송장 입력(검증/정규화), 사장님용 주문 엑셀(xlsx) 다운로드
  - tracking 필드 호환/정규화 fix + 미처리 배지/미처리 우선 정렬
  - 배송정보 크게 표시 + 복사 버튼(이름/전화/주소/주문번호)
  - undefined 노출 방지(구형/누락 필드 fallback)
  - 커밋: `3791715` + `5cb17b3` + `8304ed4` + `65f8741` + `6027709` + `1dbe27c` + `de9e61c`
- [x] (Admin Setup MVP) 관리자 셋업 화면 추가
  - `/admin`: 사장님 생성, 상품 CSV 업로드(상품번호/상품명), 상품→사장님 배정(자동분류), 주문 엑셀 업로드, 미분류 주문 배정, 발송처리 엑셀 다운로드
  - 상단 상태 배지 + 권장 운영 순서 추가 (초보 운영자 UX 개선)
  - 커밋: `c730c30` + `8825f5a` + `21019d0`
- [x] (Safety MVP) JSON 무결성/감사로그 최소 구현
  - atomic JSON write(tmp→rename) + backups/ (7일 정리)
  - audit JSONL(data/audit.jsonl) + vendor 주요 액션 로깅
  - 커밋: `b0b4e4c`
- [x] (Admin) 주문 엑셀 업로드(+비번 입력) → 복호화/파싱 → orders.json 저장
  - 업로드: /admin (multipart 업로드)
  - API: `POST /api/admin/orders_xlsx_import`
  - 커밋: `7eafa3c`
- [x] (Import) 주문 업로드 시 상품번호 기반 vendor 자동 할당 + 미분류 카운트 제공
- [x] (Admin) 발송처리 업로드 엑셀(4열) 생성(+분할)
  - API: `GET /api/admin/shipping_export.xlsx`
  - 분할: `?chunk=0&size=2000`
  - 커밋: `5fcbc9f`
- [x] (IG) 인스타 세미 자동화: 브랜드가이드 + 생성기 + 검증기 + 큐/스케줄러
  - UI: `/admin/instagram`
  - 커밋: `bb1cb6c`
- [x] (IG) 카드뉴스 이미지 생성 + zip 패키지(Playwright) + 캡션 블록 조합
  - 커밋: `8535f6f`
- [x] (IG) 상품 이미지 업로드 → 1페이지(HOOK) 삽입(A)
  - 커밋: `c0d2df6`
- [x] (IG) 업로드 UX 안정화 + webp/png 지원 + Playwright closed 재시도
  - 커밋: `cd4be2f` + `697c53f` + `7c454bc`
- [x] (IG) 제품 이미지 삽입 안정화(Playwright file:// 로딩 불안정 제거)
  - webp 업로드 시 png 변환: `e399854`
  - 제품이미지 data URI(base64) 임베드로 1페이지 삽입 확정: `5a71834`
- [ ] (WIP) 미리캔버스/망고보드 스타일 분석 → 판매형 10종 세트 구조 스펙 작성
- [x] (Admin) 발송처리 다운로드 버튼(/admin UI) + 미분류 주문 빠른 매핑 UX
  - 커밋: `8825f5a`
- [x] (External access MVP) Cloudflare Quick Tunnel로 외부 접속 링크 발급 (실험용)
  - Vendor/Admin 동일 호스트에서 동작
  - 주의: trycloudflare는 끊길 수 있음 → 운영은 Named Tunnel로 전환 필요
  - 관련 문서: automation/dashboard/docs/cloudflare-tunnel.md
- [x] (Hotfix) vendor 주문 엑셀 다운로드 요청 시 서버 크래시 → scriptsDir 정의로 fix
  - 커밋: `de9e61c`
- [x] (Admin UX) 모바일 BasicAuth 팝업/URL credentials로 인스타 draft 생성(fetch) 에러 발생 → cookie login 페이지 추가
  - URL: `/admin/login` → 로그인 후 `/admin`, `/admin/instagram`
  - 커밋: `f520da9`
- [ ] (Next) 운영용 Cloudflare Named Tunnel + 고정 도메인 + 접근제어
- [ ] (Next) 관리자 승인(락) (업로드/수정 방지용)
- [x] (IG) Opus 프롬프트 v2 전환 최적화 요구사항 추가 (세트/슬라이드 선택, price stack, brand mini-kit)
  - 커밋: `da54621`
- [ ] (Next) IG: 판매형 template set(7장) + 슬라이드 선택/재정렬 + price stack 컴포넌트
  - Opus 4.6 V3 요약 수령(구현 스펙):
    - 이미지 포맷 검증 + truncate/overflow 방지
    - 10개 신규 템플릿 + price stack + 듀얼 CTA
    - 7페이지 파이프라인 + 슬라이드 선택 UI + slide_types API
  - TODO: 실제 코드 반영 여부 확인 → 스모크 테스트 → 커밋 정리
- [ ] (Next) IG: 미리캔버스/망고보드 스타일 리서치 → ‘사람이 만든’ 판매형 10종 세트 구조 정의
- [x] (Ops) 서브 에이전트 통합 대시보드(`/agents`) + 30분 자동워커 스캐폴딩
  - `/agents` (BasicAuth): 장군/서기/디자이너 상태 + handoff 타임라인
  - 30분 워커: ops/backlog.json → ops/handoff.jsonl TASK 기록(스캐폴딩)
  - 커밋: `da0db12`, `af047ce`, `6de40cf`
- [x] (IG) 뷰티(팔로워 성장) 30일 캘린더/템플릿/샘플 패키지 v1
  - 파일: `ops/ig/calendar-30d.md`, `ops/ig/templates.md`, `ops/ig/examples.md`
  - 커밋: `b4b9202`
- [ ] (Later) 네이버 업로드 자동화(Playwright) 안정화

---

## 📊 세션 상태
- Model: openai-codex/gpt-5.2
- Context: 60% (241k/400k)
- Usage: (see memory/usage-tracker.json)

## 🔗 개발자 링크
- 서브 에이전트 대시보드: `/agents` (BasicAuth)
  - ID: `han`
  - PW: `devpass`
