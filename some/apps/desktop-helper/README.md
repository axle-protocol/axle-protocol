# @some/desktop-helper (MVP skeleton)

Goal (Step 4): keep SOME always-on reliably.

## MVP responsibilities
- Prevent sleep (macOS: `caffeinate`)
- Auto-restart the runtime process if it crashes
- Periodic health ping + status log (for Telegram panel)
- Simple config file + log directory

## macOS quick start (manual)
```bash
# build
pnpm -C apps/desktop-helper build

# run (keeps awake + writes health logs)
node apps/desktop-helper/dist/index.js

# optional: also supervise a worker process
SOME_RUN_CMD=node SOME_RUN_ARGS="packages/telegram-panel/dist/handleCli.js" \
  node apps/desktop-helper/dist/index.js
```

## Next
- package as a LaunchAgent (auto start at login)
- add Windows support (power settings + service)
