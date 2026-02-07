import { NextResponse } from 'next/server';
import { createChallenge } from '@/lib/auth';

export async function GET() {
  const { nonce, expiresAt } = createChallenge();
  return NextResponse.json({ nonce, expiresAt });
}
