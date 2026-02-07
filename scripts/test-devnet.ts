/**
 * PACT Protocol — Devnet Integration Test
 * Tests the full task lifecycle on Solana devnet.
 *
 * Usage: npx tsx scripts/test-devnet.ts
 */

import { Keypair, LAMPORTS_PER_SOL } from '@solana/web3.js';

// Use SDK from local path
import { PactSDK, TaskStatus } from '../sdk/src/index.js';

const PROGRAM_ID = '4zr1KP5Rp4xrofrUWFjPqBjJKciNL2s8qXt4eFtc7M82';

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  console.log('=== PACT Devnet Integration Test ===\n');

  // Initialize two SDK instances (requester + provider)
  const requester = new PactSDK({ cluster: 'devnet', programId: PROGRAM_ID });
  const provider = new PactSDK({ cluster: 'devnet', programId: PROGRAM_ID });

  // Step 1: Create wallets
  console.log('[1/9] Creating wallets...');
  const walletA = requester.createWallet();
  const walletB = provider.createWallet();
  console.log(`  Requester: ${walletA.publicKey.slice(0, 12)}...`);
  console.log(`  Provider:  ${walletB.publicKey.slice(0, 12)}...`);

  // Step 2: Airdrop SOL
  console.log('\n[2/9] Requesting airdrops...');
  try {
    await requester.requestAirdrop(2);
    console.log('  Requester: 2 SOL airdropped');
  } catch (e: any) {
    console.log(`  Requester airdrop failed: ${e.message}`);
    console.log('  Please fund manually: solana airdrop 2 ' + walletA.publicKey + ' --url devnet');
    console.log('  Or visit https://faucet.solana.com');
    process.exit(1);
  }
  await sleep(2000);
  try {
    await provider.requestAirdrop(1);
    console.log('  Provider:  1 SOL airdropped');
  } catch (e: any) {
    console.log(`  Provider airdrop failed: ${e.message}`);
    process.exit(1);
  }
  await sleep(2000);

  // Step 3: Register agents
  console.log('\n[3/9] Registering agents...');
  const agentA = await requester.registerAgent({
    nodeId: 'requester-devnet',
    capabilities: ['general'],
    feePerTask: 0,
  });
  console.log(`  Agent A: ${agentA.nodeId} (rep: ${agentA.reputation})`);

  const agentB = await provider.registerAgent({
    nodeId: 'provider-devnet',
    capabilities: ['scraping', 'analysis'],
    feePerTask: 1000,
  });
  console.log(`  Agent B: ${agentB.nodeId} (rep: ${agentB.reputation})`);

  // Step 4: Create task
  console.log('\n[4/9] Creating task...');
  const reward = 0.05 * LAMPORTS_PER_SOL;
  const task = await requester.createTask({
    description: 'Scrape top 10 Solana AI agent projects',
    capability: 'scraping',
    reward,
    deadline: new Date(Date.now() + 3600 * 1000), // 1 hour
  });
  console.log(`  Task: ${task.id.slice(0, 12)}... (${task.capability}, ${reward / LAMPORTS_PER_SOL} SOL)`);
  console.log(`  Status: ${task.status}`);

  // Step 5: Accept task
  console.log('\n[5/9] Provider accepting task...');
  const accepted = await provider.acceptTask(task.id);
  console.log(`  Status: ${accepted.status}`);
  console.log(`  Provider: ${accepted.provider?.slice(0, 12)}...`);

  // Step 6: Deliver task
  console.log('\n[6/9] Provider delivering result...');
  const result = {
    projects: ['PACT', 'cascade/PACT', 'GhostSpeak', 'KAMIYO', 'Amiko'],
    scrapedAt: new Date().toISOString(),
  };
  const delivered = await provider.deliverTask(task.id, result);
  console.log(`  Status: ${delivered.status}`);

  // Step 7: Complete task (release escrow)
  console.log('\n[7/9] Requester completing task...');
  const completed = await requester.completeTask(task.id);
  console.log(`  Status: ${completed.status}`);

  // Step 8: Check reputation
  console.log('\n[8/9] Checking reputation...');
  const updatedAgent = await requester.getAgent(walletB.publicKey);
  if (updatedAgent) {
    console.log(`  Provider rep: ${updatedAgent.reputation} (was 100)`);
    console.log(`  Tasks completed: ${updatedAgent.tasksCompleted}`);
  }

  // Step 9: Check balances
  console.log('\n[9/9] Final balances...');
  const balA = await requester.getBalance();
  const balB = await provider.getBalance();
  console.log(`  Requester: ${balA.toFixed(4)} SOL`);
  console.log(`  Provider:  ${balB.toFixed(4)} SOL`);

  console.log('\n=== Devnet Test Complete ===');
  console.log(`Program: ${PROGRAM_ID}`);
  console.log(`Explorer: https://explorer.solana.com/address/${PROGRAM_ID}?cluster=devnet`);
}

main().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
