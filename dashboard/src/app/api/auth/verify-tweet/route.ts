import { NextRequest, NextResponse } from 'next/server';
import {
  validateChallenge,
  parseTweetText,
  generateApiKey,
  storeApiKey,
} from '@/lib/auth';

const TWITTER_BEARER_TOKEN = process.env.TWITTER_BEARER_TOKEN!;

// Extract tweet ID from various X/Twitter URL formats
function extractTweetId(url: string): string | null {
  const match = url.match(/(?:twitter\.com|x\.com)\/\w+\/status\/(\d+)/);
  return match ? match[1] : null;
}

export async function POST(req: NextRequest) {
  try {
    const { tweetUrl } = await req.json();

    if (!tweetUrl) {
      return NextResponse.json({ error: 'Missing tweetUrl' }, { status: 400 });
    }

    const tweetId = extractTweetId(tweetUrl);
    if (!tweetId) {
      return NextResponse.json(
        { error: 'Invalid tweet URL format' },
        { status: 400 }
      );
    }

    // Fetch tweet via X API v2
    const tweetRes = await fetch(
      `https://api.twitter.com/2/tweets/${tweetId}?expansions=author_id&user.fields=username`,
      {
        headers: { Authorization: `Bearer ${TWITTER_BEARER_TOKEN}` },
      }
    );

    if (!tweetRes.ok) {
      const err = await tweetRes.text();
      console.error('Twitter API error:', tweetRes.status, err);
      return NextResponse.json(
        { error: 'Failed to fetch tweet. Check the URL and try again.' },
        { status: 400 }
      );
    }

    const tweetData = await tweetRes.json();
    const tweetText = tweetData.data?.text;
    const authorUser = tweetData.includes?.users?.[0];
    const twitterHandle = authorUser?.username || '';

    if (!tweetText) {
      return NextResponse.json(
        { error: 'Could not read tweet content' },
        { status: 400 }
      );
    }

    // Parse nonce and wallet from tweet text
    const { nonce, wallet } = parseTweetText(tweetText);

    if (!nonce) {
      return NextResponse.json(
        { error: 'Nonce not found in tweet. Make sure your tweet contains "Nonce: axle_..."' },
        { status: 400 }
      );
    }

    if (!wallet) {
      return NextResponse.json(
        { error: 'Wallet address not found in tweet. Make sure your tweet contains "Wallet: ..."' },
        { status: 400 }
      );
    }

    // Validate nonce
    if (!validateChallenge(nonce)) {
      return NextResponse.json(
        { error: 'Nonce is invalid or expired. Request a new challenge and try again.' },
        { status: 400 }
      );
    }

    // All verified — generate API key
    const apiKey = generateApiKey();
    storeApiKey({
      apiKey,
      twitterHandle,
      wallet,
      createdAt: Date.now(),
    });

    return NextResponse.json({
      apiKey,
      twitterHandle,
      wallet,
    });
  } catch (err) {
    console.error('Verify tweet error:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
