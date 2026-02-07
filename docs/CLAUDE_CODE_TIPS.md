# Claude Code 70가지 파워 팁 요약

> 출처: Anthropic 해커톤 우승자 ykdojo + Anthropic DevRel Ado Kukic
> 분석일: 2026-02-07

---

## 🔥 즉시 적용할 핵심 팁

### 1. 큰 문제 분해 (ykdojo #3)
```
❌ "로그인 페이지 만들어줘"
✅ "1. DB 스키마 설계 → 2. ORM 마이그레이션 → 3. UI 컴포넌트 → 4. API 로직 → 5. 테스트"
```

### 2. 계획 모드 vs YOLO 모드 (Ado #18, #19)
- **Shift+Tab 2번** → 계획 모드 (코드 실행 전 검토)
- **--dangerously-skip-permissions** → YOLO 모드 (컨테이너에서만!)

### 3. 컨텍스트 관리 (ykdojo #8)
```bash
# 대화가 길어지면 HANDOFF.md 생성
> "HANDOFF.md에 시도한 것, 성공/실패, 다음 단계 정리해줘"
> /clear
> "@HANDOFF.md 이어서 작업해줘"
```

### 4. ! Prefix (Ado #4)
```bash
# Claude 처리 없이 즉시 실행
> !git status
> !npm test
```

### 5. 필수 명령어
| 명령어 | 설명 |
|--------|------|
| `/usage` | 토큰 사용량 확인 |
| `/context` | 컨텍스트 X-Ray |
| `/clear` | 대화 초기화 |
| `/stats` | 사용 통계 |
| `/clone` | 대화 복제 |

### 6. 키보드 단축키
| 단축키 | 기능 |
|--------|------|
| `Esc Esc` | 되감기 (Undo) |
| `Ctrl+R` | 히스토리 검색 |
| `Ctrl+B` | 백그라운드로 보내기 |
| `Tab` | 제안 수락 |

---

## 🚀 생산성 향상 팁

### 7. 터미널 별칭 (ykdojo #7)
```bash
# ~/.zshrc에 추가
alias c='claude'
alias cc='claude --continue'
alias cr='claude --resume'
```

### 8. 세션 관리 (Ado #9-12)
```bash
claude --continue      # 마지막 세션 이어가기
claude --resume name   # 이름으로 재개
/rename auth-refactor  # 세션 이름 붙이기
/export                # 마크다운으로 내보내기
```

### 9. 음성 코딩 (ykdojo #2)
- **superwhisper** (macOS, $30) — 키보드 단축키로 음성→텍스트
- 타이핑 40단어/분 vs 말하기 150단어/분 = **3.75배 빠름**

### 10. Extended Thinking (Ado #19)
```
> "ultrathink: 이 아키텍처의 장단점을 깊이 분석해줘"
```
→ 32k 토큰까지 내부 추론에 할당

---

## 🔧 고급 기능

### 11. MCP (Model Context Protocol)
```bash
# Playwright (브라우저 자동화)
claude mcp add -s user playwright npx @playwright/mcp@latest

# Supabase (DB 직접 쿼리)
claude mcp add -s user supabase npx @supabase/mcp@latest
```

### 12. Hooks (규칙 강제)
```json
{
  "hooks": {
    "PreToolUse": {
      "command": "bash",
      "args": ["-c", "if echo $TOOL_INPUT | grep -q 'rm -rf /'; then exit 1; fi"]
    }
  }
}
```

### 13. 서브에이전트
```
> "security-auditor 에이전트를 백그라운드에서 실행해줘"
```
- 각자 독립적인 200k 컨텍스트
- 병렬 실행 가능
- 작업 완료 후 결과 반환

### 14. 컨테이너 격리 (ykdojo #21)
```bash
docker run -it --rm \
  -v $(pwd):/workspace \
  -e ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY \
  claude-sandbox

# 컨테이너 안에서만 YOLO 모드 사용
claude --dangerously-skip-permissions
```

---

## 💡 철학 & 사고방식

### 15. 추상화 수준 선택 (ykdojo #32)
- **Vibe Coding**: 전체 구조만 파악 (프로토타입)
- **Deep Dive**: 코드 라인 단위 검토 (프로덕션)

### 16. 자동화의 자동화 (ykdojo #41)
> "같은 작업을 3번 이상 반복하면 자동화하라"

### 17. 10억 토큰 규칙 (ykdojo #22)
> "AI를 진정으로 이해하려면 많은 토큰을 소비하라"

### 18. 지식 공유 (ykdojo #42)
> "공유 과정에서 새로운 것을 배운다"

---

## 📋 체크리스트

### 즉시 적용
- [ ] 터미널 별칭 설정 (`c`, `cc`, `cr`)
- [ ] `/context` 명령어로 컨텍스트 확인 습관
- [ ] `!` prefix로 빠른 명령어 실행
- [ ] HANDOFF.md 패턴 사용

### 1주 내 적용
- [ ] 음성 코딩 도구 설치 (superwhisper)
- [ ] 자주 사용하는 워크플로우 슬래시 명령어로 만들기
- [ ] MCP 서버 1개 연동

### 1개월 내 적용
- [ ] Hooks로 위험한 명령어 차단
- [ ] 컨테이너 워크플로우 구축
- [ ] 서브에이전트 활용

---

## 참고 링크

- [ykdojo claude-code-tips](https://github.com/ykdojo/claude-code-tips)
- [Ado Advent of Claude](https://adocomplete.com/advent-of-claude-2025/)
- [r/ClaudeAI](https://www.reddit.com/r/ClaudeAI/)
