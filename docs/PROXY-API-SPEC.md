# AXLE Proxy API Specification

> Trusted API Proxy for Verified Token Usage

## Overview

The AXLE Proxy API acts as an intermediary between AI agents and LLM providers (OpenAI, Anthropic, etc.), providing:
- Accurate token counting
- Signed usage records
- Real-time cost calculation
- Solana settlement integration

---

## Base URL

```
Production: https://api.axle.network/v1
Devnet:     https://devnet.api.axle.network/v1
```

---

## Authentication

All requests require an AXLE API key in the header:

```http
Authorization: Bearer axle_sk_live_...
X-Agent-Wallet: <solana-wallet-address>
```

---

## Endpoints

### POST /chat/completions

OpenAI-compatible chat completions endpoint with usage verification.

**Request:**

```http
POST /chat/completions
Content-Type: application/json
Authorization: Bearer axle_sk_live_...
X-Agent-Wallet: 22bFtzYzGtz9rm9wVLK2mXhqjYquKo6h8xM1EyiTzBqN
X-Task-Id: task_abc123
```

```json
{
  "provider": "openai",
  "model": "gpt-4-turbo",
  "messages": [
    {"role": "system", "content": "You are a helpful assistant."},
    {"role": "user", "content": "Explain quantum computing in simple terms."}
  ],
  "temperature": 0.7,
  "max_tokens": 1000,
  "stream": false
}
```

**Response:**

```json
{
  "id": "axle_chat_7Hs9kL2m",
  "object": "chat.completion",
  "created": 1707580800,
  "model": "gpt-4-turbo",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "Quantum computing is like having a super-powered calculator..."
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 28,
    "completion_tokens": 156,
    "total_tokens": 184
  },
  "axle": {
    "task_id": "task_abc123",
    "agent_wallet": "22bFtzYzGtz9rm9wVLK2mXhqjYquKo6h8xM1EyiTzBqN",
    "provider": "openai",
    "model": "gpt-4-turbo",
    "cost": {
      "input_usd": 0.00028,
      "output_usd": 0.00468,
      "total_usd": 0.00496,
      "total_lamports": 24800
    },
    "timestamp": 1707580800,
    "nonce": "a1b2c3d4e5f6...",
    "signature": "3Kz8nVq2mP5xYw7rT9sL..."
  }
}
```

### POST /messages (Anthropic Compatible)

Claude-compatible messages endpoint.

**Request:**

```http
POST /messages
Content-Type: application/json
Authorization: Bearer axle_sk_live_...
X-Agent-Wallet: 22bFtzYzGtz9rm9wVLK2mXhqjYquKo6h8xM1EyiTzBqN
```

```json
{
  "provider": "anthropic",
  "model": "claude-3-opus-20240229",
  "messages": [
    {"role": "user", "content": "Write a haiku about blockchain."}
  ],
  "max_tokens": 100
}
```

**Response:**

```json
{
  "id": "axle_msg_Xt7kL9p2",
  "type": "message",
  "role": "assistant",
  "content": [
    {
      "type": "text",
      "text": "Chains of data flow\nImmutable ledger grows\nTrust without borders"
    }
  ],
  "model": "claude-3-opus-20240229",
  "stop_reason": "end_turn",
  "usage": {
    "input_tokens": 12,
    "output_tokens": 18
  },
  "axle": {
    "task_id": null,
    "agent_wallet": "22bFtzYzGtz9rm9wVLK2mXhqjYquKo6h8xM1EyiTzBqN",
    "provider": "anthropic",
    "model": "claude-3-opus-20240229",
    "cost": {
      "input_usd": 0.00018,
      "output_usd": 0.00135,
      "total_usd": 0.00153,
      "total_lamports": 7650
    },
    "timestamp": 1707580900,
    "nonce": "b2c3d4e5f6g7...",
    "signature": "4Lz9oWr3nQ6yZx8sU0tM..."
  }
}
```

---

## Streaming Support

### SSE (Server-Sent Events)

```http
POST /chat/completions
Content-Type: application/json
Authorization: Bearer axle_sk_live_...
```

```json
{
  "provider": "openai",
  "model": "gpt-4-turbo",
  "messages": [...],
  "stream": true
}
```

**Response Stream:**

```
data: {"id":"axle_chat_7Hs9kL2m","object":"chat.completion.chunk","choices":[{"delta":{"content":"Quantum"}}]}

data: {"id":"axle_chat_7Hs9kL2m","object":"chat.completion.chunk","choices":[{"delta":{"content":" computing"}}]}

...

data: {"id":"axle_chat_7Hs9kL2m","object":"chat.completion.chunk","choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":28,"completion_tokens":156},"axle":{"signature":"..."}}

data: [DONE]
```

---

## Usage Records

### GET /usage/records

Retrieve usage records for an agent.

**Request:**

```http
GET /usage/records?wallet=22bFtzYzGtz9rm...&from=1707494400&to=1707580800
Authorization: Bearer axle_sk_live_...
```

**Response:**

```json
{
  "records": [
    {
      "id": "axle_usage_1a2b3c",
      "task_id": "task_abc123",
      "agent_wallet": "22bFtzYzGtz9rm...",
      "provider": "openai",
      "model": "gpt-4-turbo",
      "input_tokens": 28,
      "output_tokens": 156,
      "total_usd": 0.00496,
      "total_lamports": 24800,
      "timestamp": 1707580800,
      "signature": "3Kz8nVq2mP5xYw7rT9sL...",
      "settled": true,
      "tx_signature": "5xYw7rT9sL3Kz8nVq2mP..."
    }
  ],
  "summary": {
    "total_requests": 1,
    "total_tokens": 184,
    "total_usd": 0.00496,
    "total_lamports": 24800
  }
}
```

### GET /usage/verify/{signature}

Verify a usage record signature.

**Response:**

```json
{
  "valid": true,
  "record": {
    "task_id": "task_abc123",
    "agent_wallet": "22bFtzYzGtz9rm...",
    "model": "gpt-4-turbo",
    "tokens": 184,
    "cost_lamports": 24800,
    "timestamp": 1707580800
  },
  "signer": "AXLEProxyServer1111111111111111111111111111"
}
```

---

## Signature Format

### Message Structure

The signature covers the following data:

```typescript
interface SignedUsageData {
  version: 1;
  task_id: string | null;
  agent_wallet: string;
  provider: "openai" | "anthropic" | "google";
  model: string;
  input_tokens: number;
  output_tokens: number;
  cost_lamports: number;
  timestamp: number;
  nonce: string; // 32 bytes hex
}
```

### Signature Generation

```typescript
import { Keypair } from "@solana/web3.js";
import nacl from "tweetnacl";

function signUsage(data: SignedUsageData, serverKey: Keypair): string {
  // Serialize to canonical JSON
  const message = Buffer.from(JSON.stringify(data, Object.keys(data).sort()));
  
  // Sign with Ed25519
  const signature = nacl.sign.detached(message, serverKey.secretKey);
  
  // Return base58 encoded
  return bs58.encode(signature);
}
```

### Signature Verification (On-chain)

```rust
use solana_program::ed25519_program;

pub fn verify_usage_signature(
    usage_data: &[u8],
    signature: &[u8; 64],
    signer: &Pubkey,
) -> Result<(), ProgramError> {
    // Verify the signature
    let ix = ed25519_program::new_ed25519_instruction(
        signer.to_bytes(),
        signature,
        usage_data,
    );
    
    // Must be included in transaction
    invoke(&ix, &[])?;
    
    Ok(())
}
```

---

## Error Codes

| Code | HTTP | Description |
|------|------|-------------|
| `invalid_api_key` | 401 | Invalid or expired API key |
| `invalid_wallet` | 400 | Invalid Solana wallet address |
| `provider_error` | 502 | Error from LLM provider |
| `rate_limit` | 429 | Rate limit exceeded |
| `insufficient_balance` | 402 | Agent has insufficient AXL balance |
| `model_not_supported` | 400 | Requested model not supported |
| `signature_failed` | 500 | Failed to generate signature |

**Error Response:**

```json
{
  "error": {
    "code": "rate_limit",
    "message": "Rate limit exceeded. Try again in 60 seconds.",
    "retry_after": 60
  }
}
```

---

## Rate Limits

| Tier | Requests/min | Tokens/day |
|------|--------------|------------|
| Free | 10 | 100,000 |
| Basic | 60 | 1,000,000 |
| Pro | 300 | 10,000,000 |
| Enterprise | Custom | Custom |

---

## Supported Models

### OpenAI

| Model | Input $/1K | Output $/1K |
|-------|------------|-------------|
| gpt-4-turbo | $0.01 | $0.03 |
| gpt-4 | $0.03 | $0.06 |
| gpt-4-32k | $0.06 | $0.12 |
| gpt-3.5-turbo | $0.0005 | $0.0015 |
| gpt-3.5-turbo-16k | $0.003 | $0.004 |

### Anthropic

| Model | Input $/1K | Output $/1K |
|-------|------------|-------------|
| claude-3-opus | $0.015 | $0.075 |
| claude-3-sonnet | $0.003 | $0.015 |
| claude-3-haiku | $0.00025 | $0.00125 |

### Google

| Model | Input $/1K | Output $/1K |
|-------|------------|-------------|
| gemini-1.5-pro | $0.00125 | $0.005 |
| gemini-1.5-flash | $0.000075 | $0.0003 |

---

## SDK Usage

### TypeScript/JavaScript

```typescript
import { AxleClient } from "@axle-protocol/sdk";

const axle = new AxleClient({
  apiKey: process.env.AXLE_API_KEY,
  wallet: agentWallet,
});

// OpenAI-style call
const response = await axle.chat.completions.create({
  provider: "openai",
  model: "gpt-4-turbo",
  messages: [{ role: "user", content: "Hello!" }],
});

console.log(response.choices[0].message.content);
console.log(response.axle.cost.total_usd);
console.log(response.axle.signature);
```

### Python

```python
from axle import AxleClient

axle = AxleClient(
    api_key=os.environ["AXLE_API_KEY"],
    wallet=agent_wallet,
)

response = axle.chat.completions.create(
    provider="anthropic",
    model="claude-3-opus",
    messages=[{"role": "user", "content": "Hello!"}],
)

print(response.content[0].text)
print(response.axle.cost.total_usd)
```

---

## Webhooks

### Settlement Webhook

Receive notifications when usage records are settled on-chain.

```http
POST /your-webhook-endpoint
Content-Type: application/json
X-Axle-Signature: sha256=...
```

```json
{
  "event": "usage.settled",
  "data": {
    "usage_id": "axle_usage_1a2b3c",
    "task_id": "task_abc123",
    "agent_wallet": "22bFtzYzGtz9rm...",
    "amount_lamports": 24800,
    "tx_signature": "5xYw7rT9sL3Kz8nVq2mP...",
    "settled_at": 1707580900
  }
}
```

---

## Security Best Practices

1. **Never expose API keys in client-side code**
2. **Validate signatures before trusting usage data**
3. **Use HTTPS for all API calls**
4. **Implement request signing for high-value operations**
5. **Monitor usage patterns for anomalies**
