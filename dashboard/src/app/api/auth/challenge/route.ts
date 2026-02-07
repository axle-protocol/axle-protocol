import { NextResponse } from 'next/server';
import { createChallenge } from '@/lib/auth';

// Prevent static generation - always generate fresh nonce
export const dynamic = 'force-dynamic';

export async function GET() {
  const { nonce, expiresAt } = createChallenge();
  return NextResponse.json({ nonce, expiresAt });
}
