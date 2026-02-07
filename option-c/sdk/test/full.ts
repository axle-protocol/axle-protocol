/**
 * @pact-protocol/sdk — Full Test Suite (localnet)
 * Tests ALL SDK methods including cancel, timeout, update, badge, and edge cases.
 *
 * Usage: npx tsx test/full.ts
 */

import { PactSDK, TaskStatus } from '../src/index.js';
import { LAMPORTS_PER_SOL } from '@solana/web3.js';

let passed = 0;
let failed = 0;

function assert(condition: boolean, name: string) {
  if (condition) {
    console.log(`  PASS: ${name}`);
    passed++;
  } else {
    console.log(`  FAIL: ${name}`);
    failed++;
  }
}

async function main() {
  console.log('=== @pact-protocol/sdk Full Test Suite ===\n');

  const requester = new PactSDK({ cluster: 'localnet' });
  const provider = new PactSDK({ cluster: 'localnet' });
  const bystander = new PactSDK({ cluster: 'localnet' });

  const wA = requester.createWallet();
  const wB = provider.createWallet();
  const wC = bystander.createWallet();

  await requester.requestAirdrop(10);
  await provider.requestAirdrop(5);
  await bystander.requestAirdrop(2);

  // ── Test 1: Agent Registration ──
  console.log('\n[Test 1] Agent Registration');
  const agentA = await requester.registerAgent({
    nodeId: 'test-requester', capabilities: ['general', 'testing'], feePerTask: 0,
  });
  assert(agentA.nodeId === 'test-requester', 'nodeId correct');
  assert(agentA.reputation === 100, 'initial reputation = 100');
  assert(agentA.capabilities.includes('general'), 'has general capability');
  assert(agentA.capabilities.includes('testing'), 'has testing capability');
  assert(agentA.isActive === true, 'is active');
  assert(agentA.tasksCompleted === 0, 'tasks completed = 0');

  const agentB = await provider.registerAgent({
    nodeId: 'test-provider', capabilities: ['scraping', 'analysis'], feePerTask: 5000,
  });
  assert(agentB.nodeId === 'test-provider', 'provider registered');

  // ── Test 2: getAgent + findAgents ──
  console.log('\n[Test 2] Agent Queries');
  const fetchedA = await requester.getAgent(wA.publicKey);
  assert(fetchedA !== null, 'getAgent returns agent');
  assert(fetchedA?.nodeId === 'test-requester', 'getAgent nodeId matches');

  const nonExistent = await requester.getAgent(wC.publicKey);
  assert(nonExistent === null, 'getAgent returns null for unregistered');

  const scrapers = await requester.findAgents('scraping');
  assert(scrapers.length === 1, 'findAgents(scraping) = 1');
  assert(scrapers[0].nodeId === 'test-provider', 'correct agent found');

  const generals = await requester.findAgents('general');
  assert(generals.length === 1, 'findAgents(general) = 1');

  const noMatch = await requester.findAgents('quantum-computing');
  assert(noMatch.length === 0, 'findAgents(non-existent) = 0');

  // ── Test 3: updateAgent ──
  console.log('\n[Test 3] Update Agent');
  await requester.updateAgent({ feePerTask: 2000 });
  const updatedA = await requester.getAgent(wA.publicKey);
  assert(updatedA?.feePerTask === 2000, 'feePerTask updated');

  await requester.updateAgent({ isActive: false });
  const deactivated = await requester.getAgent(wA.publicKey);
  assert(deactivated?.isActive === false, 'agent deactivated');

  await requester.updateAgent({ isActive: true });
  const reactivated = await requester.getAgent(wA.publicKey);
  assert(reactivated?.isActive === true, 'agent reactivated');

  // ── Test 4: Full Task Lifecycle (happy path) ──
  console.log('\n[Test 4] Full Task Lifecycle');
  const task1 = await requester.createTask({
    description: 'Full lifecycle test',
    capability: 'scraping',
    reward: 0.1 * LAMPORTS_PER_SOL,
    deadline: new Date(Date.now() + 3600_000),
  });
  assert(task1.status === TaskStatus.Created, 'task created');
  assert(task1.reward === 0.1 * LAMPORTS_PER_SOL, 'reward correct');

  const accepted1 = await provider.acceptTask(task1.id);
  assert(accepted1.status === TaskStatus.Accepted, 'task accepted');
  assert(accepted1.provider !== undefined, 'provider assigned');

  const delivered1 = await provider.deliverTask(task1.id, { data: 'result1' });
  assert(delivered1.status === TaskStatus.Delivered, 'task delivered');

  const balBBefore = await provider.getBalance();
  const completed1 = await requester.completeTask(task1.id);
  assert(completed1.status === TaskStatus.Completed, 'task completed');
  const balBAfter = await provider.getBalance();
  assert(balBAfter > balBBefore, 'provider received payment');

  const agentBAfter = await requester.getAgent(wB.publicKey);
  assert(agentBAfter!.reputation === 110, 'reputation +10 → 110');
  assert(agentBAfter!.tasksCompleted === 1, 'tasks completed = 1');

  // ── Test 5: Cancel Task ──
  console.log('\n[Test 5] Cancel Task');
  const balABefore = await requester.getBalance();
  const task2 = await requester.createTask({
    description: 'Will be cancelled',
    capability: 'analysis',
    reward: 0.05 * LAMPORTS_PER_SOL,
    deadline: new Date(Date.now() + 3600_000),
  });
  const balAMid = await requester.getBalance();
  assert(balAMid < balABefore, 'escrow deducted on create');

  const cancelled = await requester.cancelTask(task2.id);
  assert(cancelled.status === TaskStatus.Cancelled, 'task cancelled');
  const balAAfterCancel = await requester.getBalance();
  assert(balAAfterCancel > balAMid, 'escrow refunded on cancel');

  // ── Test 6: Timeout Task ──
  console.log('\n[Test 6] Timeout Task');
  // Create task with deadline in the past (1 second)
  const task3 = await requester.createTask({
    description: 'Will timeout',
    capability: 'scraping',
    reward: 0.02 * LAMPORTS_PER_SOL,
    deadline: new Date(Date.now() + 2000), // 2 seconds
  });

  await provider.acceptTask(task3.id);

  // Wait for deadline to pass
  console.log('  Waiting for deadline...');
  await new Promise(r => setTimeout(r, 3000));

  const timedOut = await requester.timeoutTask(task3.id);
  assert(timedOut.status === TaskStatus.TimedOut, 'task timed out');

  const agentBTimeout = await requester.getAgent(wB.publicKey);
  assert(agentBTimeout!.tasksFailed === 1, 'tasks failed = 1');
  assert(agentBTimeout!.reputation === 90, 'reputation -20 → 90');

  // ── Test 7: getTask + listTasks ──
  console.log('\n[Test 7] Task Queries');
  const fetchedTask = await requester.getTask(task1.id);
  assert(fetchedTask !== null, 'getTask returns task');
  assert(fetchedTask?.status === TaskStatus.Completed, 'getTask status correct');

  const allTasks = await requester.listTasks();
  assert(allTasks.length === 3, 'listTasks returns 3 tasks');

  // ── Test 8: Message Signing ──
  console.log('\n[Test 8] Message Signing');
  const msg = requester.createMessage('DISCOVER', wB.publicKey, { capability: 'scraping' });
  assert(msg.type === 'DISCOVER', 'message type correct');
  assert(msg.signature.length > 0, 'message is signed');

  const valid = provider.verifyMessage(msg);
  assert(valid === true, 'valid signature verified');

  // Tamper with message
  const tamperedMsg = { ...msg, timestamp: Date.now() + 1 };
  const invalid = provider.verifyMessage(tamperedMsg);
  assert(invalid === false, 'tampered message rejected');

  // ── Test 9: Events ──
  console.log('\n[Test 9] Events');
  let eventFired = false;
  requester.on('task_created', () => { eventFired = true; });
  await requester.createTask({
    description: 'Event test',
    capability: 'general',
    reward: 0.01 * LAMPORTS_PER_SOL,
    deadline: new Date(Date.now() + 3600_000),
  });
  assert(eventFired === true, 'task_created event fired');

  // ── Test 10: Getters ──
  console.log('\n[Test 10] SDK Getters');
  assert(requester.getWalletAddress() === wA.publicKey, 'getWalletAddress correct');
  assert(requester.getProgramId() === '4zr1KP5Rp4xrofrUWFjPqBjJKciNL2s8qXt4eFtc7M82', 'getProgramId correct');
  assert(requester.getConnection() !== null, 'getConnection returns connection');

  // ── Summary ──
  console.log(`\n${'='.repeat(40)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log(`${'='.repeat(40)}`);

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
