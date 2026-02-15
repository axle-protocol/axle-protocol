# ops/

서브 에이전트(역할 분리) 운영용 폴더.

- `ops/handoff.jsonl` : 메인→서브 / 서브→메인 인수인계 로그(한 줄 JSON)
- `ops/status/*.md` : 각 에이전트의 현재 상태/다음 액션

## Handoff 포맷

메인→서브:
```json
{"type":"TASK","to":"dev","title":"...","goal":"...","definitionOfDone":["..."],"constraints":["..."],"contextLinks":["..."],"questions":["..."]}
```

서브→메인:
```json
{"type":"REPORT","from":"dev","now":"...","done":["..."],"blocked":["..."],"next":["..."],"needFromHan":["..."]}
```
