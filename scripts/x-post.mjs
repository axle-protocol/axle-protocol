#!/usr/bin/env node
// X (Twitter) API v2 posting script
// Usage: node x-post.mjs "tweet text"
//        node x-post.mjs --reply <tweet_id> "reply text"

import { TwitterApi } from 'twitter-api-v2';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const credsPath = resolve(__dirname, '../.x-credentials');

// Load credentials
const creds = {};
readFileSync(credsPath, 'utf-8').split('\n').forEach(line => {
  const [key, ...val] = line.split('=');
  if (key && val.length) creds[key.trim()] = val.join('=').trim();
});

const client = new TwitterApi({
  appKey: creds.X_API_KEY,
  appSecret: creds.X_API_SECRET,
  accessToken: creds.X_ACCESS_TOKEN,
  accessSecret: creds.X_ACCESS_TOKEN_SECRET,
});

const args = process.argv.slice(2);

async function main() {
  try {
    let replyToId = null;
    let text = '';

    if (args[0] === '--reply' && args[1]) {
      replyToId = args[1];
      text = args.slice(2).join(' ');
    } else {
      text = args.join(' ');
    }

    if (!text) {
      console.error('Usage: node x-post.mjs "tweet text"');
      console.error('       node x-post.mjs --reply <tweet_id> "reply text"');
      process.exit(1);
    }

    const params = replyToId ? { reply: { in_reply_to_tweet_id: replyToId } } : {};
    const result = await client.v2.tweet(text, params);
    
    console.log('✅ Posted!');
    console.log(`ID: ${result.data.id}`);
    console.log(`URL: https://x.com/agentmarket_kr/status/${result.data.id}`);
    console.log(`Text: ${result.data.text}`);
  } catch (err) {
    console.error('❌ Error:', err.message);
    if (err.data) console.error('Details:', JSON.stringify(err.data, null, 2));
    process.exit(1);
  }
}

main();
