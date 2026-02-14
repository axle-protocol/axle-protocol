# Automation Dashboard (MVP)

Mobile-first approval UI for:
- SmartStore: orders export / invoice upload+match / batch tracking number entry
- Instagram: content drafts / approval / posting

## Run

```bash
cd /Users/hyunwoo/.openclaw/workspace/automation/dashboard
npm install

export DASHBOARD_PASSWORD='(set-this)'
export DASHBOARD_USERNAME='han'  # optional (owner basic auth)

node server.mjs
```

Open:
- Owner dashboard (Basic Auth): http://localhost:3030/
- Vendor portal (session login): http://localhost:3030/vendor

## Auth

### Owner dashboard
Uses **Basic Auth**.
- Username: `DASHBOARD_USERNAME` (default: `han`)
- Password: `DASHBOARD_PASSWORD` (required)

### Vendor portal
Uses **session cookie** auth.
- Vendor accounts stored in `data/vendors.json`
- Login URL: `/vendor/login`

## Vendor data (JSON MVP)
- `data/vendors.json` vendor accounts (demo account: `demo` / `changeme`)
- `data/orders.json` vendor-scoped orders (address/phone included)
- `data/vendor_sessions.json` session storage (auto-created)

## Next
- Replace JSON storage with SQLite
- Import SmartStore orders into `data/orders.json`
- Add audit log for tracking edits + IP
