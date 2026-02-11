# AXLE Token Verification Architecture

> Trusted Token Usage Proof System for AI Agent Compute Marketplace

## Overview

AXLE Protocol requires a tamper-proof system to verify:
1. **Model Type**: Which AI model the agent actually used
2. **Token Count**: Exact number of tokens consumed
3. **Authenticity**: Proof cannot be forged or manipulated
4. **Real-time Settlement**: Immediate reward distribution

This document describes two complementary approaches to achieve trusted token verification.

---

## Problem Statement

### The Trust Gap

When an AI agent claims "I used GPT-4 and consumed 10,000 tokens", how can we verify this?

```
Agent Claims:        Actual Usage:         Problem:
─────────────       ─────────────         ────────
GPT-4               GPT-3.5               Model downgrade fraud
10,000 tokens       5,000 tokens          Inflated token count
$0.30 cost          $0.01 cost            10x+ overcharge
```

### Attack Vectors

1. **Model Substitution**: Claim expensive model, use cheap one
2. **Token Inflation**: Report higher token count than actual
3. **Response Fabrication**: Generate fake API responses locally
4. **Replay Attacks**: Reuse old API responses for new claims

---

## Solution: Two Verification Methods

### Method 1: AXLE Proxy API (Centralized, Simple)

AXLE server acts as a trusted intermediary between agents and LLM providers.

```
┌─────────┐     ┌──────────────┐     ┌─────────────┐
│  Agent  │────▶│ AXLE Proxy   │────▶│ OpenAI/     │
│         │◀────│ Server       │◀────│ Anthropic   │
└─────────┘     └──────────────┘     └─────────────┘
                       │
                       ▼
              ┌──────────────┐
              │ Usage Record │
              │ (Signed)     │
              └──────────────┘
                       │
                       ▼
              ┌──────────────┐
              │ Solana       │
              │ Settlement   │
              └──────────────┘
```

**Pros:**
- Simple to implement
- Works with existing infrastructure
- Low latency overhead (<50ms)

**Cons:**
- Centralized trust (must trust AXLE)
- Single point of failure
- Regulatory concerns (data handling)

### Method 2: TEE-Based Verification (Decentralized, Trustless)

Uses AWS Nitro Enclaves to run API calls in a secure, attestable environment.

```
┌─────────┐     ┌────────────────────────────────┐
│  Agent  │────▶│  AWS Nitro Enclave             │
│         │     │  ┌──────────────────────────┐  │
│         │     │  │ Secure Environment       │  │
│         │     │  │ - API Key Storage        │  │
│         │     │  │ - LLM API Calls          │  │
│         │     │  │ - Token Counting         │  │
│         │     │  │ - Attestation Doc Gen    │  │
│         │◀────│  └──────────────────────────┘  │
└─────────┘     └────────────────────────────────┘
                              │
                              ▼
                    ┌──────────────────┐
                    │ Attestation Doc  │
                    │ - PCR0-8 hashes  │
                    │ - Token count    │
                    │ - Model used     │
                    │ - AWS signature  │
                    └──────────────────┘
                              │
                              ▼
                    ┌──────────────────┐
                    │ On-chain Verify  │
                    │ (Solana Program) │
                    └──────────────────┘
```

**Pros:**
- Cryptographically provable
- No single trusted party (trust AWS Nitro PKI)
- Tamper-proof execution

**Cons:**
- Higher infrastructure cost
- More complex implementation
- AWS dependency

---

## Detailed Design

### 1. Proxy API Flow

See: [PROXY-API-SPEC.md](./PROXY-API-SPEC.md)

```typescript
// Agent makes request through AXLE proxy
const response = await axle.chat({
  model: "gpt-4",
  messages: [{ role: "user", content: "Hello" }],
  // AXLE-specific parameters
  taskId: "task_123",
  agentWallet: "22bFtzYzGtz9rm..."
});

// Response includes signed usage record
{
  content: "Hi there!",
  usage: {
    model: "gpt-4",
    input_tokens: 5,
    output_tokens: 10,
    cost_usd: 0.00045
  },
  axle_signature: "0x..." // AXLE server signature
}
```

### 2. TEE Flow

See: [TEE-DESIGN.md](./TEE-DESIGN.md)

```typescript
// Agent requests attestation from enclave
const result = await enclave.executeWithAttestation({
  model: "claude-3-opus",
  messages: [...],
  nonce: randomBytes(32) // Prevent replay
});

// Result includes attestation document
{
  response: "...",
  attestation: {
    document: "base64...", // COSE-signed CBOR
    pcrs: {
      PCR0: "7fb5c55b...", // Image hash
      PCR1: "235c9e60...", // Kernel hash
      PCR2: "0f0ac32c..."  // App hash
    }
  }
}
```

---

## Token Counting Standards

### OpenAI Models

| Model | Input ($/1K) | Output ($/1K) | Tokenizer |
|-------|--------------|---------------|-----------|
| gpt-4-turbo | $0.01 | $0.03 | cl100k_base |
| gpt-4 | $0.03 | $0.06 | cl100k_base |
| gpt-3.5-turbo | $0.0005 | $0.0015 | cl100k_base |

### Anthropic Models

| Model | Input ($/1K) | Output ($/1K) | Tokenizer |
|-------|--------------|---------------|-----------|
| claude-3-opus | $0.015 | $0.075 | claude |
| claude-3-sonnet | $0.003 | $0.015 | claude |
| claude-3-haiku | $0.00025 | $0.00125 | claude |

### Token Verification

```typescript
// Token count must match provider response
interface UsageRecord {
  provider: "openai" | "anthropic" | "google";
  model: string;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  
  // Provider's usage response (signed)
  provider_usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  
  // Calculated cost
  cost_usd: number;
  cost_axl: number; // At current rate
}
```

---

## On-Chain Settlement

### Solana Program Structure

```rust
pub struct UsageProof {
    pub task_id: Pubkey,
    pub agent: Pubkey,
    pub client: Pubkey,
    
    // Verified usage data
    pub model: String,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cost_lamports: u64,
    
    // Proof type
    pub proof_type: ProofType,
    pub signature: [u8; 64],
    
    // Settlement
    pub settled: bool,
    pub settled_at: i64,
}

pub enum ProofType {
    ProxySignature { signer: Pubkey },
    TeeAttestation { pcr0: [u8; 48], attestation_hash: [u8; 32] },
}
```

### Settlement Flow

```
1. Agent submits UsageProof to Solana program
2. Program verifies:
   - Signature (proxy) OR attestation (TEE)
   - Task exists and is not already settled
   - Agent is authorized for task
3. Program transfers:
   - Agent reward: cost_lamports * reward_rate
   - Protocol fee: cost_lamports * fee_rate
4. Emit event for indexing
```

---

## Security Considerations

### Proxy API Security

1. **API Key Protection**: Never expose provider API keys
2. **Rate Limiting**: Prevent abuse via per-agent limits
3. **Audit Logging**: Record all requests for dispute resolution
4. **Signature Verification**: Use Ed25519 for Solana compatibility

### TEE Security

1. **PCR Verification**: Validate expected enclave image
2. **Certificate Chain**: Verify AWS Nitro PKI root
3. **Replay Prevention**: Include client nonce in attestation
4. **Clock Sync**: Attestation timestamp within acceptable range

### Attack Mitigations

| Attack | Proxy Mitigation | TEE Mitigation |
|--------|------------------|----------------|
| Model Substitution | Server validates model header | Hardcoded in enclave code |
| Token Inflation | Compare with provider response | Attestation includes exact count |
| Response Fabrication | Provider API only | No external access in enclave |
| Replay | Nonce + timestamp | Nonce in attestation document |
| MITM | TLS + certificate pinning | Vsock only (no network) |

---

## Implementation Roadmap

### Phase 1: Proxy API (MVP)
- [ ] Basic proxy server with logging
- [ ] OpenAI/Anthropic integration
- [ ] Signed usage records
- [ ] Solana settlement integration

### Phase 2: Enhanced Security
- [ ] Multi-sig for high-value transactions
- [ ] Dispute resolution mechanism
- [ ] Audit trail API

### Phase 3: TEE Integration
- [ ] AWS Nitro Enclave setup
- [ ] Attestation document generation
- [ ] On-chain verification
- [ ] Hybrid mode (proxy + TEE)

### Phase 4: Decentralization
- [ ] Multiple TEE operators
- [ ] Operator staking/slashing
- [ ] Community governance

---

## References

- [AWS Nitro Enclaves User Guide](https://docs.aws.amazon.com/enclaves/latest/user/)
- [AWS Nitro Attestation](https://docs.aws.amazon.com/enclaves/latest/user/set-up-attestation.html)
- [COSE RFC 8152](https://datatracker.ietf.org/doc/html/rfc8152)
- [CBOR RFC 8949](https://datatracker.ietf.org/doc/html/rfc8949)
- [OpenAI Pricing](https://openai.com/pricing)
- [Anthropic Pricing](https://www.anthropic.com/pricing)
