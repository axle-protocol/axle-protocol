# Claude Code (Opus 4.6) Prompt — IG 카드뉴스(3~5장) 이미지 생성 + 템플릿 200~300 조합 확장 + 반자동 업로드 패키지

> Repo: `/Users/hyunwoo/.openclaw/workspace/automation/dashboard`
> Server: `automation/dashboard/server.mjs`
> Existing IG UI: `http://localhost:3030/admin/instagram`
> Constraints: **자동 업로드 금지(반자동만)**, 크리덴셜 저장 금지, PII 없음(IG), 저장소는 `/automation/dashboard/data/*.json`, audit.jsonl 기록.

## 목표 (이번 3~4시간 작업 범위)
한국 타겟 **스킨케어 공동구매**용 인스타 운영을 위해:

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

### 페이지 구성(3~5장)
- 1: HOOK (시크릿딜/친근)
- 2: WHY (핵심 장점 2~3)
- 3: PROOF/DETAIL (타겟/사용팁/주의 1)
- 4: OFFER (가격/구성/마감/배송)
- 5: CTA (프로필 링크 or 댓글 ‘공구’) + 작은 면책/주의

### 디자인 톤
- Luxury minimal: 큰 여백, 과한 이모지/느낌표 금지, 굵은 산세리프(대체폰트 OK)
- “너에게만 알려준다” 요소는 1페이지 hook에만 강하게

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

### 톤
- 공구 90%: offer/cta 강화
- 정보 10%: 과학/성분 “너무 딥하지 않게” 한 줄 정도로 신뢰만 추가

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
