# TOOLS.md - Local Configuration

Skills define _how_ tools work. This file is for _your_ specifics.

## 🖥️ Remote Nodes

### Mac mini (현우의 Mac mini)
- **Type:** macOS node
- **Use for:** macOS-only commands, Peekaboo, screen capture
- **Access:** `nodes.run` with node name

## 🔧 Configured Tools

### Peekaboo (macOS)
- Full permissions: Screen Recording ✅, Accessibility ✅
- Run via remote node

### Git/GitHub
- CLI: `gh` authenticated
- Org: `axle-protocol`
- Primary repo: `axle-protocol/axle-protocol`

### Solana
- Network: Devnet
- Wallet: `22bFtzYzGtz9rm9wVLK2mXhqjYquKo6h8xM1EyiTzBqN`
- Program: `4zr1KP5Rp4xrofrUWFjPqBjJKciNL2s8qXt4eFtc7M82`

### Web Search
- Provider: Brave Search API
- Key: Configured in gateway

## 📁 Key Paths

```
/Users/hyunwoo/.openclaw/workspace/     # Home workspace
/Users/hyunwoo/projects/ai-market/      # AgentMarket repo (legacy)
/Users/hyunwoo/.openclaw/workspace/option-c/  # AXLE Protocol
```

## 🔑 Environment Variables

All sensitive keys stored in:
- `.env.local` files (per-project)
- Vercel environment variables
- Never in git history (unless Han explicitly approves)

## ⚠️ Rate Limits

| Service | Limit | Notes |
|---------|-------|-------|
| Groq API | 100K tokens/day | Free tier |
| Brave Search | 2000 queries/mo | Free tier |
| Solana RPC | 100 req/10s | Devnet default |

---

Add specifics as you discover them.
