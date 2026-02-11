/**
 * AXLE Protocol Proxy
 * 
 * Token-metered API proxy for AI agents.
 */

export { createProxy, startProxy } from './proxy.js';
export type { ProxyConfig } from './proxy.js';

// Token counting
export { 
  countTokens, 
  countOpenAITokens, 
  countAnthropicTokens,
  extractOpenAIUsage,
  extractAnthropicUsage,
  verifyUsage,
} from './tokenCounter.js';
export type { TokenUsage } from './tokenCounter.js';

// Signing
export { 
  AgentSigner, 
  createSignerFromEnv,
  verifySignature,
  hashRequest,
  hashData,
} from './signer.js';
export type { SignedPayload, SignaturePayload } from './signer.js';

// On-chain recording
export { 
  OnchainRecorder, 
  getRecorder,
} from './onchain.js';
export type { OnchainConfig, RecordResult } from './onchain.js';
