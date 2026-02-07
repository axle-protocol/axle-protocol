/**
 * Auth store and helpers for tweet-based verification + API key system
 * In-memory for MVP — swap to Redis/DB for production
 */
import { randomBytes } from 'crypto';

// ---------- Types ----------

export interface ApiKeyData {
  apiKey: string;
  twitterHandle: string;
  wallet: string;
  createdAt: number;
}

interface ChallengeData {
  nonce: string;
  expiresAt: number;
}

// ---------- In-memory stores ----------

const apiKeys = new Map<string, ApiKeyData>();
const challenges = new Map<string, ChallengeData>();

// ---------- Challenge helpers ----------

export function createChallenge(): { nonce: string; expiresAt: number } {
  const nonce = `axle_${randomBytes(16).toString('hex')}`;
  const expiresAt = Date.now() + 5 * 60 * 1000; // 5 minutes
  challenges.set(nonce, { nonce, expiresAt });
  // Auto-cleanup
  setTimeout(() => challenges.delete(nonce), 5 * 60 * 1000);
  return { nonce, expiresAt };
}

export function validateChallenge(nonce: string): boolean {
  const data = challenges.get(nonce);
  if (!data) return false;
  if (Date.now() > data.expiresAt) {
    challenges.delete(nonce);
    return false;
  }
  challenges.delete(nonce); // one-time use
  return true;
}

// ---------- API Key helpers ----------

export function generateApiKey(): string {
  return `axle_${randomBytes(24).toString('hex')}`;
}

export function storeApiKey(data: ApiKeyData): void {
  apiKeys.set(data.apiKey, data);
}

export function validateApiKey(authHeader: string | null): ApiKeyData | null {
  if (!authHeader?.startsWith('Bearer ')) return null;
  const key = authHeader.slice(7);
  return apiKeys.get(key) || null;
}

// ---------- Tweet parsing ----------

const NONCE_REGEX = /Nonce:\s*(axle_[a-f0-9]+)/i;
const WALLET_REGEX = /Wallet:\s*([1-9A-HJ-NP-Za-km-z]{32,44})/i;

export function parseTweetText(text: string): { nonce: string | null; wallet: string | null } {
  const nonceMatch = text.match(NONCE_REGEX);
  const walletMatch = text.match(WALLET_REGEX);
  return {
    nonce: nonceMatch ? nonceMatch[1] : null,
    wallet: walletMatch ? walletMatch[1] : null,
  };
}
