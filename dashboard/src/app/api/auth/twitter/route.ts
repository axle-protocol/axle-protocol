import { NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import {
  storeOAuthState,
  generateCodeVerifier,
  generateCodeChallenge,
} from '@/lib/auth';

const TWITTER_CLIENT_ID = process.env.TWITTER_CLIENT_ID!;
const BASE_URL = process.env.NEXTAUTH_URL || 'http://localhost:3000';

export async function GET() {
  const state = randomBytes(16).toString('hex');
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await generateCodeChallenge(codeVerifier);
  const redirectUri = `${BASE_URL}/api/auth/twitter/callback`;

  storeOAuthState(state, {
    codeVerifier,
    redirectUri,
    createdAt: Date.now(),
  });

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: TWITTER_CLIENT_ID,
    redirect_uri: redirectUri,
    scope: 'tweet.read users.read offline.access',
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });

  return NextResponse.redirect(
    `https://twitter.com/i/oauth2/authorize?${params.toString()}`
  );
}
