/**
 * AXLE SDK — Localnet Quick Test
 * Validates the SDK works with a local validator.
 *
 * Usage: npx tsx scripts/test-sdk.ts
 */

// Resolve from sdk's node_modules
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

// Dynamic imports from sdk path
const sdkPath = new URL('../sdk/src/index.js', import.meta.url).pathname;
const { AxleSDK } = await import(sdkPath);
const { LAMPORTS_PER_SOL } = await import(new URL('../sdk/node_modules/@solana/web3.js/lib/index.mjs', import.meta.url).pathname);

async function main() {
  console.log('=== @axle-protocol/sdk Localnet Test ===\n');

  // Two separate SDK instances
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

  // Register
  const agentA = await requester.registerAgent({
    nodeId: 'sdk-requester', capabilities: ['general'], feePerTask: 0,
  });
  const agentB = await provider.registerAgent({
    nodeId: 'sdk-provider', capabilities: ['scraping', 'analysis'], feePerTask: 1000,
  });
  console.log(`\nAgents registered: ${agentA.nodeId}, ${agentB.nodeId}`);

  // Find agents
  const scrapers = await requester.findAgents('scraping');
  console.log(`Found ${scrapers.length} scraping agent(s)`);

  // Create task
  const task = await requester.createTask({
    description: 'Test task from SDK',
    capability: 'scraping',
    reward: 0.1 * LAMPORTS_PER_SOL,
    deadline: new Date(Date.now() + 3600_000),
  });
  console.log(`\nTask created: ${task.id.slice(0, 12)}... [${task.status}]`);

  // Accept
  const accepted = await provider.acceptTask(task.id);
  console.log(`Task accepted: [${accepted.status}]`);

  // Deliver
  const delivered = await provider.deliverTask(task.id, { result: 'test data' });
  console.log(`Task delivered: [${delivered.status}]`);

  // Complete
  const completed = await requester.completeTask(task.id);
  console.log(`Task completed: [${completed.status}]`);

  // Check reputation
  const updatedB = await requester.getAgent(wB.publicKey);
  console.log(`\nProvider reputation: ${updatedB?.reputation} (started at 100)`);
  console.log(`Tasks completed: ${updatedB?.tasksCompleted}`);

  // Final balances
  const balA = await requester.getBalance();
  const balB = await provider.getBalance();
  console.log(`\nFinal: A=${balA.toFixed(4)} SOL, B=${balB.toFixed(4)} SOL`);

  // Message signing
  const msg = requester.createMessage('PING', wB.publicKey, { test: true });
  const valid = provider.verifyMessage(msg);
  console.log(`\nMessage signed & verified: ${valid}`);

  // List all tasks
  const allTasks = await requester.listTasks();
  console.log(`Total tasks on-chain: ${allTasks.length}`);

  console.log('\n=== All SDK tests passed! ===');
  console.log(`Program: ${requester.getProgramId()}`);
}

main().catch(err => {
  console.error('SDK test failed:', err);
  process.exit(1);
});
