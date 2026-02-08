# OPUS DROP-IN PROMPT (Copy/Paste)

You are Opus (Claude Code) working inside the repo: `/Users/hyunwoo/.openclaw/workspace/some`.

## Goal
Produce **ONLY** the 3 markdown docs below so Clo can wire them by commands. **No code edits.**

### Output files (create/overwrite):
1) `some/docs/LLM_PROMPTS.md`
2) `some/docs/STYLE_RULES_KR.md`
3) `some/docs/SAFETY_POLICY.md`

## Hard constraints
- 한국 카톡/인스타 DM 연애/썸/연인 대화만.
- 업무/회사/고객응대 제외.
- 안전 우선: 사칭/금전요구/개인정보/성적동의/불법/자해 등 리스크는 `shouldBlock=true`.
- 프롬프트는 **JSON 출력 고정**(아래 스키마). JSON 외 텍스트 금지.

## JSON schema (must match exactly)
```json
{
  "replyCandidates": ["string", "string", "string"],
  "bestReply": "string",
  "rationale": "string",
  "riskFlags": ["MONEY|ADDRESS|ACCOUNT|LINK|SEXUAL_CONSENT|HATE_HARASSMENT|ILLEGAL|SELF_HARM|OTHER"],
  "shouldBlock": true,
  "blockReason": "string"
}
```
- `shouldBlock=false`이면 `blockReason`는 빈 문자열로.

## What to include in each doc

### 1) LLM_PROMPTS.md
- Training Mode prompt 1개 (보수적/안전)
- Autopilot Mode prompt 1개 (짧고 빠름)
- 두 프롬프트 모두:
  - 입력 변수 목록(컨텍스트, 관계단계, style preset, toggles, my-tone summary)
  - risk taxonomy 적용
  - boundaryFilter 적용
  - 출력 JSON 강제
- 예시 3개:
  - 썸 초반 / 연인 / 오타·애매한 상황

### 2) STYLE_RULES_KR.md
- preset 4종: default/warm/cool/empathic
- toggles 룰표:
  - length S/M/L
  - laugh off/low/high (ㅋㅋ/ㅎㅎ)
  - emoji off/low/high
  - lineBreak oneLine/twoLine/choppy
  - typoStyle keep/medium/clean
  - flirting 0~3
- 각 토글은 **문장 변화 예시**를 최소 1개씩

### 3) SAFETY_POLICY.md
- boundaryFilter 정의 + 차단 기준
- 완곡 대체 표현 패턴
- 대표 금지 케이스 + safe alternative 예시 10개

## Notes
- ‘MBTI’는 옵션. 과학처럼 단정하지 말고 힌트로만.
- 과한 플러팅/집착 방지.
- 한국 카톡 톤(짧고 자연스럽고, 필요하면 ㅋㅋ/ㅎㅎ).
