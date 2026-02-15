# 24h Auto Worker Plan (v1)

- Cadence: every 30 minutes
- Agents: 장군(dev), 서기(qa), 디자이너(designer)
- Data:
  - ops/backlog.json
  - ops/handoff.jsonl
  - ops/status/{dev,qa,ig}.md

## Worker loop
1) pick 1 todo per owner -> mark queued
2) append TASK to handoff.jsonl
3) main agent dispatches tasks to subagent sessions
4) subagents reply REPORT -> main appends REPORT to handoff.jsonl and updates status/*.md
5) if blocked: backlog item -> blocked w/ reason + needFromHan

## Bottleneck checks (서기 설계)
- blocked reasons + 10 rules

## IG semi-automation (디자이너)
- daily flow + TG reminders + state machine
