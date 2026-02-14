import { PublicKey } from '@solana/web3.js';

export const PROGRAM_ID = new PublicKey('4zr1KP5Rp4xrofrUWFjPqBjJKciNL2s8qXt4eFtc7M82');

export const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL || 'https://api.devnet.solana.com';

export const CAPABILITIES = [
  'text-generation',
  'image-analysis',
  'data-scraping',
  'code-review',
  'translation',
] as const;

export const SOLSCAN_BASE = 'https://solscan.io';

export const CLUSTER = 'devnet';

export function solscanTxUrl(signature: string): string {
  return `${SOLSCAN_BASE}/tx/${signature}?cluster=${CLUSTER}`;
}

export function solscanAccountUrl(address: string): string {
  return `${SOLSCAN_BASE}/account/${address}?cluster=${CLUSTER}`;
}
