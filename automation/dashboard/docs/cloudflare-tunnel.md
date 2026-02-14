# Cloudflare Tunnel (vendor portal external access)

## Quick tunnel (no account)

```bash
cloudflared tunnel --url http://localhost:3030 --no-autoupdate
```

- This prints a `https://*.trycloudflare.com` URL.
- **Not for production** (no uptime guarantee).

## Stop quick tunnel

```bash
pkill -f "cloudflared tunnel --url http://localhost:3030"
```

## Production (named tunnel)

Use Cloudflare Zero Trust dashboard + named tunnel so URL is stable and access can be locked down.

High level:
1. Create tunnel in Cloudflare dashboard
2. Install connector and login (`cloudflared tunnel login`)
3. Create config mapping hostname → `http://localhost:3030`
4. Run via launchd (user agent)
