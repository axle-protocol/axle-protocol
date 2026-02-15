# Claude Code (Opus 4.6) Prompt — IG 카드뉴스(3~5장) 이미지 생성 + 템플릿 200~300 조합 확장 + 반자동 업로드 패키지

> Repo: `/Users/hyunwoo/.openclaw/workspace/automation/dashboard`
> Server: `automation/dashboard/server.mjs`
> Existing IG UI: `http://localhost:3030/admin/instagram`
> Constraints: **자동 업로드 금지(반자동만)**, 크리덴셜 저장 금지, PII 없음(IG), 저장소는 `/automation/dashboard/data/*.json`, audit.jsonl 기록.

## 목표 (이번 3~4시간 작업 범위)
한국 타겟 **스킨케어 공동구매**용 인스타 운영을 위해:

> NOTE (업데이트): v1(이미지 생성+zip+블록 조합) 완료 후, v2로 아래 “전환 최적화/판매형 템플릿” 요구사항을 추가한다.

1) **카드뉴스 이미지(3~5장) 생성 파이프라인** 추가
- “나노바나나프로급” 퀄리티 목표: 결과물이 허접하면 실패.
- 전략: **A(프로급 레이아웃 템플릿 10~20개 고정) + B(AI 무드/배경 생성 후 합성)**
- 카드뉴스는 **럭셔리 미니멀 비주얼 + 친근 정보형 흐름** (공구 90% + 정보 10%)

2) 캡션 템플릿을 “완성본 나열”이 아니라 **블록 조합형**으로 확장
- 유사도/반복 방지 포함
- 실사용 가능한 조합 템플릿 **200~300+** 확보

3) 반자동 운영 패키지
- 승인/스케줄 시: **포스팅 패키지(zip)** 생성
  - 이미지(카드 3~5장 PNG) + caption.txt + hashtags.txt
- 스케줄 시간 되면(=due) 텔레그램 리마인드로 “업로드 하세요” (자동 업로드 X)

---

## v2 요구사항 (전환 최적화/판매형 템플릿)
템플릿 앱/플랫폼(Canva/Adobe Express/Unfold/미리캔버스/망고보드 등)의 공통 성공 요인을 반영한다.

### v2-1) Template Set(세트) + Slide Picker
- 7장짜리 “공구 판매용 세트” 기본 제공 (7장 구성 예)
  1) Offer cover(HOOK + 제품컷 + 가격 앵커)
  2) 핵심 혜택 3-bullet
  3) 가격/구성/옵션 표
  4) 신뢰(리뷰/인증/누적/원산지 등 슬롯)
  5) 배송/교환/환불 micro-FAQ
  6) 주문 방법 3-step
  7) CTA end card (링크 메인 + 댓글 서브)
- 생성 시 3~7장 중 선택/제거/재정렬 가능

### v2-2) 제품컷 슬롯(1페이지 고정) — A 방식
- 운영자가 “상품 이미지 1장” 업로드하면 1페이지(HOOK)에 자동 삽입
- safe-zone + crop preset 지원 (정사각/세로/가로)
- shadow/outline 스타일 2~3개 제공 (서로 다른 셀러 사진도 일관성 있게)
- AI로 이미지를 새로 생성하는 방식(B)보다 안정적인 방식(A)을 우선한다.

### v2-3) Price Stack + CTA 블록 강제
- 가격/혜택/마감/배송을 “한 덩어리” 컴포넌트로 고정 (가독성/일관성)
- CTA는 듀얼 허용:
  - 메인 CTA(크게 1개): 프로필 링크 클릭
  - 서브 CTA(작게): 댓글 유도(‘링크’/‘공구’)

### v2-4) Brand mini-kit
- 최소: primary/accent color, 1~2 fonts, logo(optional)
- 브랜드 프로필 여러 개 저장/선택 가능

---

## 현재 코드 베이스(읽고 시작)
- IG API들은 `server.mjs`의 `// Instagram APIs` 섹션 참고
  - `GET/POST /api/admin/ig/guide`
  - `POST /api/admin/ig/posts` (draft 생성: variants)
  - `POST /api/admin/ig/posts/:id/approve` (승인+스케줄)
  - `GET /api/admin/ig/posts_due` (리마인드용)
- 템플릿 기반 draft 생성 함수:
  - `generateIgDrafts(params, guide)`
  - `IG_CAPTION_TEMPLATES` (현재 소수)

---

## 데이터 모델 (추가/확장 제안)
### data/ig_posts.json (기존)
각 post에 아래 필드 확장:
- `assets`: {
  - `cards`: [{ index, path, width, height }],
  - `zipPath`: string | null,
  - `generatedAt`: ISO,
  - `layoutId`: string,
  - `style`: { theme, palette, font } // 선택
}
- `imageStatus`: `none | generating | ready | failed`
- `imageError`: string | null

### data/ig_layouts.json (신규)
- 레이아웃(10~20개) 정의: 텍스트 박스/타이포/여백/정렬/컬러

### data/ig_caption_blocks.json (신규)
- blocks: hook[], benefits[], proof[], offer[], cta[]
- 각 block에 tags:
  - `tone`: `lux-minimal`, `friendly-info`, `secret-deal`
  - `ctaType`: A|C
  - `category`: skincare

---

## 이미지 생성 구현 (중요)
### 품질 원칙
- “AI 단독 이미지”는 들쭉날쭉 → **최종 카드는 템플릿이 퀄리티를 고정**
- AI는 **무드 배경/소재**만 생성

### 구현 옵션(권장)
- Node에서 이미지 합성: `sharp` 사용 (추가 dependency OK)
- 텍스트 렌더링: 
  - 1) `node-canvas`(설치 무거울 수 있음) 또는
  - 2) HTML 템플릿 + headless Chromium(Playwright)로 스크린샷 렌더링 (권장: 고퀄 타이포/레이아웃 쉬움)

#### 권장 아키텍처: HTML → 스크린샷 렌더
- `public/admin/instagram.html`에서 레이아웃 프리뷰에도 재사용 가능
- 서버에서 `/tmp/ig-render/...` 같은 곳에 HTML 생성 → Playwright로 1080x1350(Portrait) 렌더 → PNG 저장

### AI 이미지 생성 (배경)
- 1차 MVP는 “외부 API 키 없으면 동작하지 않게”
- 환경변수:
  - `OPENAI_API_KEY` 있으면 OpenAI Images API로 배경 생성
  - 없으면 fallback: 단색/그라데이션 배경 생성
- 절대 API 키를 파일에 저장하지 말 것

### 이미지 생성 엔드포인트
- `POST /api/admin/ig/posts/:id/generate_images`
  - body: `{ layoutId?, pageCount?: 3|4|5, theme?: 'lux-minimal', regenerate?: boolean }`
  - 결과: assets 업데이트
- `GET /api/admin/ig/posts/:id/package.zip`
  - 이미지 + caption/hashtags + meta.json 포함

### 페이지 구성(3~5장) — 공구형 최적화
- 1: HOOK (짧고 강하게)
  - 예: “이거… 진짜 괜찮아서 공구 엽니다” / “지금만 가격이 미쳤음”
- 2: WHY (핵심 장점 2~3개)
  - 1줄 근거 + 짧은 베네핏
- 3: DETAIL (사용팁/타겟/주의)
  - 예: “민감피부도 OK? → 패치테스트 권장”
- 4: OFFER (가격/구성/마감/배송) — 숫자는 크게
  - 예: “정가 39,000 → 공구가 19,900” (샘플)
  - 마감: “오늘 23:59” 또는 “수량 소진”
- 5: CTA (행동 1개만)
  - 댓글 ‘공구’ / DM ‘공구’ / 프로필 링크 중 하나 고정
  - 하단 작은 글씨로 안내 1~2줄(배송/교환/환불 등)

### 디자인 톤 (레퍼런스 반영)
레퍼런스 계정:
- 개인/친근 톤(로로뷰티 계열): https://www.instagram.com/rorobeauty48791/
- 럭셔리 미니멀(띰뷰티 계열): https://www.instagram.com/thimbeauty/

**비주얼(=thimbeauty 쪽을 베이스로 고정)**
- 배경: 아이보리/베이지/웜그레이/라이트핑크 계열 + 소프트 섀도우
- 톤: 미니멀, 여백 큼, 제품/텍스트만 또렷
- 스타일: “스튜디오 촬영 느낌” (과한 장식/클립아트 금지)
- 폰트: 굵은 산세리프(제목) + 얇은 산세리프(설명). 시스템 폰트로 대체 가능

**카피 톤(=rorobeauty 쪽의 말투를 상단 hook에만 섞기)**
- 1페이지 hook만: 친근하게 ‘솔직 후기/비밀공구/지금만’ 느낌
- 나머지 페이지는: 정보형/정돈된 문장(럭셔리 감성 유지)
- 과한 이모지/느낌표 연발 금지(최대 1~2개), “ㅋㅋ” 금지

**구성 비율**
- 공구/구매 유도 90% / 정보 10%
- 단, 정보 10%는 ‘신뢰’가 목적(성분/사용팁 1~2줄 수준)

**고정 룰**
- “너에게만 알려준다” 요소는 1페이지 hook에만 강하게
- 가격/구성/마감/배송 같은 핵심은 4~5페이지에서 명확히
- CTA는 5페이지에서 단일 행동으로: “댓글 ‘공구’” 또는 “DM ‘공구’” 또는 “프로필 링크” (한 게시물에는 1개만)

---

## 캡션 템플릿 200~300+ 확장(조합형)
### 현재 문제
- `IG_CAPTION_TEMPLATES`가 적어서 반복 빨리 옴

### 해결
- `generateIgDrafts`를 템플릿 단위가 아니라 **블록 조합**으로 변경/확장:
  - hook 40+
  - benefit bullets 30+
  - proof/detail 30+
  - offer 20+
  - cta 20+
- seed를 `productName + date + slot + category`로 확장
- 최근 30개 post의 caption과 유사한 조합은 제외(간단히 n-gram/문장 해시)

### 톤(블록 작성 가이드)
- 공구 90%: offer/cta가 ‘핵심’. 가격/구성/마감/배송을 애매하게 쓰지 말고 **명확히**.
- 정보 10%: “성분/사용팁/주의”를 1~2줄로만 넣어서 신뢰 확보.
- 금지: 의료적 효능 단정(치료/완치/의학적 보장), 과장(무조건/100%), 타 브랜드 비방.
- 추천 키워드(자연스러운 한국 공구 문법):
  - ‘공구 오픈’, ‘공구가’, ‘구성’, ‘마감’, ‘수량’, ‘선착순’, ‘배송’, ‘링크’, ‘댓글’, ‘DM’

---

## 반자동 업로드(텔레그램 리마인드)
- 자동 업로드는 하지 말 것
- due-posts(`GET /api/admin/ig/posts_due`) 결과를 기반으로:
  - “패키지(zip) 다운로드 링크/파일” + “캡션/해시태그 복사” 제공
- (선택) OpenClaw cron 시스템Event로 리마인더를 띄우는 방식은 메인 에이전트가 연결한다.
  - 서버는 `due`를 정확히 제공하면 됨.

---

## Admin UI 변경
`/admin/instagram`에 아래 추가:
- Queue 탭에서 post 선택 →
  - [이미지 생성] 버튼
  - [패키지 다운로드(zip)] 버튼
  - 이미지 생성 상태(ready/generating/failed)
  - 카드 프리뷰(thumb)

---

## 감사로그(audit.jsonl) 확장
이미지/패키지 관련 이벤트 기록:
- `IG_IMAGES_GENERATE_REQUESTED`
- `IG_IMAGES_GENERATED`
- `IG_IMAGES_GENERATE_FAILED`
- `IG_PACKAGE_DOWNLOADED`

---

## 테스트 / 검증
- 최소 1개 샘플 post로:
  - draft 생성 → approve → generate_images → package.zip 다운로드 성공
  - 이미지 1080x1350(또는 1080x1080 선택 가능) 규격 확인

---

## 커밋 가이드
- 작은 단위로 1~3 커밋
- 메시지 예:
  - `feat(ig): add cardnews image generation + package zip`
  - `feat(ig): expand caption templates via block combinator`
  - `ui(ig): add image generation controls + previews`

---

## 주의(필수)
- IG 자동 업로드 구현 금지
- 계정 비번/쿠키/토큰 저장 금지
- 외부 이미지/레퍼런스 크롤링은 “링크 저장” 수준만, 대량 수집/재배포 금지
- 실패 시 에러를 UI에 노출 + audit에 남길 것
