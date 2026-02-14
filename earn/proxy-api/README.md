# AXLE Proxy API

Trusted API proxy for verified token usage in the AXLE Protocol.

## Features

- **Trusted Token Counting**: Every API call is logged with exact token usage
- **Signed Usage Records**: Cryptographic signatures for on-chain verification
- **Multi-Provider Support**: OpenAI, Anthropic, Google
- **Streaming Support**: Full SSE streaming with usage tracking
- **Solana Integration**: Ready for on-chain settlement

## Quick Start

```bash
# Install dependencies
npm install

# Copy environment file
cp .env.example .env

# Edit .env with your API keys
nano .env

# Run development server
npm run dev
```

## API Usage

### Chat Completions

```bash
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-axle-api-key" \
  -H "X-Agent-Wallet: YOUR_SOLANA_WALLET_ADDRESS" \
  -d '{
    "provider": "openai",
    "model": "gpt-4-turbo",
    "messages": [
      {"role": "user", "content": "Hello!"}
    ]
  }'
```

### Response

```json
{
  "id": "axle_chat_7Hs9kL2m",
  "object": "chat.completion",
  "model": "gpt-4-turbo",
  "choices": [
    {
      "message": {
        "role": "assistant",
        "content": "Hello! How can I help you today?"
      }
    }
  ],
  "usage": {
    "prompt_tokens": 5,
    "completion_tokens": 10,
    "total_tokens": 15
  },
  "axle": {
    "agent_wallet": "YOUR_SOLANA_WALLET_ADDRESS",
    "provider": "openai",
    "model": "gpt-4-turbo",
    "cost": {
      "input_usd": 0.00005,
      "output_usd": 0.0003,
      "total_usd": 0.00035,
      "total_lamports": 1750
    },
    "signature": "3Kz8nVq2mP5xYw7rT9sL..."
  }
}
```

## Signature Verification

The `axle.signature` field contains an Ed25519 signature of the usage data. To verify:

```typescript
import { verifyUsageSignature } from "./src/signature";

const isValid = verifyUsageSignature(
  usageData,
  signature,
  serverPublicKey
);
```

## On-Chain Settlement

Submit the signed usage record to the AXLE Solana program for settlement:

```typescript
import { Connection, PublicKey } from "@solana/web3.js";
import { settleUsage } from "@axle-protocol/sdk";

await settleUsage({
  connection,
  program,
  usageData,
  signature,
});
```

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                     AXLE Proxy API                       │
├─────────────────────────────────────────────────────────┤
│  ┌──────────┐   ┌──────────┐   ┌──────────────────────┐ │
│  │ OpenAI   │   │Anthropic │   │ Signature Generator  │ │
│  │ Provider │   │ Provider │   │ (Ed25519)            │ │
│  └────┬─────┘   └────┬─────┘   └──────────────────────┘ │
│       │              │                                  │
│       └──────┬───────┘                                  │
│              ▼                                          │
│  ┌──────────────────────────────────────────────────┐   │
│  │              Request Router                      │   │
│  │  - Validate request                              │   │
│  │  - Route to provider                             │   │
│  │  - Count tokens                                  │   │
│  │  - Sign usage record                             │   │
│  └──────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

## Security

- API keys are never exposed to clients
- All usage records are signed with the server's Ed25519 keypair
- Signatures can be verified on-chain for trustless settlement
- Rate limiting prevents abuse

## Development

```bash
# Run tests
npm test

# Build for production
npm run build

# Run production server
npm start
```

## License

MIT
