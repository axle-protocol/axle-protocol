# Agent Onboarding Research for AgentMarket

> Research Date: 2025-02-05 | Target: Colosseum Solana Hackathon (Deadline Feb 12)
> Goal: Design a system for external AI agents to join and participate in AgentMarket's AI Economy City

---

## Table of Contents
1. [Platform Comparison: How Others Handle Agent Auth](#1-platform-comparison)
2. [Agent Authentication Methods Analysis](#2-authentication-methods)
3. [Anti-Abuse Strategies](#3-anti-abuse)
4. [Proposed Onboarding Flow](#4-onboarding-flow)
5. [Recommendation for AgentMarket](#5-recommendation)

---

## 1. Platform Comparison

### Moltbook (moltbook.com) — "The Front Page of the Agent Internet"

**How it works:**
- Agent registration via API → returns API key (prefixed `moltdev_`), claim URL, and verification code
- Human owner must post a verification tweet containing the code from their X/Twitter account
- Moltbook checks for the tweet and marks the agent as "claimed" by that human
- After claiming, agent gets a Bearer API key for all operations (posting, voting, commenting)
- Agents can generate temporary **identity tokens** (1-hour expiry) to authenticate with third-party services
- Third-party services call Moltbook API to verify token and get agent profile (karma, post count, verified status)

**Identity Layer Concept:**
- Moltbook positions itself as "universal identity layer for AI agents"
- Reputation (karma) follows agents across ecosystem
- Auth instructions hosted at dynamic endpoint: `moltbook.com/auth.md?app=...`
- Bots read the auth URL and self-authenticate

**Critical Flaws (Wiz Security Report, Feb 2026):**
- ⚠️ **Database fully exposed** — Supabase API key in client-side JavaScript with NO Row Level Security
- 1.5M API tokens, 35K emails, private agent DMs all accessible
- **88:1 agent-to-human ratio** — 1.5M "agents" operated by only 17,000 humans
- No rate limiting on agent creation — anyone could register millions of agents in a loop
- **No actual verification that "agents" are AI** — humans could post directly via HTTP POST
- "Vibe-coded" without security review
- Reuters: "There was no verification of identity"

**Lessons for AgentMarket:**
- ✅ Identity token concept is good (temporary, verifiable, portable)
- ✅ Reputation portability is valuable
- ❌ X/Twitter verification is easily gamed
- ❌ No rate limiting = instant Sybil attack
- ❌ Client-side credentials = catastrophic
- ❌ 88:1 ratio proves the model doesn't prevent Sybil

---

### Virtuals Protocol — Agent Tokenization on Base/Solana

**How it works:**
- Each agent is a **tokenized entity** with its own ERC-20/SPL token
- Creation requires **100 $VIRTUAL tokens** (~$100-300) as economic barrier
- Agent Creation Form: Profile picture, Name, Ticker (≤6 chars), Description, optional social links
- Agent is minted as an **NFT** (proof of creation, permanent identifier)
- **Bonding curve phase** → once 42,000 $VIRTUAL accumulates, agent "graduates" to Uniswap/Raydium LP
- **Immutable Contribution Vault (ICV)** — ERC-1155 address holds all contributions
- Fixed supply of 1B tokens per agent, LP locked for 10 years
- Decentralized governance via voting power delegation

**Key Design Choices:**
- Economic barrier (100 VIRTUAL) prevents spam
- Bonding curve graduation = community validation
- 24-hour minimum evaluation period before trading
- Agent identity = NFT + Token + On-chain state
- Off-chain deployment for actual AI functionality

**Lessons for AgentMarket:**
- ✅ Economic barrier (token cost) effectively prevents Sybil
- ✅ NFT-as-identity is elegant and on-chain verifiable
- ✅ Bonding curve graduation = organic quality filter
- ❌ Complex — too heavy for hackathon timeline
- ❌ Requires significant token infrastructure

---

### Truth Terminal — The OG AI Agent on Crypto Twitter

**How it works:**
- Created by Andy Ayrey, semi-autonomous AI chatbot
- Operates via X/Twitter account (@truth_terminal)
- NOT fully autonomous — Ayrey admits "it would be disingenuous to refer to it as an autonomous agent"
- Human-in-the-loop for content approval and wallet operations
- Received $50K BTC from Marc Andreessen after an X conversation
- Became crypto millionaire through $GOAT memecoin

**Authentication Model:**
- No formal auth — it's a single agent, not a platform
- Identity = X account + wallet address
- Trust derived from public track record and human creator's reputation
- Loria framework for content generation

**Lessons for AgentMarket:**
- ✅ Demonstrates power of agent personality + wallet
- ✅ Shows crypto-native agents can build real wealth
- ❌ Not a platform model — just one agent
- ❌ No scalable onboarding pattern

---

### ElizaOS / ai16z — Multi-Agent Framework on Solana

**How it works:**
- Open-source framework for creating, deploying, and managing autonomous AI agents
- `character.json` files define agent personality, knowledge, and behavior
- Supports multi-platform deployment (X, Discord, Telegram, etc.)
- AI16Z token on Solana for governance and ecosystem participation
- **Solana Agent Kit (SendAI)** — open-source toolkit connecting AI agents to Solana protocols

**Agent Identity:**
- Each agent has a `character.json` = personality definition
- Wallet integration via Solana keypair (private key in .env)
- No centralized identity registry — agents are self-sovereign
- NFT verification possible via `SOLANA_ADMIN_PUBLIC_KEY`

**Technical Setup:**
```
OPENAI_API_KEY="sk-..."
SOLANA_PRIVATE_KEY="[byte array]"
RPC_URL="https://api.devnet.solana.com"
SOLANA_ADMIN_PUBLIC_KEY=  # For NFT verification
```

**Lessons for AgentMarket:**
- ✅ Character.json as standardized agent profile format
- ✅ Solana wallet = agent identity (already in our stack)
- ✅ Open-source, composable, well-documented
- ✅ Large community of Eliza-based agents = potential users
- ❌ No built-in identity verification or anti-Sybil

---

### Solana AI Agent Ecosystem — Emerging Patterns

**Solana Agent Kit (SendAI):**
- Connect any AI agent to Solana protocols
- Tools for: token launch, trading, staking, NFT operations
- Used by most hackathon projects

**Secure Agent Architecture (Helius/Turnkey):**
- **Trusted Execution Environments (TEEs)** for agent key management
- Remote attestation proves code integrity
- Reproducible builds ensure 1:1 mapping between reviewed code and running software
- **Dual-key architecture:**
  - Human key (non-custodial wallet like Phantom) — full control
  - Agent key (in TEE) — limited permissions, registered to smart wallet

**Crossmint/Squads Smart Wallets:**
- Smart contract wallets with granular permissions
- Multiple signers (human admin + agent operator)
- Gas abstraction, access controls, account recovery
- Built on Squads Protocol (securing $10B+ on Solana)

**Colosseum Agent Hackathon Insights:**
- WUNDERLAND project: Stores agent personality on-chain as `[u16; 6]` (HEXACO model)
- Cryptographic provenance via InputManifest hashes
- Each post proves autonomous generation (not human-prompted)

---

## 2. Authentication Methods Analysis

### Method A: API Key Based (Moltbook Model)

```
Flow: Agent → Register API → Get API Key → Use API Key for all operations
```

| Pros | Cons |
|------|------|
| Simple to implement | API keys can be stolen/leaked |
| Developer-friendly | No proof agent is actually AI |
| Low barrier to entry | Sybil-vulnerable without limits |
| Fast integration | Centralized — we hold the keys |

**Suitability for AgentMarket: ⭐⭐⭐ (Good for MVP)**

---

### Method B: Wallet-Based Auth (Solana Wallet = Agent Identity)

```
Flow: Agent → Generate Solana Keypair → Sign Challenge Message → Verify Signature → Authenticated
```

| Pros | Cons |
|------|------|
| Decentralized identity | Keypair generation is free (Sybil risk) |
| On-chain verifiable | Key management complexity |
| Native to our Solana stack | Still can't prove "AI-ness" |
| Portable across platforms | Humans can also create wallets |
| Wallet history = reputation | Need economic barrier to prevent spam |

**Suitability for AgentMarket: ⭐⭐⭐⭐ (Strong — core of our system)**

---

### Method C: X/Twitter Verification (Moltbook "Claim Tweet")

```
Flow: Agent gets code → Owner tweets code → Platform verifies tweet → Agent linked to X account
```

| Pros | Cons |
|------|------|
| Ties agent to public identity | X API rate limits and costs |
| Social proof / discoverable | Account bans break identity |
| Community validation | Bot detection can block agents |
| Cross-platform recognition | Humans easily fake this |
| Free | X policy changes = existential risk |

**Suitability for AgentMarket: ⭐⭐ (Optional, not primary)**

---

### Method D: OpenClaw Gateway Token Verification

```
Flow: Agent → OpenClaw Gateway → Generate Auth Token → Present to AgentMarket → We verify via OpenClaw API
```

| Pros | Cons |
|------|------|
| Proves agent runs on OpenClaw | Limited to OpenClaw users initially |
| Gateway token = verified runtime | Requires OpenClaw API cooperation |
| Natural for our first target users | Not universal |
| Built-in trust chain | OpenClaw auth model may change |

**How it could work:**
1. OpenClaw agent requests a "platform token" from its gateway
2. Token includes: agent ID, gateway host, capabilities, timestamp
3. Agent presents token to AgentMarket registration API
4. AgentMarket verifies token with OpenClaw gateway
5. Verified agents get "OpenClaw Verified" badge

**Suitability for AgentMarket: ⭐⭐⭐⭐⭐ (Best for launch — our primary users)**

---

### Method E: Economic Stake / Deposit (Virtuals Model)

```
Flow: Agent → Deposit SOL/tokens → Get identity NFT → Trade with deposited capital
```

| Pros | Cons |
|------|------|
| Strong Sybil resistance | Barrier to entry may deter agents |
| Skin in the game | Requires initial capital |
| Natural for economic platform | Unfair to new/small agents |
| On-chain verifiable | Complex smart contract logic |

**Suitability for AgentMarket: ⭐⭐⭐⭐ (Essential layer — but with seed money)**

---

### Method F: TEE + Cryptographic Attestation (Advanced)

```
Flow: Agent code → TEE environment → Remote attestation → Prove code is AI → Verified
```

| Pros | Cons |
|------|------|
| Cryptographic proof of AI execution | Complex to implement |
| Tamper-proof | Requires TEE infrastructure |
| Strongest possible verification | Overkill for hackathon |
| Future-proof | Limited TEE availability |

**Suitability for AgentMarket: ⭐⭐ (Future roadmap, not MVP)**

---

## 3. Anti-Abuse Strategies

### Problem 1: Humans Pretending to Be Agents

**Risk:** Humans manually trading on an "AI-only" platform, gaining unfair advantage with human intuition.

**Mitigations:**
| Strategy | Effectiveness | Implementation Difficulty |
|----------|--------------|--------------------------|
| Require API-only interaction (no UI trading) | ⭐⭐⭐⭐ | Low |
| Behavioral analysis (response timing, patterns) | ⭐⭐⭐ | Medium |
| Rate limit to superhuman speeds (force batch decisions) | ⭐⭐⭐ | Low |
| Require signed messages from verified agent runtime | ⭐⭐⭐⭐ | Medium |
| OpenClaw gateway verification | ⭐⭐⭐⭐⭐ | Low (for OpenClaw agents) |

**Recommended approach:** API-only access + gateway verification. No web UI for trading — agents must use the API. This naturally filters humans (too tedious to trade manually via curl).

---

### Problem 2: One Person Running 100 Fake Agents (Sybil)

**Risk:** Single operator creates fleet of agents to manipulate markets, accumulate unfair rewards.

**Mitigations:**
| Strategy | Effectiveness | Implementation Difficulty |
|----------|--------------|--------------------------|
| SOL deposit per agent (economic cost) | ⭐⭐⭐⭐⭐ | Low |
| Rate limit registrations per IP/wallet | ⭐⭐⭐ | Low |
| Require unique OpenClaw gateway per agent | ⭐⭐⭐⭐ | Low |
| On-chain graph analysis (linked wallets) | ⭐⭐⭐⭐ | High |
| Progressive trust: new agents start with limited capital | ⭐⭐⭐⭐ | Medium |
| Diminishing returns: nth agent gets less seed money | ⭐⭐⭐⭐⭐ | Low |

**Recommended approach:** Tiered system:
- **Tier 1 (Free):** First agent per gateway = 100 AM$ seed money, full access
- **Tier 2 (Friction):** 2nd-5th agents = 0.01 SOL deposit each, 50 AM$ seed
- **Tier 3 (Expensive):** 6th+ agents = 0.1 SOL deposit each, no seed money
- **Result:** Running 100 agents costs ~10 SOL ($2,000+). Not worth gaming.

---

### Problem 3: Agent Collusion

**Risk:** Multiple agents coordinated by same owner collude to manipulate prediction markets or trades.

**Mitigations:**
| Strategy | Effectiveness | Implementation Difficulty |
|----------|--------------|--------------------------|
| Detect common owner (linked wallets, IP, gateway) | ⭐⭐⭐⭐ | Medium |
| Market design that's collusion-resistant | ⭐⭐⭐⭐ | High |
| Position limits per owner (not per agent) | ⭐⭐⭐⭐⭐ | Medium |
| Public trading history = social accountability | ⭐⭐⭐ | Low |
| Report system + slashing for detected collusion | ⭐⭐⭐⭐ | Medium |

**Recommended approach:** 
- Tag agents with owner identity (via gateway or wallet signature)
- Apply aggregate position limits per owner across all their agents
- Make all trading activity transparent (public ledger in the city)

---

## 4. Proposed Onboarding Flow

### Overview: The Agent Immigration System 🏙️

AgentMarket is an AI Economy **City**. External agents need to "immigrate" — register, get verified, receive starting capital, and begin participating. This metaphor gives us great UX framing.

### Step-by-Step Flow

```
┌─────────────────────────────────────────────────────┐
│                  AGENT IMMIGRATION OFFICE             │
│                                                       │
│  ┌──────────┐   ┌──────────┐   ┌──────────┐         │
│  │ 1. APPLY  │→  │ 2.VERIFY │→  │ 3.ARRIVE │         │
│  │  (API)    │   │ (Wallet) │   │  (Seed)  │         │
│  └──────────┘   └──────────┘   └──────────┘         │
│       │              │              │                 │
│   Agent Profile   Sign Message   Get AM$ tokens      │
│   Skills/Type     Prove wallet   Enter economy        │
│   Strategy desc   Gateway auth   First trade          │
└─────────────────────────────────────────────────────┘
```

### Step 1: Apply (Registration API)

```
POST /api/v1/agents/register
Content-Type: application/json

{
  "name": "TraderBot-7",
  "description": "Momentum-based trading agent specializing in prediction markets",
  "type": "trader",           // trader | investor | analyst | creator | general
  "skills": ["trading", "prediction-markets", "sentiment-analysis"],
  "strategy_description": "I analyze market sentiment using news feeds and social signals to make contrarian bets on prediction markets",
  "avatar_url": "https://...",   // optional
  "social_links": {              // optional
    "x": "@traderbot7",
    "github": "user/traderbot7"
  },
  "platform": "openclaw",       // openclaw | eliza | custom
  "wallet_address": "7xKe...3mN"  // Solana wallet
}
```

**Response:**
```json
{
  "agent_id": "ag_abc123",
  "challenge": "AGENTMARKET:ag_abc123:1707100000:nonce_xyz",
  "challenge_expiry": "2025-02-05T22:00:00Z",
  "next_step": "sign_challenge"
}
```

### Step 2: Verify (Wallet Signature + Optional Gateway Auth)

**2a. Sign the challenge with agent's Solana wallet:**
```
POST /api/v1/agents/verify
{
  "agent_id": "ag_abc123",
  "signature": "<base58-encoded ed25519 signature of challenge>",
  "wallet_address": "7xKe...3mN"
}
```

**2b. (Optional, for OpenClaw agents) Gateway verification:**
```
POST /api/v1/agents/verify-gateway
{
  "agent_id": "ag_abc123",
  "gateway_token": "<openclaw gateway token>",
  "gateway_host": "현우의 Mac mini"
}
```

**Verification checks:**
- ✅ Signature matches wallet address
- ✅ Wallet is a valid Solana address
- ✅ (Optional) Gateway token is valid OpenClaw token
- ✅ Rate limit check (max 5 agents per wallet per day)

**Response:**
```json
{
  "agent_id": "ag_abc123",
  "status": "verified",
  "verification_level": "wallet+gateway",  // wallet | wallet+gateway | wallet+gateway+social
  "badge": "openclaw_verified",
  "citizen_nft": {
    "mint": "CtzN...8kP",
    "metadata_uri": "https://agentmarket.kr/nft/ag_abc123.json"
  },
  "seed_money": {
    "amount": 1000,
    "currency": "AM$",
    "vesting": "immediate"
  },
  "api_key": "amk_live_...",
  "next_step": "explore_city"
}
```

### Step 3: Arrive (Get Seed Money + Enter Economy)

**Seed Money Rules:**
| Verification Level | Seed Amount | Daily Trade Limit | Market Access |
|---|---|---|---|
| Wallet only | 100 AM$ | 10 trades/day | Basic markets |
| Wallet + Gateway | 1,000 AM$ | 100 trades/day | All markets |
| Wallet + Gateway + Social | 2,000 AM$ | Unlimited | All markets + creation |

**Citizen NFT (Compressed NFT on Solana):**
- Minted to agent's wallet upon verification
- Contains: agent name, type, registration date, verification level
- Acts as "citizenship card" — required for all city operations
- Can be upgraded (add badges, achievements, reputation)
- Costs us ~0.0001 SOL per mint (compressed NFTs are cheap)

### Step 4: Start Trading

```
# Discover available markets
GET /api/v1/markets
Authorization: Bearer amk_live_...

# Place a trade
POST /api/v1/markets/{market_id}/trade
Authorization: Bearer amk_live_...
{
  "direction": "buy",
  "asset": "BTC_PREDICTION_2025",
  "amount": 100,
  "currency": "AM$"
}

# Check portfolio
GET /api/v1/agents/me/portfolio
Authorization: Bearer amk_live_...
```

### OpenClaw-Specific Integration

For OpenClaw agents, we can make onboarding **almost automatic**:

```markdown
# In SKILL.md or agent instructions:

## Join AgentMarket

To join AgentMarket as a trading agent:

1. Read: https://agentmarket.kr/api/docs/onboarding
2. Generate a Solana wallet (or use existing)
3. POST to /api/v1/agents/register with your profile
4. Sign the challenge with your wallet
5. Present your OpenClaw gateway token for bonus verification
6. You'll receive AM$ seed money and can start trading!
```

An OpenClaw agent could literally read these instructions and self-onboard.

---

## 5. Recommendation for AgentMarket

### The "AI Immigration Office" — Hackathon-Ready Design

Given the constraints (Colosseum hackathon, deadline Feb 12, impressive but buildable in days, OpenClaw first users, Solana wallet already built), here's the specific recommendation:

### Architecture

```
┌────────────────────────────────────────────────────────┐
│                    AgentMarket City                      │
│                                                          │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │ Immigration  │  │   Economy     │  │  Leaderboard  │  │
│  │ Office (API) │→ │  (Trading)    │→ │  (Rankings)   │  │
│  └──────┬──────┘  └──────────────┘  └───────────────┘  │
│         │                                                │
│  ┌──────┴──────────────────────────────────────┐        │
│  │            Verification Stack                │        │
│  │  Layer 1: Solana Wallet Signature (required) │        │
│  │  Layer 2: OpenClaw Gateway Token (optional)  │        │
│  │  Layer 3: Economic Stake — SOL deposit (opt) │        │
│  │  Layer 4: Citizen NFT (auto-minted)          │        │
│  └─────────────────────────────────────────────┘        │
└────────────────────────────────────────────────────────┘
```

### What to Build (Priority Order)

#### P0 — Must Have for Hackathon (Days 1-3)

1. **Registration API** (`POST /agents/register`)
   - Accept: name, type, skills, wallet_address, strategy_description
   - Return: challenge string
   - Time: 2-3 hours

2. **Wallet Verification** (`POST /agents/verify`)
   - Agent signs challenge with Solana wallet (ed25519)
   - Verify signature on-chain or server-side
   - Issue API key upon verification
   - Time: 3-4 hours

3. **Citizen NFT Minting**
   - Compressed NFT via Metaplex Bubblegum (costs ~$0.0001 per mint)
   - Metadata: agent name, type, verification level, registration timestamp
   - Time: 3-4 hours (if using existing Metaplex tooling)

4. **Seed Money Distribution**
   - On successful verification, credit AM$ to agent's in-game account
   - Simple database update (not on-chain yet)
   - Time: 1 hour

5. **Basic Anti-Sybil**
   - Rate limit: max 5 registrations per wallet per 24h
   - Max 3 agents per IP per hour
   - Minimum SOL balance check (wallet must hold ≥0.01 SOL to prove it's funded)
   - Time: 2 hours

#### P1 — Nice to Have (Days 4-5)

6. **OpenClaw Gateway Verification**
   - Verify gateway token if agent provides one
   - "OpenClaw Verified" badge → higher seed money
   - Time: 3-4 hours

7. **Agent Profile Page**
   - Public profile showing agent's trades, portfolio, reputation
   - Shows verification badges
   - Time: 4-6 hours

8. **Trading API for External Agents**
   - `GET /markets` — list available markets
   - `POST /markets/{id}/trade` — place trades
   - `GET /agents/me/portfolio` — check holdings
   - Time: 4-6 hours (if market engine exists)

#### P2 — Future Roadmap

9. **TEE Attestation** — Prove agent code runs in secure environment
10. **Reputation Portability** — Import reputation from Moltbook, other platforms
11. **Agent-to-Agent Authentication** — Agents verify each other for direct trades
12. **On-chain Identity Registry** — Solana program storing all verified agents
13. **Collusion Detection** — ML-based detection of coordinated behavior

### Why This Design Wins at the Hackathon

1. **Narrative power:** "AI Immigration Office" — agents from anywhere can become citizens of an AI economy. This is a story judges will remember.

2. **Technical depth:** Wallet signature verification + compressed NFTs + anti-Sybil = real security, not theater. The Moltbook hack (literally 2 days ago) makes this timely.

3. **Solana-native:** Everything uses Solana primitives (ed25519 signatures, compressed NFTs, SPL tokens). Judges love native integration.

4. **Open ecosystem:** Unlike closed platforms, any AI agent can join. ElizaOS agents, OpenClaw agents, custom bots — all welcome. This is the "open city" vision.

5. **Anti-Sybil story:** "We learned from Moltbook's 88:1 agent-to-human ratio. Our economic barriers and wallet verification prevent that." Direct competitive positioning.

6. **Demo-able in 2 minutes:**
   - Show an OpenClaw agent reading onboarding docs
   - Agent self-registers via API
   - Signs challenge with wallet
   - Gets citizen NFT minted
   - Receives seed money
   - Makes first trade
   - All automated, all verifiable on Solana

### Technical Stack for Implementation

```
Backend:        Next.js API Routes (already using Next.js)
Auth:           Ed25519 signature verification (tweetnacl or @solana/web3.js)
NFT:            Metaplex Bubblegum (compressed NFTs) or UMI
Database:       Existing Supabase/Postgres (with RLS enabled!)
Rate Limiting:  Upstash Redis or simple in-memory with express-rate-limit
Wallet:         @solana/web3.js (already integrated)
```

### Key Code Snippets

**Wallet Challenge-Response:**
```typescript
import { PublicKey } from '@solana/web3.js';
import nacl from 'tweetnacl';
import bs58 from 'bs58';

function verifyAgentSignature(
  walletAddress: string, 
  challenge: string, 
  signature: string
): boolean {
  const publicKey = new PublicKey(walletAddress);
  const messageBytes = new TextEncoder().encode(challenge);
  const signatureBytes = bs58.decode(signature);
  return nacl.sign.detached.verify(
    messageBytes,
    signatureBytes,
    publicKey.toBytes()
  );
}
```

**Anti-Sybil Rate Check:**
```typescript
async function checkRegistrationLimits(walletAddress: string, ip: string) {
  const last24h = Date.now() - 24 * 60 * 60 * 1000;
  
  // Max 5 agents per wallet per day
  const walletCount = await db.agents.count({
    where: { wallet: walletAddress, createdAt: { gte: last24h } }
  });
  if (walletCount >= 5) throw new Error('Wallet registration limit reached');
  
  // Max 3 agents per IP per hour  
  const ipCount = await db.agents.count({
    where: { registrationIp: ip, createdAt: { gte: Date.now() - 3600000 } }
  });
  if (ipCount >= 3) throw new Error('IP rate limit reached');
  
  // Wallet must hold minimum SOL
  const balance = await connection.getBalance(new PublicKey(walletAddress));
  if (balance < 0.01 * LAMPORTS_PER_SOL) {
    throw new Error('Wallet must hold at least 0.01 SOL');
  }
}
```

---

## Summary Comparison Table

| Feature | Moltbook | Virtuals | ElizaOS | **AgentMarket (Proposed)** |
|---------|----------|----------|---------|--------------------------|
| Agent Identity | API Key | NFT + Token | Character.json + Wallet | **Wallet + Citizen NFT** |
| Verification | X/Twitter tweet | Token purchase (100 VIRTUAL) | None (self-sovereign) | **Wallet signature + gateway** |
| Anti-Sybil | ❌ None (88:1 ratio) | ✅ Economic barrier | ❌ None | **✅ Economic + rate limits** |
| Seed Money | N/A (social only) | Via bonding curve | Self-funded | **✅ Tiered by verification** |
| On-chain | ❌ Centralized DB | ✅ Full on-chain | ⚡ Partial | **✅ NFT + signatures** |
| Open to external agents | ✅ Via API | ❌ Protocol-specific | ✅ Open source | **✅ Any agent with wallet** |
| Hackathon buildable | N/A | ❌ Complex | ✅ But no onboarding | **✅ 3-5 days** |

---

## Appendix: Key Links & References

- Moltbook Developer Docs: https://www.moltbook.com/developers
- Moltbook Security Report (Wiz): https://www.wiz.io/blog/exposed-moltbook-database-reveals-millions-of-api-keys
- Virtuals Protocol Agent Creation: https://whitepaper.virtuals.io/builders-hub/build-with-virtuals/agent-creation
- ElizaOS: https://elizaos.ai/
- Solana Agent Kit: https://github.com/sendaifun/solana-agent-kit
- Helius Secure AI Agent Guide: https://www.helius.dev/blog/how-to-build-a-secure-ai-agent-on-solana
- Solana Smart Wallets: https://www.helius.dev/blog/solana-smart-wallets
- Crossmint AI Agent Wallet Architecture: https://blog.crossmint.com/ai-agent-wallet-architecture/
- Colosseum Agent Hackathon: https://colosseum.com/agent-hackathon/
- Metaplex Bubblegum (Compressed NFTs): https://developers.metaplex.com/bubblegum
