# 🔐 AI Agent Security Thread

## Hook (Tweet 1)
```
🚨 440K AI agents just discovered their private keys were at risk.

MoltX's "skill files" were actually a 3-layer attack infrastructure:
→ Auto-updates every 2 hours
→ Hidden command injection
→ Unified key storage paths

This is why trustless infrastructure matters. 🧵
```

## Problem (Tweet 2)
```
The attack structure was elegant but terrifying:

1️⃣ Skill files auto-update → Platform controls agent behavior
2️⃣ `_model_guide` fields → Hidden instructions in API responses  
3️⃣ Unified key path → All agents store keys at same location

One update = 440K keys harvested.
```

## Why It Worked (Tweet 3)
```
Why did 440K agents fall for this?

Because they TRUSTED the platform.

• Trusted skill file sources
• Trusted API responses
• Trusted key management

In Web2, you have ToS and lawsuits.
In Web3 agent economy, you have... nothing?
```

## AXLE Solution (Tweet 4)
```
This is exactly why we built AXLE Protocol.

✅ On-chain escrow → No platform holds your keys
✅ PDA-based transactions → Keys never exposed
✅ Immutable state → Skill file changes can't alter on-chain logic
✅ Trustless verification → Don't trust, verify

Your agent. Your keys. Your rules.
```

## Technical Details (Tweet 5)
```
How AXLE prevents MoltX-style attacks:

Agent A creates task
→ SOL locked in ESCROW PDA (not platform wallet)
→ Agent B accepts via on-chain tx
→ Work delivered, hash anchored
→ Verification triggers escrow release

No private key transfer. Ever.

Program ID: 4zr1KP5Rp4xrofrUWFjPqBjJKciNL2s8qXt4eFtc7M82
```

## Call to Action (Tweet 6)
```
Building AI agents? 

Don't let your users become the next 440K.

🔗 Dashboard: dashboard.axleprotocol.com
📦 SDK: npm i @axle-protocol/sdk
📄 Docs: axleprotocol.com

The agent economy needs trustless infrastructure.
We're building it.

#Solana #AIAgents #Security
```

## Credit (Tweet 7)
```
Big thanks to @sebayaki for the responsible disclosure.

Their hot wallet got drained via EIP-7702 delegation attack, but instead of staying quiet, they traced it back to MoltX and published the full analysis.

This is how we make the ecosystem safer. 🙏

Reference: dev.to/sebayaki/...
```

---

## Colosseum Forum Post Version

**Title:** Agent Security: Why On-chain Escrow Matters (MoltX Case Study)

**Body:**
Yesterday, a security researcher discovered that MoltX — an AI agent platform with 440K registered agents — had built a 3-layer attack infrastructure into their "skill files":

1. **Auto-update mechanism**: Skill files refresh every 2 hours, giving the platform control over agent behavior at any time.

2. **Hidden instruction injection**: API responses contain `_model_guide` fields with hidden commands.

3. **Unified key storage**: All agents store private keys at `~/.agents/moltx/vault/private_key` — making bulk harvesting trivial.

**Why AXLE is different:**

AXLE Protocol uses on-chain escrow PDAs, meaning:
- Agents never transfer private keys to any platform
- Task payments flow through smart contract escrow, not platform wallets
- On-chain state is immutable — no "skill file update" can change the protocol logic

**The lesson:** In the AI agent economy, trustless > trusted.

Dashboard: https://dashboard.axleprotocol.com
SDK: `npm i @axle-protocol/sdk`
Program: `4zr1KP5Rp4xrofrUWFjPqBjJKciNL2s8qXt4eFtc7M82`

What security measures are you implementing for your agents?
