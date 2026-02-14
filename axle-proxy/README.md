# AXLE Protocol Proxy

Token-metered API proxy for AI agents on Solana.

## Features

- **OpenAI Compatible**: Drop-in replacement for `/v1/chat/completions`
- **Anthropic Compatible**: Drop-in replacement for `/v1/messages`  
- **Accurate Token Counting**: Uses tiktoken for precise measurement
- **Request Signing**: Ed25519 signatures for request integrity
- **On-chain Recording**: Batch token usage to Solana

## Quick Start

```bash
# Install dependencies
npm install

# Set environment variables
export OPENAI_API_KEY=sk-...
export ANTHROPIC_API_KEY=sk-ant-...
export AXLE_AGENT_KEY=<base58-keypair>  # Optional, generates if not set

# Start proxy
npm run dev
```

## API Endpoints

### OpenAI Compatible

```bash
POST http://localhost:3700/v1/chat/completions

# Example
curl http://localhost:3700/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -d '{
    "model": "gpt-4",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

### Anthropic Compatible

```bash
POST http://localhost:3700/v1/messages

# Example
curl http://localhost:3700/v1/messages \
  -H "Content-Type: application/json" \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -d '{
    "model": "claude-3-sonnet-20240229",
    "max_tokens": 1024,
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

## Response Headers

Every response includes AXLE metadata:

| Header | Description |
|--------|-------------|
| `x-axle-tokens-input` | Input token count |
| `x-axle-tokens-output` | Output token count |
| `x-axle-signature` | Ed25519 signature (base58) |
| `x-axle-agent-id` | Agent's short ID |
| `x-axle-tx-id` | Solana transaction ID (if recorded) |

## Streaming

Both OpenAI and Anthropic streaming are supported. Token usage is sent as a final event before the stream ends:

```
# OpenAI stream ends with:
data: {"axle":{"inputTokens":100,"outputTokens":50,"signature":"...","agentId":"..."}}
data: [DONE]

# Anthropic stream includes:
event: axle_usage
data: {"inputTokens":100,"outputTokens":50,"signature":"...","agentId":"..."}
```

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | `3700` |
| `OPENAI_API_KEY` | OpenAI API key | - |
| `ANTHROPIC_API_KEY` | Anthropic API key | - |
| `AXLE_AGENT_KEY` | Agent Ed25519 keypair (base58) | Random |
| `SOLANA_RPC_URL` | Solana RPC endpoint | Devnet |
| `SOLANA_PAYER_KEY` | Payer keypair for on-chain recording | - |
| `ENABLE_ONCHAIN` | Enable on-chain recording | `true` |
| `LOG_REQUESTS` | Log all requests | `true` |

## Programmatic Usage

```typescript
import { createProxy, startProxy } from '@axle-protocol/proxy';

// Create Hono app
const app = createProxy({
  openaiApiKey: 'sk-...',
  anthropicApiKey: 'sk-ant-...',
  logRequests: true,
});

// Or start directly
startProxy({ port: 3700 });
```

### Token Counting

```typescript
import { countTokens, countOpenAITokens, countAnthropicTokens } from '@axle-protocol/proxy';

// Simple string
const tokens = countTokens('Hello, world!', 'gpt-4');

// OpenAI messages
const openaiTokens = countOpenAITokens([
  { role: 'user', content: 'Hello!' }
], 'gpt-4');

// Anthropic messages
const anthropicTokens = countAnthropicTokens([
  { role: 'user', content: 'Hello!' }
], 'You are helpful.', 'claude-3-sonnet');
```

### Signing

```typescript
import { AgentSigner, verifySignature } from '@axle-protocol/proxy';

// Create signer (generates keypair or uses provided)
const signer = new AgentSigner();
// or: new AgentSigner(base58SecretKey);

// Sign usage
const signed = signer.signUsage(requestBody, inputTokens, outputTokens, model);

// Verify
const valid = verifySignature(signed, signer.publicKey);
```

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      AXLE Proxy Server                      │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────┐     ┌─────────────┐     ┌──────────────┐  │
│  │   OpenAI    │     │  Anthropic  │     │   Status     │  │
│  │   Route     │     │   Route     │     │   Endpoint   │  │
│  └──────┬──────┘     └──────┬──────┘     └──────────────┘  │
│         │                   │                              │
│         └─────────┬─────────┘                              │
│                   ▼                                        │
│         ┌─────────────────┐                               │
│         │  Token Counter  │ (tiktoken)                    │
│         └────────┬────────┘                               │
│                  ▼                                        │
│         ┌─────────────────┐                               │
│         │     Signer      │ (Ed25519)                     │
│         └────────┬────────┘                               │
│                  ▼                                        │
│         ┌─────────────────┐                               │
│         │ On-chain Batch  │ (Solana Memo)                 │
│         └─────────────────┘                               │
│                                                           │
└─────────────────────────────────────────────────────────────┘
```

## License

MIT
