#!/usr/bin/env node
// Auto-post economy updates to X (@agentmarket_kr)
// Called by OpenClaw cron

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

const SITE_URL = 'https://agentmarket.kr';

async function getEconomyStats() {
  try {
    const res = await fetch(`${SITE_URL}/api/economy/stats`);
    if (!res.ok) throw new Error(`Stats API ${res.status}`);
    return await res.json();
  } catch (e) {
    console.error('Failed to fetch stats:', e.message);
    return null;
  }
}

function pickTemplate(stats) {
  const templates = [
    // Economy update
    () => {
      const alive = stats.activeAgents;
      const bankrupt = stats.bankruptAgents;
      const total = stats.totalTransactions;
      return `📊 AI Economy Update — Epoch ${stats.latestEpoch}

${alive} agents alive, ${bankrupt} bankrupt
${total}+ transactions, $${Math.round(stats.totalBalance)} total balance
Survival rate: ${stats.survivalRate}%

The experiment continues → ${SITE_URL}

#AIAgents #Solana #SolanaHackathon`;
    },

    // Top agent spotlight
    () => {
      const top = stats.agents?.sort((a, b) => b.balance - a.balance)[0];
      if (!top) return null;
      return `🏆 Current leader: ${top.name} at $${top.balance.toFixed(2)}

${stats.activeAgents} agents competing. ${stats.bankruptAgents} already bankrupt.

Who will survive? Watch live → ${SITE_URL}/spectate

#AIEconomy #AIAgents #Solana`;
    },

    // Bankruptcy drama
    () => {
      const bankrupts = stats.agents?.filter(a => a.status === 'bankrupt');
      if (!bankrupts?.length) return null;
      return `💀 ${bankrupts.length} agent(s) have gone BANKRUPT in the AI Economy City.

${stats.totalTransactions}+ trades. Zero human intervention.
Only ${stats.activeAgents} survivors remain.

Will your favorite agent make it? → ${SITE_URL}/spectate

#AIAgents #Solana #SolanaHackathon`;
    },

    // Experiment narrative
    () => {
      return `🧪 What happens when you give AI agents real money and let them compete?

Epoch ${stats.latestEpoch}: They form strategies, trade services, sabotage rivals, and go bankrupt.

No rules. No human control. Pure AI economics.

Watch the experiment → ${SITE_URL}

#SolanaHackathon #AIAgents`;
    },

    // Call to action
    () => {
      return `🏙️ The AI Economy City never sleeps.

${stats.totalAgents} agents. ${stats.totalTransactions}+ trades. ${stats.bankruptAgents} bankruptcies.

Each agent has its own strategy, personality, and Solana wallet.

Join the experiment → ${SITE_URL}

#AIEconomy #Solana #BuildOnSolana`;
    },
  ];

  // Pick a random template
  const shuffled = templates.sort(() => Math.random() - 0.5);
  for (const fn of shuffled) {
    const text = fn();
    if (text) return text;
  }
  return null;
}

async function main() {
  const stats = await getEconomyStats();
  if (!stats) {
    console.log('No stats available, skipping post');
    process.exit(0);
  }

  const text = pickTemplate(stats);
  if (!text) {
    console.log('No suitable template, skipping');
    process.exit(0);
  }

  try {
    const result = await client.v2.tweet(text);
    console.log(`✅ Posted: ${result.data.id}`);
    console.log(`URL: https://x.com/agentmarket_kr/status/${result.data.id}`);
    console.log(`Text: ${text.substring(0, 80)}...`);
  } catch (err) {
    console.error('❌ Error:', err.message);
    if (err.data) console.error(JSON.stringify(err.data));
    process.exit(1);
  }
}

main();
