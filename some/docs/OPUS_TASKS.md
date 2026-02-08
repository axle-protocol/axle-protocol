# Opus(Claude Code) 요청 작업 목록 — SOME (2026-02-08)

목표: Clo가 런타임/관제/가드레일을 구현하는 동안, Opus는 **한국어 문장 이해/대화 생성 품질**을 책임진다.

---

## 0) 공통 제약
- 타겟: 한국(카톡/인스타 DM) 연애/썸/연인 대화
- 보안/리스크: 사칭/선넘기/민감주제(돈/주소/계좌/링크/성적동의) 방지
- 출력은 “제2의 나”이므로 **내 말투 + 선택 모드(다정/쿨/공감)** 레이어를 만족해야 함

---

## 1) Reply 생성 프롬프트 템플릿 설계 (핵심)
### 입력
- 상대 메시지(최근 N개 컨텍스트)
- 관계 단계(썸/연인)
- 상대 MBTI(선택)
- 내 말투 샘플(30~100개에서 추출된 룰 요약)
- Style Mode: 내말투/다정/쿨/공감
- 토글: ㅋㅋ/ㅎㅎ, 이모지, 줄바꿈, 오타 유지, 길이, 플러팅 강도(0~3), boundaryFilter
- 금칙/원칙 리스트

### 출력(JSON 권장)
- replyCandidates: string[3] (후보 3개)
- bestReply: string
- rationale: string (1줄)
- riskFlags: string[] (민감 주제 감지 결과)

요청: 위 입출력에 맞는 **고정 프롬프트 템플릿** 2종
- Training Mode용(조심/안전 우선)
- Autopilot용(자연스러움/속도 우선)

---

## 2) 한국형 Style 토글 해석 가이드
요청: 토글 각각이 문장에 어떻게 반영되는지 “룰표” 작성
- ㅋㅋ/ㅎㅎ: off/low/high
- 이모지: off/low/high (이모지 사용 시 과하지 않게, 한국 카톡 톤)
- 줄바꿈: oneLine/twoLine/choppy
- 오타 유지: keep/medium/clean
- 길이: S/M/L
- 플러팅 0~3: 예시 포함
- 다정/쿨/공감 프리셋의 기본값 제안

---

## 3) boundaryFilter(선 넘는 표현 차단) 정책
요청: 연애 대화에서 “선 넘는” 범위를 정의하고 필터 규칙 작성
- 성적 동의/강요/불법/금전요구/개인정보(주소/계좌)/만남장소 과도한 집착 등
- 안전하게 대체할 ‘완곡 표현’ 패턴

---

## 4) MBTI 활용 가이드(과학처럼 말하지 말기)
요청: MBTI를 ‘부드러운 힌트’로 쓰는 문구 가이드
- "MBTI상 ~" 단정 금지
- "보통 이런 성향이면 ~가 편할 수 있어" 톤
- 각 MBTI 그룹(예: F/T, J/P)별 대화 팁 1~2줄씩

---

## 5) 출력 JSON 스키마 고정 + Risk taxonomy
요청: 런타임에서 파싱/검증이 가능하도록 **고정 JSON 스키마**를 제안해줘.

필수 필드:
- `replyCandidates: string[3]`
- `bestReply: string`
- `rationale: string` (1줄)
- `riskFlags: string[]`
- `shouldBlock: boolean` (boundaryFilter 기준)
- `blockReason?: string`

Risk taxonomy(라벨 목록)도 함께 정의:
- MONEY
- ADDRESS
- ACCOUNT
- LINK
- SEXUAL_CONSENT
- HATE_HARASSMENT
- ILLEGAL
- SELF_HARM
- OTHER

---

## 6) 속도 최적화용 “짧은 프롬프트” 버전
요청:
- Autopilot Window에서 latency를 줄이기 위한 **짧은 프롬프트 템플릿** 작성
- 다만 안전(shouldBlock/riskFlags)은 반드시 유지

---

## 7) 평가 체크리스트
요청: 답장 품질을 빠르게 평가하는 체크리스트(10항목)
- 자연스러움, 과한 플러팅 여부, 질문 1개 포함, 맥락 유지, 금기 위반 없음 등

---

## 산출물 형식
- `some/docs/LLM_PROMPTS.md` (프롬프트 템플릿 + 예시)
- `some/docs/STYLE_RULES_KR.md` (토글/프리셋 룰표)
- `some/docs/SAFETY_POLICY.md` (boundaryFilter/금칙)

(가능하면) 각 문서에 예시 3개씩 포함.
