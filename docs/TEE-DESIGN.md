# AXLE TEE Design - AWS Nitro Enclaves

> Trustless Token Verification using Trusted Execution Environments

## Overview

This document describes the architecture for running LLM API calls inside AWS Nitro Enclaves, providing cryptographic proof of exact token usage without requiring trust in AXLE infrastructure.

---

## AWS Nitro Enclaves Background

### What is a Nitro Enclave?

AWS Nitro Enclaves is an isolated compute environment that provides:
- **CPU & Memory Isolation**: Separate from the parent EC2 instance
- **No Persistent Storage**: Cannot be modified after launch
- **No Network Access**: Only vsock communication with parent
- **Cryptographic Attestation**: Signed proof of what code is running

### Key Components

| Component | Description |
|-----------|-------------|
| Nitro Hypervisor | Provides isolation, generates attestation |
| NSM (Nitro Security Module) | Hardware module for attestation |
| vsock | Communication channel with parent instance |
| Attestation Document | COSE-signed proof of enclave identity |

---

## Architecture

### System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        EC2 Parent Instance                       │
│  ┌──────────────────┐                                            │
│  │   AXLE Proxy     │◀───────────────────▶ Internet              │
│  │   Application    │         HTTPS                              │
│  └────────┬─────────┘                                            │
│           │ vsock                                                │
│  ┌────────▼─────────────────────────────────────────────────────┐│
│  │                     Nitro Enclave                            ││
│  │  ┌─────────────────────────────────────────────────────────┐ ││
│  │  │                  Enclave Application                    │ ││
│  │  │                                                         │ ││
│  │  │  ┌─────────────┐  ┌──────────────┐  ┌───────────────┐  │ ││
│  │  │  │ API Key     │  │ LLM Caller   │  │ Token Counter │  │ ││
│  │  │  │ Vault       │  │              │  │               │  │ ││
│  │  │  └─────────────┘  └──────────────┘  └───────────────┘  │ ││
│  │  │                          │                              │ ││
│  │  │                          ▼                              │ ││
│  │  │                 ┌──────────────────┐                    │ ││
│  │  │                 │ Attestation Gen  │◀───▶ NSM Device    │ ││
│  │  │                 └──────────────────┘     (/dev/nsm)     │ ││
│  │  └─────────────────────────────────────────────────────────┘ ││
│  └──────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
```

### Data Flow

```
1. Agent → Parent: Request LLM completion
2. Parent → Enclave (vsock): Forward request + nonce
3. Enclave: 
   a. Decrypt API key using KMS
   b. Call LLM provider via parent's network proxy
   c. Count tokens in response
   d. Generate attestation document with usage data
4. Enclave → Parent: Response + attestation
5. Parent → Agent: Forward response + attestation
6. Agent → Solana: Submit attestation for verification
```

---

## Attestation Document Structure

### COSE_Sign1 Format

The attestation document is a CBOR-encoded, COSE-signed structure:

```
COSE_Sign1 = [
    protected: bstr,        // Algorithm: ES384 (ECDSA P-384)
    unprotected: {},        // Empty
    payload: bstr,          // CBOR-encoded attestation data
    signature: bstr         // 96-byte ECDSA signature
]
```

### Attestation Payload

```typescript
interface AttestationPayload {
  // Fixed fields from AWS
  module_id: string;           // NSM identifier
  timestamp: number;           // Unix timestamp (ms)
  digest: "SHA384";           // Hash algorithm
  
  // PCR measurements
  pcrs: {
    0: Uint8Array;  // Enclave image hash (48 bytes)
    1: Uint8Array;  // Kernel hash
    2: Uint8Array;  // Application hash
    3: Uint8Array;  // IAM role hash (optional)
    4: Uint8Array;  // Instance ID hash (optional)
    8: Uint8Array;  // Signing certificate hash (optional)
  };
  
  // Certificate chain
  certificate: Uint8Array;     // Enclave certificate (DER)
  cabundle: Uint8Array[];      // CA bundle
  
  // Optional user data (our usage proof)
  user_data: Uint8Array;       // AXLE usage data (max 1KB)
  nonce: Uint8Array;           // Client nonce (max 1KB)
  public_key: Uint8Array;      // Optional public key (max 1KB)
}
```

### AXLE User Data Format

Embedded in `user_data` field:

```typescript
interface AxleUsageProof {
  version: 1;
  task_id: string | null;
  agent_wallet: string;       // Base58 Solana address
  
  // Request details
  provider: "openai" | "anthropic" | "google";
  model: string;
  
  // Verified token counts
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  
  // Cost calculation
  cost_usd: number;
  cost_lamports: number;
  
  // Request hash (for response verification)
  request_hash: string;       // SHA256 of original request
  response_hash: string;      // SHA256 of response
  
  // Timing
  request_timestamp: number;
  response_timestamp: number;
}
```

---

## PCR Values

### PCR Measurements Explained

| PCR | Contents | Use Case |
|-----|----------|----------|
| PCR0 | Enclave image file hash | Verify exact code running |
| PCR1 | Linux kernel + bootstrap | Verify boot environment |
| PCR2 | Application code | Verify app hasn't changed |
| PCR3 | IAM role ARN hash | Restrict to specific roles |
| PCR4 | Instance ID hash | Restrict to specific instances |
| PCR8 | Signing cert hash | Verify code signer |

### Expected PCR Values

For AXLE Token Verifier v1.0.0:

```json
{
  "PCR0": "7fb5c55bc2ecbb68ed99a13d7122abfc0666b926a79d5379bc58b9445c84217f59cfdd36c08b2c79552928702efe23e4",
  "PCR1": "235c9e6050abf6b993c915505f3220e2d82b51aff830ad14cbecc2eec1bf0b4ae749d311c663f464cde9f718acca5286",
  "PCR2": "0f0ac32c300289e872e6ac4d19b0b5ac4a9b020c98295643ff3978610750ce6a86f7edff24e3c0a4a445f2ff8a9ea79d"
}
```

---

## Verification Process

### Off-chain Verification

```typescript
import { verify } from "cose-js";
import { decode } from "cbor-x";

async function verifyAttestation(
  attestationDoc: Uint8Array,
  expectedPcr0: string,
  clientNonce: Uint8Array
): Promise<AxleUsageProof> {
  // 1. Decode COSE_Sign1
  const coseSign1 = decode(attestationDoc);
  
  // 2. Extract payload
  const payload = decode(coseSign1[2]) as AttestationPayload;
  
  // 3. Verify certificate chain
  await verifyCertificateChain(
    payload.certificate,
    payload.cabundle,
    AWS_NITRO_ROOT_CERT
  );
  
  // 4. Verify signature
  const publicKey = extractPublicKey(payload.certificate);
  const isValid = await verify(attestationDoc, publicKey);
  if (!isValid) throw new Error("Invalid signature");
  
  // 5. Verify PCR0 (enclave code)
  const pcr0Hex = Buffer.from(payload.pcrs[0]).toString("hex");
  if (pcr0Hex !== expectedPcr0) {
    throw new Error("PCR0 mismatch - unknown enclave code");
  }
  
  // 6. Verify nonce (prevent replay)
  if (!constantTimeEqual(payload.nonce, clientNonce)) {
    throw new Error("Nonce mismatch - possible replay attack");
  }
  
  // 7. Verify timestamp (within 5 minutes)
  const age = Date.now() - payload.timestamp;
  if (age > 5 * 60 * 1000) {
    throw new Error("Attestation expired");
  }
  
  // 8. Extract and return usage proof
  return decode(payload.user_data) as AxleUsageProof;
}
```

### On-chain Verification (Solana)

Due to Solana compute limits, full attestation verification is complex. Options:

#### Option A: Oracle-based Verification

```rust
// Trusted oracle verifies off-chain, submits result
pub struct VerifiedUsage {
    pub attestation_hash: [u8; 32],
    pub pcr0: [u8; 48],
    pub usage: UsageData,
    pub oracle_signature: [u8; 64],
}
```

#### Option B: Optimistic Verification

```rust
// Submit attestation with bond, challenge period
pub struct OptimisticAttestation {
    pub attestation_data: Vec<u8>,
    pub submitter: Pubkey,
    pub bond_amount: u64,
    pub submitted_at: i64,
    pub challenged: bool,
}

// Anyone can challenge invalid attestations
pub fn challenge_attestation(
    ctx: Context<Challenge>,
    fraud_proof: Vec<u8>,
) -> Result<()> {
    // Verify fraud proof
    // Slash submitter bond
    // Reward challenger
}
```

#### Option C: ZK Verification (Future)

```rust
// Submit ZK proof of attestation verification
pub struct ZkAttestation {
    pub usage: UsageData,
    pub zk_proof: [u8; 256],  // Groth16 or similar
}
```

---

## Enclave Application

### Docker Image Structure

```dockerfile
FROM amazonlinux:2

# Install dependencies
RUN yum install -y openssl python3

# Copy enclave application
COPY enclave-app /app/enclave-app
COPY nsm-lib.so /usr/lib/nsm-lib.so

# Entry point
CMD ["/app/enclave-app"]
```

### Build Enclave Image

```bash
# Build Docker image
docker build -t axle-enclave:v1.0.0 .

# Convert to Enclave Image File (EIF)
nitro-cli build-enclave \
  --docker-uri axle-enclave:v1.0.0 \
  --output-file axle-enclave.eif

# Output includes PCR measurements
# {
#   "Measurements": {
#     "PCR0": "7fb5c55b...",
#     "PCR1": "235c9e60...",
#     "PCR2": "0f0ac32c..."
#   }
# }
```

### Running the Enclave

```bash
# Start enclave
nitro-cli run-enclave \
  --cpu-count 2 \
  --memory 4096 \
  --enclave-cid 16 \
  --eif-path axle-enclave.eif

# Check status
nitro-cli describe-enclaves
```

---

## Security Considerations

### Threat Model

| Threat | Mitigation |
|--------|------------|
| Malicious parent instance | Enclave isolation, attestation |
| Modified enclave code | PCR verification |
| Replay attacks | Client nonce in attestation |
| Man-in-the-middle | vsock only, no network |
| Key extraction | Keys never leave enclave |
| Side-channel attacks | Nitro hardware isolation |

### Key Management

API keys are stored encrypted, decrypted only inside enclave:

```
1. API key encrypted with KMS key
2. KMS policy requires attestation with specific PCR0
3. Enclave requests decryption via KMS
4. KMS verifies attestation before responding
5. Key exists only in enclave memory
```

### Debug Mode Warning

⚠️ **Enclaves in debug mode produce attestations with all-zero PCRs**

```typescript
// NEVER accept in production
if (payload.pcrs[0].every(b => b === 0)) {
  throw new Error("Debug mode attestation rejected");
}
```

---

## Cost Analysis

### AWS Infrastructure

| Resource | Spec | Monthly Cost |
|----------|------|--------------|
| EC2 (c6i.xlarge) | 4 vCPU, 8GB RAM | ~$120 |
| Enclave allocation | 2 vCPU, 4GB RAM | (included) |
| Data transfer | 100GB | ~$9 |
| KMS | 1000 requests/day | ~$3 |
| **Total** | | **~$132/month** |

### Comparison with Proxy

| Metric | Proxy | TEE |
|--------|-------|-----|
| Trust model | Trust AXLE | Trust AWS + code |
| Latency overhead | ~50ms | ~200ms |
| Infrastructure cost | $50/month | $132/month |
| Verification cost | Ed25519 sign | Full attestation |
| On-chain settlement | Simple | Complex |

---

## Implementation Roadmap

### Phase 1: Basic Enclave (Week 1-2)
- [ ] Enclave application skeleton
- [ ] vsock communication
- [ ] NSM attestation generation
- [ ] Basic LLM proxy via parent

### Phase 2: KMS Integration (Week 3)
- [ ] KMS key policy with PCR condition
- [ ] Encrypted API key storage
- [ ] Attestation-based decryption

### Phase 3: Token Verification (Week 4)
- [ ] Token counting per provider
- [ ] Usage proof generation
- [ ] Attestation document structure

### Phase 4: On-chain Integration (Week 5-6)
- [ ] Off-chain verification library
- [ ] Oracle-based on-chain verification
- [ ] Settlement flow

### Phase 5: Production Hardening (Week 7-8)
- [ ] Reproducible builds
- [ ] PCR registry
- [ ] Monitoring and alerting
- [ ] Multi-region deployment

---

## References

- [AWS Nitro Enclaves User Guide](https://docs.aws.amazon.com/enclaves/latest/user/)
- [Cryptographic Attestation](https://docs.aws.amazon.com/enclaves/latest/user/set-up-attestation.html)
- [Verifying Root of Trust](https://docs.aws.amazon.com/enclaves/latest/user/verify-root.html)
- [NSM API (GitHub)](https://github.com/aws/aws-nitro-enclaves-nsm-api)
- [Validating Attestation Documents (AWS Blog)](https://aws.amazon.com/blogs/compute/validating-attestation-documents-produced-by-aws-nitro-enclaves/)
- [COSE RFC 8152](https://datatracker.ietf.org/doc/html/rfc8152)
- [CBOR RFC 8949](https://datatracker.ietf.org/doc/html/rfc8949)
