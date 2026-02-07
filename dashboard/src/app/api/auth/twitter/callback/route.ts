import { NextRequest, NextResponse } from 'next/server';
import {
  getOAuthState,
  generateApiKey,
  storeApiKey,
} from '@/lib/auth';

const TWITTER_CLIENT_ID = process.env.TWITTER_CLIENT_ID!;
const TWITTER_CLIENT_SECRET = process.env.TWITTER_CLIENT_SECRET!;
const BASE_URL = process.env.NEXTAUTH_URL || 'http://localhost:3000';

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const error = searchParams.get('error');

  if (error) {
    return NextResponse.redirect(
      `${BASE_URL}/auth/error?message=${encodeURIComponent(error)}`
    );
  }

  if (!code || !state) {
    return NextResponse.redirect(
      `${BASE_URL}/auth/error?message=missing_params`
    );
  }

  // Validate state
  const oauthData = getOAuthState(state);
  if (!oauthData) {
    return NextResponse.redirect(
      `${BASE_URL}/auth/error?message=invalid_state`
    );
  }

  try {
    // Exchange code for access token
    const tokenRes = await fetch('https://api.twitter.com/2/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${Buffer.from(`${TWITTER_CLIENT_ID}:${TWITTER_CLIENT_SECRET}`).toString('base64')}`,
      },
      body: new URLSearchParams({
        code,
        grant_type: 'authorization_code',
        redirect_uri: oauthData.redirectUri,
        code_verifier: oauthData.codeVerifier,
      }),
    });

    if (!tokenRes.ok) {
      const err = await tokenRes.text();
      console.error('Token exchange failed:', err);
      return NextResponse.redirect(
        `${BASE_URL}/auth/error?message=token_exchange_failed`
      );
    }

    const tokenData = await tokenRes.json();
    const accessToken = tokenData.access_token;

    // Get user profile
    const userRes = await fetch(
      'https://api.twitter.com/2/users/me?user.fields=profile_image_url',
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );

    if (!userRes.ok) {
      return NextResponse.redirect(
        `${BASE_URL}/auth/error?message=profile_fetch_failed`
      );
    }

    const userData = await userRes.json();
    const { id: twitterId, username: twitterHandle, name: twitterName } = userData.data;
    const twitterAvatar = userData.data.profile_image_url || '';

    // Generate API key
    const apiKey = generateApiKey();
    storeApiKey({
      apiKey,
      twitterId,
      twitterHandle,
      twitterName,
      twitterAvatar,
      createdAt: Date.now(),
    });

    // Redirect to success page with API key
    const params = new URLSearchParams({
      apiKey,
      handle: twitterHandle,
      name: twitterName,
      avatar: twitterAvatar,
    });

    return NextResponse.redirect(`${BASE_URL}/auth/success?${params.toString()}`);
  } catch (err) {
    console.error('OAuth callback error:', err);
    return NextResponse.redirect(
      `${BASE_URL}/auth/error?message=internal_error`
    );
  }
}
