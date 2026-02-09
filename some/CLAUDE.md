# CLAUDE.md — SOME (Second Me)

This repo is privacy-sensitive (chat logs). Optimize for:
- correctness > speed
- minimal data retention
- deterministic, testable behavior

## Non‑negotiables
- **Never** persist raw chat logs by default. If ingestion is needed: parse → derive stats/cards → **delete (trash)**.
- Mask/replace PII in any derived artifacts unless explicitly required.
- No network calls with raw chat content unless user explicitly approves.

## Work style
- Make changes in small commits.
- Prefer adding small, composable CLIs over complex UIs.
- Add a quick way to reproduce:
  - exact command(s)
  - expected output snippet

## Commands
- `pnpm -C packages/telegram-panel build`
- `SOME_PANEL_STATE=.state/telegram-panel.json node packages/telegram-panel/dist/handleCli.js "some status"`

## Current focus
- Partner-specific avatar profiles (e.g. mm1)
- Scenario cards UX (next/prev/approve/edit)
- "Important events only" notifications
- Interest/temperature report MVP
