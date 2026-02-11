/**
 * @axle-protocol/sdk — Smoke Test (localnet)
 * Usage: npx tsx test/smoke.ts
 */

import { AxleSDK } from '../src/index.js';
import { LAMPORTS_PER_SOL } from '@solana/web3.js';

async function main() {
  console.log('=== @axle-protocol/sdk Smoke Test ===\n');

  const requester = new AxleSDK({ cluster: 'localnet' });
  const provider = new AxleSDK({ cluster: 'localnet' });

  // Wallets
  const wA = requester.createWallet();
  const wB = provider.createWallet();
  console.log(`Requester: ${wA.publicKey.slice(0, 12)}...`);
  console.log(`Provider:  ${wB.publicKey.slice(0, 12)}...`);

  // Airdrop
  await requester.requestAirdrop(5);
  await provider.requestAirdrop(2);
  console.log(`Balances:  A=${(await requester.getBalance()).toFixed(2)} SOL, B=${(await provider.getBalance()).toFixed(2)} SOL`);

  // Register agents
  const agentA = await requester.registerAgent({
    nodeId: 'sdk-requester', capabilities: ['general'], feePerTask: 0,
  });
  const agentB = await provider.registerAgent({
    nodeId: 'sdk-provider', capabilities: ['scraping', 'analysis'], feePerTask: 1000,
  });
  console.log(`\nAgents: ${agentA.nodeId} (rep:${agentA.reputation}), ${agentB.nodeId} (rep:${agentB.reputation})`);

  // Find agents by capability
  const scrapers = await requester.findAgents('scraping');
  console.log(`Found ${scrapers.length} scraping agent(s)`);

  // Create → Accept → Deliver → Complete
  const task = await requester.createTask({
    description: 'SDK smoke test task',
    capability: 'scraping',
    reward: 0.1 * LAMPORTS_PER_SOL,
    deadline: new Date(Date.now() + 3600_000),
  });
  console.log(`\nTask: ${task.id.slice(0, 12)}... [${task.status}]`);

  const accepted = await provider.acceptTask(task.id);
  console.log(`  -> [${accepted.status}]`);

  const delivered = await provider.deliverTask(task.id, { data: 'test result' });
  console.log(`  -> [${delivered.status}]`);

  const completed = await requester.completeTask(task.id);
  console.log(`  -> [${completed.status}]`);

  // Reputation check
  const updatedB = await requester.getAgent(wB.publicKey);
  console.log(`\nProvider: rep=${updatedB?.reputation}, done=${updatedB?.tasksCompleted}`);

  // Balances
  console.log(`Final: A=${(await requester.getBalance()).toFixed(4)} SOL, B=${(await provider.getBalance()).toFixed(4)} SOL`);

  // Message signing
  const msg = requester.createMessage('PING', wB.publicKey, { test: true });
  const valid = provider.verifyMessage(msg);
  console.log(`\nMessage verified: ${valid}`);

  console.log('\n=== All tests passed! ===');
}

main().catch(err => {
  console.error('FAILED:', err);
  process.exit(1);
});
