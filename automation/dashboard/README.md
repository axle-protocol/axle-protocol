# Automation Dashboard (MVP)

Mobile-first approval UI for:
- SmartStore: orders export / invoice upload+match / batch tracking number entry
- Instagram: content drafts / approval / posting

## Run

```bash
cd /Users/hyunwoo/.openclaw/workspace/automation/dashboard
export DASHBOARD_PASSWORD='(set-this)'
export DASHBOARD_USERNAME='han'  # optional
node server.mjs
```

Open:
- http://localhost:3030

## Auth
Uses **Basic Auth**.
- Username: `DASHBOARD_USERNAME` (default: `han`)
- Password: `DASHBOARD_PASSWORD` (required)

## Next
- Replace placeholders with real queue (SQLite/JSON)
- Add approve/hold actions + execution logs
- Add Telegram: only send 1 notification + link
