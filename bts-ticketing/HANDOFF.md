# HANDOFF — bts-ticketing

> Use this when switching between **Codex ↔ Claude Code** (or between sessions).
> Goal: someone can resume without re-reading the whole chat.

## Context
- Project: bts-ticketing (Interpark/NOL Playwright automation)
- Goal: maximize open-time success (booking → queue → seats), keep captcha manual by default.

## What I changed (since last handoff)
- 

## Files touched
- 

## How to test
```bash
cd bts-ticketing/src
python main_playwright.py --test --stop-after concert
python main_playwright.py --test --stop-after booking
# (then) python main_playwright.py --test --stop-after seats
```

## Known issues / risks
- Yanolja redirect + Turnstile variability can break unattended flow.

## Next steps (concrete)
- [ ] 

## Notes
- 
