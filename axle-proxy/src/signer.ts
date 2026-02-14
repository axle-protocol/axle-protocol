/**
 * Request Signer - Ed25519 signatures for request integrity
 * 
 * Signs request/response payloads using agent's Ed25519 keypair.
 * Compatible with Solana keypair format.
 */

import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { createHash } from 'crypto';

export interface SignaturePayload {
  timestamp: number;
  requestHash: string;
  inputTokens: number;
  outputTokens: number;
  model: string;
  agentId: string;
}

export interface SignedPayload extends SignaturePayload {
  signature: string;
}

/**
 * Create a deterministic hash of the request body
 */
export function hashRequest(body: unknown): string {
  const normalized = JSON.stringify(body, Object.keys(body as object).sort());
  return createHash('sha256').update(normalized).digest('hex');
}

/**
 * Create a deterministic hash of arbitrary data
 */
export function hashData(data: string): string {
  return createHash('sha256').update(data).digest('hex');
}

/**
 * Agent Signer - manages keypair and creates signatures
 */
export class AgentSigner {
  private keypair: nacl.SignKeyPair;
  public readonly publicKey: string;
  public readonly agentId: string;

  constructor(secretKey?: Uint8Array | string) {
    if (secretKey) {
      // Accept base58-encoded secret key (Solana format)
      const keyBytes = typeof secretKey === 'string' 
        ? bs58.decode(secretKey) 
        : secretKey;
      
      // Solana keypairs are 64 bytes (32 secret + 32 public)
      if (keyBytes.length === 64) {
        this.keypair = {
          publicKey: keyBytes.slice(32),
          secretKey: keyBytes,
        };
      } else if (keyBytes.length === 32) {
        // Just seed, derive full keypair
        this.keypair = nacl.sign.keyPair.fromSeed(keyBytes);
      } else {
        throw new Error(`Invalid secret key length: ${keyBytes.length}`);
      }
    } else {
      // Generate new keypair
      this.keypair = nacl.sign.keyPair();
    }

    this.publicKey = bs58.encode(this.keypair.publicKey);
    this.agentId = this.publicKey.slice(0, 8); // Short ID for headers
  }

  /**
   * Sign a message and return base58-encoded signature
   */
  sign(message: Uint8Array | string): string {
    const msgBytes = typeof message === 'string' 
      ? new TextEncoder().encode(message) 
      : message;
    
    const signature = nacl.sign.detached(msgBytes, this.keypair.secretKey);
    return bs58.encode(signature);
  }

  /**
   * Create a signed payload for token usage
   */
  signUsage(
    requestBody: unknown,
    inputTokens: number,
    outputTokens: number,
    model: string
  ): SignedPayload {
    const payload: SignaturePayload = {
      timestamp: Date.now(),
      requestHash: hashRequest(requestBody),
      inputTokens,
      outputTokens,
      model,
      agentId: this.agentId,
    };

    // Create canonical message for signing
    const message = this.createSignatureMessage(payload);
    const signature = this.sign(message);

    return {
      ...payload,
      signature,
    };
  }

  /**
   * Create canonical message format for signing
   */
  private createSignatureMessage(payload: SignaturePayload): string {
    return [
      `axle:v1`,
      payload.timestamp.toString(),
      payload.requestHash,
      payload.inputTokens.toString(),
      payload.outputTokens.toString(),
      payload.model,
      payload.agentId,
    ].join(':');
  }

  /**
   * Export secret key as base58 (for storage)
   */
  exportSecretKey(): string {
    return bs58.encode(this.keypair.secretKey);
  }
}

/**
 * Verify a signature against payload
 */
export function verifySignature(
  payload: SignedPayload,
  publicKey: string
): boolean {
  try {
    const pubKeyBytes = bs58.decode(publicKey);
    const signatureBytes = bs58.decode(payload.signature);
    
    const message = [
      `axle:v1`,
      payload.timestamp.toString(),
      payload.requestHash,
      payload.inputTokens.toString(),
      payload.outputTokens.toString(),
      payload.model,
      payload.agentId,
    ].join(':');
    
    const messageBytes = new TextEncoder().encode(message);
    
    return nacl.sign.detached.verify(messageBytes, signatureBytes, pubKeyBytes);
  } catch {
    return false;
  }
}

/**
 * Create signer from environment variable
 */
export function createSignerFromEnv(envVar: string = 'AXLE_AGENT_KEY'): AgentSigner {
  const secretKey = process.env[envVar];
  if (!secretKey) {
    console.warn(`Warning: ${envVar} not set, generating ephemeral keypair`);
    return new AgentSigner();
  }
  return new AgentSigner(secretKey);
}
