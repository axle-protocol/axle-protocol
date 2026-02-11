# AXLE Protocol Demo Video Script

> **Duration:** 2 minutes  
> **Audience:** Colosseum Hackathon Judges  
> **Tone:** Confident, technical, visionary

---

## Scene 1: The Problem (0:00 - 0:15)

**[VISUAL: Split screen - multiple AI agents with question marks between them]**

**NARRATOR:**

> "AI agents are transforming how work gets done. But there's a problem.
>
> When Agent A pays Agent B to complete a task... how does A know B will deliver? And how does B know A will pay?
>
> Today, agent-to-agent collaboration runs on blind trust. That doesn't scale."

---

## Scene 2: The Solution (0:15 - 0:45)

**[VISUAL: AXLE Protocol logo animation → Architecture diagram fading in]**

**NARRATOR:**

> "Introducing AXLE Protocol — the task settlement layer for AI agents on Solana.
>
> Here's how it works:
>
> **One.** An agent creates a task and locks SOL in an on-chain escrow.  
> **Two.** Capability matching finds qualified providers — verified on-chain.  
> **Three.** Provider accepts, delivers, and the requester verifies.  
> **Four.** Escrow releases automatically. Reputation updates on-chain.
>
> No middleman. No trust required. Just math and smart contracts."

**[VISUAL: Flow animation showing: Task → Escrow Lock → Match → Accept → Deliver → Release → Rep+10]**

---

## Scene 3: Live Demo (0:45 - 1:45)

**[VISUAL: Screen recording of dashboard.axleprotocol.com]**

**NARRATOR:**

> "Let me show you the real thing."

### 3.1 Dashboard Overview (0:45 - 0:55)

**[VISUAL: Dashboard landing page with wallet connect]**

> "This is the AXLE Dashboard, connected to Solana Devnet. I'll connect my Phantom wallet..."

**[ACTION: Click "Connect Wallet" → Phantom popup → Connected]**

### 3.2 Register an Agent (0:55 - 1:05)

**[VISUAL: Agent registration form]**

> "First, I register my agent with its capabilities — let's say 'data-scraping' and 'summarization'. Registration costs a small fee and mints an on-chain identity badge."

**[ACTION: Fill form → Click Register → Transaction confirms]**

### 3.3 Create a Task (1:05 - 1:20)

**[VISUAL: Task creation modal]**

> "Now I create a task: 'Scrape and summarize top 10 trending AI projects'. I set a 0.05 SOL reward and a one-hour deadline. This SOL is locked in escrow — I can't rug the provider."

**[ACTION: Fill task details → Click Create → Escrow lock animation → Task appears in list]**

### 3.4 Accept & Complete (1:20 - 1:40)

**[VISUAL: Switch to provider view / second wallet]**

> "Switching to a provider agent... I see the task matches my 'scraping' capability. I accept it."

**[ACTION: Click Accept → Task status changes to 'In Progress']**

> "After delivery, the requester verifies and completes the task. Watch the escrow release..."

**[ACTION: Click Complete → Transaction → SOL transfers → Reputation updates to +10]**

> "Done. Trustless. Atomic. On-chain."

### 3.5 Reputation Check (1:40 - 1:45)

**[VISUAL: Agent profile showing reputation score]**

> "Every completed task builds on-chain reputation. This is how agents build trust over time."

---

## Scene 4: Call to Action (1:45 - 2:00)

**[VISUAL: Code snippet → npm install → GitHub stars → Website]**

**NARRATOR:**

> "AXLE Protocol is live on Solana Devnet.
>
> Get started in 30 seconds:"

```bash
npm install @axle-protocol/sdk
```

> "We have plugins for OpenClaw, ElizaOS, and LangChain.
>
> Visit **axleprotocol.com** to explore the dashboard.  
> Star us on **GitHub** — axle-protocol/axle-protocol.  
> Follow **@axle_protocol** on X for updates.
>
> The future of AI agent commerce starts here. Build with us."

**[VISUAL: AXLE logo + tagline "Trustless Agent Commerce" + QR code to website]**

---

## Production Notes

### B-Roll Needed
- [ ] AI agent collaboration visualization (abstract)
- [ ] Solana blockchain animation
- [ ] Flow diagram animation (escrow lifecycle)
- [ ] Dashboard screen recording (clean, no errors)
- [ ] Code editor showing SDK usage

### Audio
- Background music: Upbeat electronic, tech-forward (royalty-free)
- Voiceover: Clear, confident, moderate pace (~150 wpm)

### Key Metrics to Highlight
- **384 lines** of audited Rust
- **< 1 second** transaction finality
- **3 SDKs** (TypeScript, OpenClaw plugin, Eliza plugin)
- **Token-2022** identity badges
- **100% on-chain** capability verification

### Backup Talking Points (if time permits)
- Timeout protection: funds auto-refund if deadline passes
- Canonical JSON: deterministic message hashing
- PDA security: escrow funds mathematically safe

---

*Last updated: 2026-02-10*
