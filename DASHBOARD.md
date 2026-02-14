# DASHBOARD.md — 2026-02-14 23:25 KST

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
- [x] (Ops) 대시보드 서버 nohup 재기동 (SIGKILL 방지)
  - PID: 37663 (latest)
  - Log: /tmp/automation-dashboard.log
- [x] (Infra) Chrome Remote Desktop 접속 불가 이슈 복구
- [x] (Dashboard v2) 큐 JSON 저장 + 승인/보류 API + 실데이터 렌더링
- [x] (SmartStore) 주문조회 엑셀/발송처리 템플릿 구조 파악 + 키 확정
- [x] (Vendor Portal MVP) 사장님 포털 “실동작 버전” 구현 완료
  - 로그인(세션), 내 주문(주소/전화), 송장 입력(검증/정규화), 사장님용 주문 엑셀(xlsx) 다운로드
  - tracking 필드 호환/정규화 fix + 미처리 배지/미처리 우선 정렬
  - 배송정보 크게 표시 + 복사 버튼(이름/전화/주소/주문번호)
  - undefined 노출 방지(구형/누락 필드 fallback)
  - 커밋: `3791715` + `5cb17b3` + `8304ed4` + `65f8741` + `6027709` + `1dbe27c`
- [x] (Admin Setup MVP) 관리자 셋업 화면 추가
  - `/admin`: 사장님 생성, 상품 CSV 업로드(상품번호/상품명), 사장님↔상품 매핑(체크박스+검색)
  - 주문 엑셀 업로드 + 발송처리 엑셀 다운로드 버튼 + 미분류 주문 빠른 매핑 포함
  - 커밋: `c730c30` + `8825f5a`
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
- [x] (IG) 카드뉴스 이미지 생성(3~5장) 확장 작업용 Claude Code(Opus) 프롬프트 작성
  - 문서: `automation/dashboard/docs/claude-code-opus-ig-cardnews-imagegen-prompt.md`
  - 커밋: `e1a3992`
- [x] (Admin) 발송처리 다운로드 버튼(/admin UI) + 미분류 주문 빠른 매핑 UX
  - 커밋: `8825f5a`
- [x] (External access MVP) Cloudflare Quick Tunnel로 외부 접속 링크 발급 (실험용)
  - Vendor/Admin 동일 호스트에서 동작
  - 주의: trycloudflare는 끊길 수 있음 → 운영은 Named Tunnel로 전환 필요
  - 관련 문서: automation/dashboard/docs/cloudflare-tunnel.md
- [ ] (Next) 운영용 Cloudflare Named Tunnel + 고정 도메인 + 접근제어
- [ ] (Next) 관리자 승인(락) (업로드/수정 방지용)
- [ ] (Next) IG 레퍼런스 딥리서치(한국 공구 90%/정보 10%, 로로뷰티 톤) → 템플릿/블록 200~300 조합 확장
- [ ] (Later) 네이버 업로드 자동화(Playwright) 안정화

---

## 📊 세션 상태
- Model: openai-codex/gpt-5.2
- Context: 17% (69k/400k) — compaction 6회 (리셋됨)
- Usage: (see memory/usage-tracker.json)
