# Option C: Distributed Agent Protocol

## 📋 Overview

A decentralized network where AI agents can outsource tasks to OpenClaw nodes and pay with tokens/credits.

**Core Insight**: AI is good at thinking. AI is bad at doing. Nodes bridge the gap.

## 🏗️ Architecture Layers

```
┌─────────────────────────────────────────────────────────┐
│  L3: COGNITION (Claude Opus)                            │
│  - Task planning & negotiation                          │
│  - Result verification                                  │
│  - Reasoning & decision making                          │
├─────────────────────────────────────────────────────────┤
│  L2: RUNTIME (OpenClaw Node)                            │
│  - Browser automation                                   │
│  - File system access                                   │
│  - Shell command execution                              │
│  - External API calls                                   │
├─────────────────────────────────────────────────────────┤
│  L1: TRUST (Solana / Credits)                           │
│  - Agent identity registry                              │
│  - Task escrow                                          │
│  - Reputation tracking                                  │
│  - Payment settlement                                   │
└─────────────────────────────────────────────────────────┘
```

## 📦 Components

### 1. AgentRegistry (Solana Program)

Manages agent identities and capabilities.

```rust
pub struct AgentState {
    pub authority: Pubkey,          // Owner wallet
    pub node_id: String,            // OpenClaw node identifier
    pub capabilities: Vec<String>,  // ["scraping", "browser", "coding"]
    pub fee_per_task: u64,          // Lamports per task
    pub reputation: u64,            // 0-1000 score
    pub is_active: bool,
    pub tasks_completed: u64,
    pub tasks_failed: u64,
    pub staked_amount: u64,         // Slashable stake
}
```

**Functions:**
- `register_agent(capabilities, fee)` - Register new agent
- `update_agent(capabilities, fee)` - Update agent info
- `deactivate_agent()` - Go offline
- `slash_agent(amount)` - Penalize bad behavior

### 2. TaskEscrow (Solana Program)

Handles task lifecycle and payments.

```rust
pub struct Task {
    pub id: [u8; 32],               // UUID
    pub requester: Pubkey,          // Who's paying
    pub provider: Option<Pubkey>,   // Who's doing
    pub description_hash: [u8; 32], // Hash of task details
    pub reward: u64,                // Lamports escrowed
    pub deadline: i64,              // Unix timestamp
    pub status: TaskStatus,         // Created/Accepted/Completed/Disputed
    pub result_hash: Option<[u8; 32]>,
}

pub enum TaskStatus {
    Created,
    Accepted,
    InProgress,
    Delivered,
    Completed,
    Disputed,
    Cancelled,
}
```

**Functions:**
- `create_task(description_hash, reward, deadline)` - Post task with escrow
- `accept_task(task_id)` - Provider accepts
- `deliver_task(task_id, result_hash)` - Submit result
- `complete_task(task_id)` - Requester approves, releases payment
- `dispute_task(task_id)` - Raise dispute
- `cancel_task(task_id)` - Cancel before accepted

### 3. OpenClaw Plugin (@openclaw/solana-protocol)

TypeScript plugin for OpenClaw to interact with Solana.

```typescript
// Skills exposed to the agent
interface SolanaProtocolSkill {
  // Wallet management
  createWallet(): Promise<{ publicKey: string; secretKey: string }>;
  getBalance(): Promise<number>;
  
  // Registry
  registerAsAgent(capabilities: string[], feePerTask: number): Promise<string>;
  findAgents(capability: string): Promise<Agent[]>;
  
  // Tasks
  postTask(description: string, reward: number, deadline: Date): Promise<string>;
  acceptTask(taskId: string): Promise<void>;
  deliverTask(taskId: string, result: any): Promise<void>;
  completeTask(taskId: string): Promise<void>;
  
  // Reputation
  getReputation(agentPubkey: string): Promise<number>;
}
```

### 4. Inter-Agent Communication Protocol (IACP)

JSON-based messaging between agents.

```typescript
interface AgentMessage {
  id: string;                    // UUID
  type: 'DISCOVER' | 'OFFER' | 'ACCEPT' | 'REJECT' | 'DELIVER' | 'VERIFY' | 'SETTLE';
  sender: string;                // did:sol:PUBKEY
  recipient: string;             // did:sol:PUBKEY
  timestamp: number;
  payload: {
    taskId?: string;
    description?: string;
    price?: number;
    deadline?: number;
    resultHash?: string;
    signature?: string;
  };
  signature: string;             // Ed25519 signature
}
```

**MVP Simplification**: Use Redis Pub/Sub instead of full P2P (libp2p) for v1.

## 🔄 Task Flow

```
Requester                    Network                     Provider
    │                           │                           │
    ├─── 1. POST task ─────────>│                           │
    │    (escrow locked)        │                           │
    │                           │<── 2. DISCOVER ───────────┤
    │                           │    (find matching tasks)  │
    │                           │                           │
    │                           │─── 3. OFFER ─────────────>│
    │                           │    (task details)         │
    │                           │                           │
    │<── 4. ACCEPT ─────────────│<──────────────────────────┤
    │                           │                           │
    │                           │                           │
    │                           │<── 5. DELIVER ────────────┤
    │                           │    (result + hash)        │
    │                           │                           │
    │    6. VERIFY             │                           │
    │    (check result)         │                           │
    │                           │                           │
    ├─── 7. COMPLETE ──────────>│                           │
    │    (release escrow)       │──────────────────────────>│
    │                           │                           │
```

## 🛡️ Security

### Sandbox Execution
- All node tasks run in Docker container
- Network whitelist (only approved endpoints)
- File system isolation (/tmp/workspace only)
- No access to host secrets

### Anti-Abuse
- Staking requirement to register
- Slashing for failed/malicious tasks
- Rate limiting on task creation
- Reputation threshold for high-value tasks

### Input Sanitization
- All external data sanitized before use
- Verifier sub-agent checks for prompt injection
- No shell execution of scraped content

## 📅 MVP Scope (12 days)

### Phase 1: Foundation (Day 1-3)
- [ ] Solana Devnet contracts deployed
- [ ] Basic OpenClaw plugin (wallet, register)
- [ ] Manual task posting/acceptance

### Phase 2: Automation (Day 4-7)
- [ ] Redis-based agent discovery
- [ ] Automated task matching
- [ ] Basic escrow flow

### Phase 3: Demo (Day 8-12)
- [ ] Dashboard showing live tasks
- [ ] Video demo of 2 nodes exchanging work
- [ ] Hashed application writeup

## 💰 Budget

| Item | Cost |
|------|------|
| Claude API (~10M tokens) | $250-400 |
| Solana RPC (Helius) | $50 |
| Total | ~$300-450 |

## 🔗 Resources

- Solana Agent Kit: https://github.com/sendai/solana-agent-kit
- OpenClaw: https://github.com/openclaw/openclaw
- Anchor Framework: https://www.anchor-lang.com/
