import { Keypair } from "@solana/web3.js";
import nacl from "tweetnacl";
import bs58 from "bs58";
import { SignedUsageData } from "./types.js";

/**
 * Generate a cryptographic signature for usage data
 */
export function signUsageData(
  data: SignedUsageData,
  serverKeypair: Keypair
): string {
  // Create canonical JSON representation
  const sortedKeys = Object.keys(data).sort() as (keyof SignedUsageData)[];
  const sortedData: Record<string, unknown> = {};
  for (const key of sortedKeys) {
    sortedData[key] = data[key];
  }

  const message = Buffer.from(JSON.stringify(sortedData));

  // Sign with Ed25519
  const signature = nacl.sign.detached(message, serverKeypair.secretKey);

  // Return base58 encoded signature
  return bs58.encode(signature);
}

/**
 * Verify a usage data signature
 */
export function verifyUsageSignature(
  data: SignedUsageData,
  signature: string,
  signerPublicKey: Uint8Array
): boolean {
  try {
    // Recreate the signed message
    const sortedKeys = Object.keys(data).sort() as (keyof SignedUsageData)[];
    const sortedData: Record<string, unknown> = {};
    for (const key of sortedKeys) {
      sortedData[key] = data[key];
    }

    const message = Buffer.from(JSON.stringify(sortedData));

    // Decode signature
    const signatureBytes = bs58.decode(signature);

    // Verify
    return nacl.sign.detached.verify(message, signatureBytes, signerPublicKey);
  } catch {
    return false;
  }
}

/**
 * Generate a random nonce
 */
export function generateNonce(): string {
  const bytes = nacl.randomBytes(32);
  return Buffer.from(bytes).toString("hex");
}

/**
 * Load server keypair from environment
 */
export function loadServerKeypair(): Keypair {
  const secretKeyEnv = process.env.AXLE_SERVER_SECRET_KEY;

  if (!secretKeyEnv) {
    console.warn("AXLE_SERVER_SECRET_KEY not set, generating ephemeral key");
    return Keypair.generate();
  }

  try {
    const secretKey = bs58.decode(secretKeyEnv);
    return Keypair.fromSecretKey(secretKey);
  } catch {
    throw new Error("Invalid AXLE_SERVER_SECRET_KEY format");
  }
}

/**
 * Create a SignedUsageData object
 */
export function createSignedUsageData(params: {
  taskId: string | null;
  agentWallet: string;
  provider: "openai" | "anthropic" | "google";
  model: string;
  inputTokens: number;
  outputTokens: number;
  costLamports: number;
}): SignedUsageData {
  return {
    version: 1,
    task_id: params.taskId,
    agent_wallet: params.agentWallet,
    provider: params.provider,
    model: params.model,
    input_tokens: params.inputTokens,
    output_tokens: params.outputTokens,
    cost_lamports: params.costLamports,
    timestamp: Date.now(),
    nonce: generateNonce(),
  };
}
