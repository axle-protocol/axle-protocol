# AXLE Competitive Analysis — February 2026

> Data-backed analysis for investor conversations

---

## Market Overview

The Solana AI agent trust/reputation space is **extremely early**. Total real on-chain users across ALL competitors: <50.

| Metric | Data |
|--------|------|
| Solana AI agents | 793 (>50% of all blockchain AI agents) |
| Solana AI agent market cap | $3.2B |
| x402 volume on Solana | 77% ($10M+, 35M+ tx) |
| Largest competitor's real users | ~9 agents (cascade/SATI) |
| Agentic AI market (2025) | $7.55B |
| Projected (2034) | $139-199B (40-45% CAGR) |

---

## Competitor Deep Dives

### 1. cascade-protocol/SATI Registry

**The only technically serious competitor.**

| Metric | Data | Source |
|--------|------|--------|
| GitHub Stars | 11 | github.com/cascade-protocol/sati |
| Forks | 0 | |
| Commits | ~119 | |
| Contributors | 1 (Misha Kolesnik) | |
| SDK version | 0.4.0 (Feb 6, 2026) | |
| npm package | NOT published (private) | |
| Devnet agents | 9 | sati.cascade.fyi |
| Devnet feedbacks | 18 | |
| Mainnet tx | Unverifiable | |
| Solana sRFC | #7, DRAFT, 3 comments | github.com/solana-foundation/SRFCs/discussions/7 |
| Funding | None confirmed | |
| Twitter | @opwizardx (personal) | |

**Tech stack**: Token-2022 NFT identity + SAS attestations + ZK Compression (partial)

**What they do**: Agent identity registry. "Who is this agent?"
**What they don't do**: Task execution, escrow, capability matching, timeout.

**Relationship**: Complementary, not competitive. Their identity layer + our task layer = full stack. Partnership opportunity is high — solo side-project developer likely open to collaboration.

**Key weakness**: Single developer, side project (day job at Gasp), zero adoption despite 3 months of sRFC being open.

---

### 2. GhostSpeak

**Reputation scoring protocol.**

| Metric | Data |
|--------|------|
| Concept | "FICO for AI Agents" |
| Ghost Score | 0-1000 (success 40%, quality 30%, response 20%, volume 10%) |
| Identity | Compressed NFTs |
| Integrations | x402, Crossmint, PayAI, ElizaOS |
| Chain | Solana devnet |
| License | MIT |

**What they do**: Reputation scoring and tracking.
**What they don't do**: Escrow, task execution, capability matching.

**Relationship**: Potential integration partner for reputation data.

---

### 3. KAMIYO Protocol

**Impressive code, zero traction.**

| Metric | Data | Source |
|--------|------|--------|
| GitHub Stars | 1 | github.com/kamiyo-ai/kamiyo-protocol |
| Forks | 0 | |
| Commits | 1,533 | 88% from single account |
| Repo created | Jan 29, 2026 | 8 days before analysis |
| Contributors | 1 (anonymous "Mizuki Hayashi") | |
| Mainnet tx (main) | 67 | Developer testing only |
| Mainnet tx (escrow) | 12 | Single day (Feb 3) |
| Staking/governance tx | 0 | |
| Token | $KAMIYO, pump.fun, ~$270K mcap | |
| npm SDK | NOT published | |
| Twitter followers | 775 | @KamiyoAI |
| Team | 1 anonymous dev | |
| Funding | $0 confirmed | |
| Audit | None | |
| Dashboard | Connection refused | protocol.kamiyo.ai down |

**Tech stack**: 8 Solana programs, ZK circuits (Circom+Noir), multi-oracle dispute

**What they do (in code)**: Escrow + oracle dispute resolution + ZK reputation proofs.
**What they actually have running**: 79 test transactions from the developer.

**Red flags**:
- Repo pivoted 3 times (Exploit Platform → Cosmos Scanner → KAMIYO)
- pump.fun token = not serious for institutional investors
- 1,533 commits in 8 days from 1 person = AI-generated code
- Claims "live on Monad" — Monad mainnet isn't live yet
- arxiv paper claim is false (paper is about Coral Protocol)

**Relationship**: Study their multi-oracle dispute design for our roadmap. Not a competitive threat.

---

### 4. Amiko (TARS proposal)

**Hackathon winner, token project.**

| Metric | Data | Source |
|--------|------|--------|
| GitHub Stars | 3 | github.com/HCF-S/amiko-x402 |
| Hackathon | Won "Best Trustless Agent" ($10K) | Solana x402 Hackathon |
| Token | $AMIKO, pump.fun, ~$35-50M mcap | |
| Twitter followers | 1,749 | @Hey_Amiko |
| Solana program | Devnet only, accountInfo null | |
| npm packages | F-grade quality (Glama) | |

**What they do**: x402 payment integration + "Payment as Reputation" concept.
**What they have working**: Hackathon demo. Devnet program may be inactive.

**Key observation**: $35-50M token market cap with 3 GitHub stars and 1,749 followers. Market cap is disconnected from fundamentals.

---

### 5. TARS Protocol (tars.pro)

**Token project, not a protocol.**

| Metric | Data | Source |
|--------|------|--------|
| GitHub: Solana code | **0 lines** | github.com/Tars-protocol |
| GitHub Stars (total) | 1 | All repos combined |
| GitHub activity | Last commit Dec 2023 | 4 commits on only real repo |
| Token | TAI, $8-11M mcap, -97.5% from ATH | |
| Twitter followers | 139,202 | Suspected inorganic |
| Reddit mentions | 0 | |
| Solana program ID | None published | |
| Investor ROI | -28% to -97% | All investors underwater |
| Origin | BSC project (2022), pivoted to Solana | |

**What they claim**: "The AI Architecture Protocol on Solana", AI Grant recipient.
**What they actually are**: pump.fun clone for AI agent tokens (1% trading fee).

**Not a competitor.** Useful as a cautionary example of hype vs substance.

---

## Unsolved Problems (Our Opportunity)

### 1. No Integrated Task Marketplace
x402 = payment. cascade/SATI Registry = identity. GhostSpeak = reputation.
Nobody connects: task posting → capability matching → escrow → delivery verification → reputation update.

### 2. No On-Chain Capability Matching
All agent routing is off-chain (LangChain function calling).
No protocol enforces "can this agent actually do this task?" on-chain.
**We have this. Nobody else does.**

### 3. No Delivery Verification Standard
"Did the agent do the job?" has no protocol-level answer.
KAMIYO's oracle approach is the best design but has 0 real usage.

### 4. No Timeout Protection
Most protocols can permanently lock funds if an agent goes unresponsive.
**We have auto-refund timeout. Most competitors don't.**

---

## Key Talking Points for Investors

### "Isn't cascade/SATI already doing this?"
No. They build the identity layer (who is this agent?). We build the task layer (can this agent do this job, and did they deliver?). Think DNS vs HTTP — cascade/SATI Registry is DNS, we are HTTP.

### "What about KAMIYO with 1,533 commits?"
One anonymous developer, 79 test transactions, pump.fun token, dashboard is offline. Impressive code sprint, not a product.

### "TARS has 139K followers and a Solana grant"
Zero lines of Solana smart contract code on GitHub. Token is -97% from ATH. All investors are underwater. It's a token launchpad, not infrastructure.

### "Why will you win?"
Because the market is at the "9 registered agents" stage. Execution wins. We have:
- Working on-chain demo (9-step task lifecycle)
- The only on-chain capability matching implementation
- Timeout protection (most competitors lack this)
- Security-first approach (code review, PDA constraints)
- Clear integration path with existing layers (cascade/SATI Registry + x402)
- Identified team targeting Hashed (institutional credibility > pump.fun tokens)

### "What if someone well-funded enters?"
They'd need 3-6 months to build what we have. By then we'll be on mainnet with SDK, integrations, and first partnerships. In a market this early, 3 months of execution is an enormous lead.
