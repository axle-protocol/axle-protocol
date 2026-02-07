/**
 * Auth store and helpers for X OAuth + API key system
 * In-memory for MVP — swap to Redis/DB for production
 */
import { randomBytes } from 'crypto';

// ---------- Types ----------

export interface ApiKeyData {
  apiKey: string;
  twitterId: string;
  twitterHandle: string;
  twitterName: string;
  twitterAvatar: string;
  createdAt: number;
}

interface OAuthState {
  codeVerifier: string;
  redirectUri: string;
  createdAt: number;
}

// ---------- In-memory stores ----------

const apiKeys = new Map<string, ApiKeyData>();
const oauthStates = new Map<string, OAuthState>();

// ---------- API Key helpers ----------

export function generateApiKey(): string {
  return `axle_${randomBytes(24).toString('hex')}`;
}

export function storeApiKey(data: ApiKeyData): void {
  apiKeys.set(data.apiKey, data);
}

export function getApiKeyData(apiKey: string): ApiKeyData | undefined {
  return apiKeys.get(apiKey);
}

export function validateApiKey(authHeader: string | null): ApiKeyData | null {
  if (!authHeader?.startsWith('Bearer ')) return null;
  const key = authHeader.slice(7);
  return apiKeys.get(key) || null;
}

export function listApiKeys(): ApiKeyData[] {
  return Array.from(apiKeys.values());
}

// ---------- OAuth state helpers ----------

export function storeOAuthState(state: string, data: OAuthState): void {
  oauthStates.set(state, data);
  // Auto-cleanup after 10 min
  setTimeout(() => oauthStates.delete(state), 10 * 60 * 1000);
}

export function getOAuthState(state: string): OAuthState | undefined {
  const data = oauthStates.get(state);
  if (data) oauthStates.delete(state);
  return data;
}

// ---------- PKCE helpers ----------

export function generateCodeVerifier(): string {
  return randomBytes(32)
    .toString('base64url')
    .replace(/[^a-zA-Z0-9._~-]/g, '')
    .slice(0, 128);
}

export async function generateCodeChallenge(verifier: string): Promise<string> {
  const { createHash } = await import('crypto');
  const hash = createHash('sha256').update(verifier).digest();
  return hash.toString('base64url');
}
