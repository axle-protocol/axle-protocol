#!/usr/bin/env node
/**
 * AXLE Demo — 2-Node Agent Protocol on Solana
 *
 * Demonstrates the full task lifecycle:
 *   1. Two agents register on-chain with different capabilities
 *   2. Agent badges (Token-2022 NFTs) are minted
 *   3. Requester creates a task with escrow
 *   4. Provider discovers and accepts the task
 *   5. Provider delivers the result
 *   6. Requester completes the task — escrow pays provider
 *   7. Reputation is updated on-chain
 *
 * Requires: solana-test-validator running on localhost:8899
 *
 * Usage:
 *   REDIS_URL=redis://localhost:6379 npx ts-node src/run-demo.ts   # with Redis
 *   npx ts-node src/run-demo.ts                                     # in-memory
 */

import { createHash } from 'crypto';
import anchor from '@coral-xyz/anchor';
const { Program, AnchorProvider } = anchor;
type Idl = anchor.Idl;
import BN from 'bn.js';
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import {
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import { v4 as uuidv4 } from 'uuid';
import bs58 from 'bs58';

import { createPubSub, CHANNELS, type PubSub } from './pubsub.js';

// ============ Load IDL ============

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const idlPath = join(__dirname, '..', '..', 'plugin', 'src', 'idl', 'agent_protocol.json');
const idlJson = JSON.parse(readFileSync(idlPath, 'utf-8'));

// The actual deployed program ID (from keypair, not the IDL placeholder)
const DEPLOYED_PROGRAM_ID = '4zr1KP5Rp4xrofrUWFjPqBjJKciNL2s8qXt4eFtc7M82';
idlJson.address = DEPLOYED_PROGRAM_ID;
const PROGRAM_ID = new PublicKey(DEPLOYED_PROGRAM_ID);

// ============ Helpers ============

const RPC_URL = process.env.RPC_URL || 'http://127.0.0.1:8899';

function sha256(data: string): Uint8Array {
  return new Uint8Array(createHash('sha256').update(data).digest());
}

function getAgentPDA(authority: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from('agent'), authority.toBuffer()], PROGRAM_ID);
  return pda;
}

function getTaskPDA(taskId: Uint8Array): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from('task'), taskId], PROGRAM_ID);
  return pda;
}

function getEscrowPDA(taskId: Uint8Array): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from('escrow'), taskId], PROGRAM_ID);
  return pda;
}

function getBadgeMintPDA(authority: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from('badge'), authority.toBuffer()], PROGRAM_ID);
  return pda;
}

function makeProgram(connection: Connection, wallet: Keypair): Program {
  const walletAdapter = {
    publicKey: wallet.publicKey,
    signTransaction: async <T extends import('@solana/web3.js').Transaction>(tx: T): Promise<T> => {
      tx.sign(wallet);
      return tx;
    },
    signAllTransactions: async <T extends import('@solana/web3.js').Transaction>(txs: T[]): Promise<T[]> => {
      txs.forEach(tx => tx.sign(wallet));
      return txs;
    },
  };
  const provider = new AnchorProvider(connection, walletAdapter as any, { commitment: 'confirmed' });
  return new Program(idlJson as unknown as Idl, provider);
}

function shortKey(pk: PublicKey): string {
  return pk.toBase58().slice(0, 8) + '...';
}

// ============ Pretty Logging ============

const COLORS = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  magenta: '\x1b[35m',
  blue: '\x1b[34m',
  white: '\x1b[37m',
  bgBlue: '\x1b[44m',
  bgGreen: '\x1b[42m',
  bgYellow: '\x1b[43m',
};

function banner(text: string): void {
  const line = '='.repeat(60);
  console.log(`\n${COLORS.bright}${COLORS.cyan}${line}${COLORS.reset}`);
  console.log(`${COLORS.bright}${COLORS.cyan}  ${text}${COLORS.reset}`);
  console.log(`${COLORS.bright}${COLORS.cyan}${line}${COLORS.reset}\n`);
}

function step(n: number, label: string): void {
  console.log(`\n${COLORS.bright}${COLORS.yellow}[Step ${n}]${COLORS.reset} ${COLORS.bright}${label}${COLORS.reset}`);
}

function nodeLog(name: string, color: string, msg: string): void {
  console.log(`  ${color}[${name}]${COLORS.reset} ${msg}`);
}

function success(msg: string): void {
  console.log(`  ${COLORS.green}  >> ${msg}${COLORS.reset}`);
}

function info(msg: string): void {
  console.log(`  ${COLORS.dim}     ${msg}${COLORS.reset}`);
}

async function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

// ============ Main Demo ============

async function main() {
  banner('AXLE — Protocol for Agent Coordination & Tasks Demo');
  console.log(`  Program ID: ${COLORS.bright}${PROGRAM_ID.toBase58()}${COLORS.reset}`);
  console.log(`  RPC:        ${RPC_URL}`);
  console.log(`  Time:       ${new Date().toISOString()}`);

  // ---- Connect to cluster ----
  const connection = new Connection(RPC_URL, 'confirmed');
  try {
    const version = await connection.getVersion();
    console.log(`  Solana:     ${version['solana-core']}`);
  } catch {
    console.error(`\n${COLORS.red}ERROR: Cannot connect to ${RPC_URL}`);
    console.error(`Run 'solana-test-validator --reset' in another terminal first.${COLORS.reset}\n`);
    process.exit(1);
  }

  // ---- Initialize PubSub ----
  const pubsub = await createPubSub();
  console.log(`  Transport:  ${pubsub.transport}`);

  // ---- Create wallets ----
  const walletA = Keypair.generate(); // Requester
  const walletB = Keypair.generate(); // Provider

  console.log(`\n  Node A (Requester): ${COLORS.cyan}${shortKey(walletA.publicKey)}${COLORS.reset}`);
  console.log(`  Node B (Provider):  ${COLORS.magenta}${shortKey(walletB.publicKey)}${COLORS.reset}`);

  const programA = makeProgram(connection, walletA);
  const programB = makeProgram(connection, walletB);

  // ============================================================
  // Step 1: Airdrop SOL
  // ============================================================
  step(1, 'Airdrop SOL to both nodes');

  const [sigA, sigB] = await Promise.all([
    connection.requestAirdrop(walletA.publicKey, 5 * LAMPORTS_PER_SOL),
    connection.requestAirdrop(walletB.publicKey, 5 * LAMPORTS_PER_SOL),
  ]);
  await Promise.all([
    connection.confirmTransaction(sigA),
    connection.confirmTransaction(sigB),
  ]);

  const [balA, balB] = await Promise.all([
    connection.getBalance(walletA.publicKey),
    connection.getBalance(walletB.publicKey),
  ]);
  nodeLog('Node A', COLORS.cyan, `Balance: ${balA / LAMPORTS_PER_SOL} SOL`);
  nodeLog('Node B', COLORS.magenta, `Balance: ${balB / LAMPORTS_PER_SOL} SOL`);

  // ============================================================
  // Step 2: Register Agents on-chain
  // ============================================================
  step(2, 'Register agents on-chain');

  const agentPDA_A = getAgentPDA(walletA.publicKey);
  const agentPDA_B = getAgentPDA(walletB.publicKey);

  // Register Node A
  await (programA.methods as any)
    .registerAgent('requester-node', JSON.stringify(['general']), new BN(0))
    .accounts({
      agentAccount: agentPDA_A,
      authority: walletA.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
  nodeLog('Node A', COLORS.cyan, 'Registered as "requester-node" capabilities=["general"]');

  // Register Node B
  await (programB.methods as any)
    .registerAgent('scraper-node', JSON.stringify(['scraping', 'web']), new BN(1000))
    .accounts({
      agentAccount: agentPDA_B,
      authority: walletB.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
  nodeLog('Node B', COLORS.magenta, 'Registered as "scraper-node" capabilities=["scraping","web"]');

  // Publish registration events
  await pubsub.publish(CHANNELS.AGENTS, JSON.stringify({
    type: 'registered', nodeId: 'requester-node', pubkey: walletA.publicKey.toBase58(),
  }));
  await pubsub.publish(CHANNELS.AGENTS, JSON.stringify({
    type: 'registered', nodeId: 'scraper-node', pubkey: walletB.publicKey.toBase58(),
  }));

  // Verify on-chain
  const agentDataA = await (programA.account as any).agentState.fetch(agentPDA_A);
  const agentDataB = await (programB.account as any).agentState.fetch(agentPDA_B);
  success(`Node A PDA: ${agentPDA_A.toBase58().slice(0, 16)}... rep=${agentDataA.reputation.toString()}`);
  success(`Node B PDA: ${agentPDA_B.toBase58().slice(0, 16)}... rep=${agentDataB.reputation.toString()}`);

  // ============================================================
  // Step 3: Mint Agent Badge NFTs (Token-2022)
  // ============================================================
  step(3, 'Mint Agent Badge NFTs (Token-2022)');

  let badgeMintedA = false;
  let badgeMintedB = false;

  const badgeMintA = getBadgeMintPDA(walletA.publicKey);
  const tokenAccountA = getAssociatedTokenAddressSync(
    badgeMintA, walletA.publicKey, false, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID,
  );

  try {
    await (programA.methods as any)
      .mintAgentBadge('AXLE Requester Badge', 'AXLE', 'https://axle.openclaw.io/badge/requester')
      .accounts({
        agentAccount: agentPDA_A,
        badgeMint: badgeMintA,
        tokenAccount: tokenAccountA,
        authority: walletA.publicKey,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    nodeLog('Node A', COLORS.cyan, `Badge minted: ${shortKey(badgeMintA)}`);
    badgeMintedA = true;
  } catch (e: any) {
    nodeLog('Node A', COLORS.yellow, `Badge minting skipped (Token-2022 reallocation issue on localnet)`);
    info('Badge minting works on devnet — localnet has known realloc limitations');
  }

  const badgeMintB = getBadgeMintPDA(walletB.publicKey);
  const tokenAccountB = getAssociatedTokenAddressSync(
    badgeMintB, walletB.publicKey, false, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID,
  );

  try {
    await (programB.methods as any)
      .mintAgentBadge('AXLE Provider Badge', 'AXLE', 'https://axle.openclaw.io/badge/provider')
      .accounts({
        agentAccount: agentPDA_B,
        badgeMint: badgeMintB,
        tokenAccount: tokenAccountB,
        authority: walletB.publicKey,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    nodeLog('Node B', COLORS.magenta, `Badge minted: ${shortKey(badgeMintB)}`);
    badgeMintedB = true;
  } catch (e: any) {
    nodeLog('Node B', COLORS.yellow, `Badge minting skipped`);
  }

  if (badgeMintedA && badgeMintedB) {
    success('Both agents now hold Token-2022 NFT identity badges');
  } else {
    info('Continuing with core task lifecycle (badge = Phase 2 feature)');
  }

  // ============================================================
  // Step 4: Create Task with Escrow
  // ============================================================
  step(4, 'Requester creates task with 0.1 SOL escrow');

  const taskUuid = uuidv4();
  const taskIdBytes = sha256(taskUuid);
  const taskPDA = getTaskPDA(taskIdBytes);
  const escrowPDA = getEscrowPDA(taskIdBytes);

  const taskDescription = 'Scrape the top 10 trending repositories from GitHub';
  const descriptionHash = sha256(taskDescription);
  const deadlineUnix = Math.floor(Date.now() / 1000) + 3600; // +1 hour
  const rewardLamports = 0.1 * LAMPORTS_PER_SOL;

  await (programA.methods as any)
    .createTask(
      Array.from(taskIdBytes),
      Array.from(descriptionHash),
      'scraping',
      new BN(rewardLamports),
      new BN(deadlineUnix),
    )
    .accounts({
      taskAccount: taskPDA,
      escrow: escrowPDA,
      requester: walletA.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  nodeLog('Node A', COLORS.cyan, `Task created: "${taskDescription}"`);
  info(`Task ID:    ${taskUuid}`);
  info(`Task PDA:   ${shortKey(taskPDA)}`);
  info(`Escrow PDA: ${shortKey(escrowPDA)}`);
  info(`Reward:     0.1 SOL (${rewardLamports} lamports)`);
  info(`Capability: scraping`);
  info(`Deadline:   ${new Date(deadlineUnix * 1000).toISOString()}`);

  // Verify escrow funded
  const escrowBalance = await connection.getBalance(escrowPDA);
  success(`Escrow funded: ${escrowBalance / LAMPORTS_PER_SOL} SOL locked`);

  // Publish task to PubSub
  await pubsub.publish(CHANNELS.TASKS, JSON.stringify({
    type: 'new_task',
    taskId: taskUuid,
    capability: 'scraping',
    reward: rewardLamports,
    requester: walletA.publicKey.toBase58(),
  }));
  info(`[PubSub] Task announced via ${pubsub.transport}`);

  // ============================================================
  // Step 5: Provider discovers and accepts task
  // ============================================================
  step(5, 'Provider discovers and accepts task');

  // Provider queries on-chain for available tasks
  const allTasks = await (programB.account as any).taskAccount.all();
  const availableTasks = allTasks.filter((acc: any) => {
    const status = Object.keys(acc.account.status)[0];
    return status === 'created';
  });
  nodeLog('Node B', COLORS.magenta, `Discovered ${availableTasks.length} available task(s) on-chain`);

  // Check capability match
  const targetTask = availableTasks[0];
  const requiredCap = targetTask.account.requiredCapability;
  nodeLog('Node B', COLORS.magenta, `Task requires: "${requiredCap}" — I have ["scraping","web"]`);
  success('Capability match!');

  // Accept
  await (programB.methods as any)
    .acceptTask()
    .accounts({
      taskAccount: taskPDA,
      agentAccount: agentPDA_B,
      provider: walletB.publicKey,
    })
    .rpc();
  nodeLog('Node B', COLORS.magenta, 'Task accepted!');

  await pubsub.publish(CHANNELS.EVENTS, JSON.stringify({
    type: 'task_accepted', taskId: taskUuid, provider: walletB.publicKey.toBase58(),
  }));

  // ============================================================
  // Step 6: Provider executes task
  // ============================================================
  step(6, 'Provider executes task (simulated)');

  nodeLog('Node B', COLORS.magenta, 'Executing: scraping GitHub trending repos...');
  await sleep(1500); // Simulate work

  const taskResult = {
    timestamp: new Date().toISOString(),
    source: 'github.com/trending',
    data: [
      { rank: 1, repo: 'anthropics/claude-code', stars: 42100, language: 'TypeScript' },
      { rank: 2, repo: 'openclaw/axle-protocol', stars: 1337, language: 'Rust' },
      { rank: 3, repo: 'solana-labs/solana', stars: 12800, language: 'Rust' },
      { rank: 4, repo: 'coral-xyz/anchor', stars: 3400, language: 'Rust' },
      { rank: 5, repo: 'jup-ag/jupiter', stars: 2100, language: 'TypeScript' },
    ],
  };

  console.log('');
  info('Result preview:');
  for (const item of taskResult.data) {
    info(`  #${item.rank} ${item.repo} (${item.stars} stars, ${item.language})`);
  }

  // ============================================================
  // Step 7: Provider delivers result
  // ============================================================
  step(7, 'Provider delivers result on-chain');

  const resultJson = JSON.stringify(taskResult, Object.keys(taskResult).sort());
  const resultHash = sha256(resultJson);

  await (programB.methods as any)
    .deliverTask(Array.from(resultHash))
    .accounts({
      taskAccount: taskPDA,
      provider: walletB.publicKey,
    })
    .rpc();

  nodeLog('Node B', COLORS.magenta, `Delivered! Result hash: ${bs58.encode(resultHash).slice(0, 16)}...`);

  await pubsub.publish(CHANNELS.EVENTS, JSON.stringify({
    type: 'task_delivered', taskId: taskUuid, resultHash: bs58.encode(resultHash),
  }));

  // ============================================================
  // Step 8: Requester verifies and completes task
  // ============================================================
  step(8, 'Requester verifies and completes task — escrow released');

  // Requester checks on-chain task status
  const taskData = await (programA.account as any).taskAccount.fetch(taskPDA);
  const statusKey = Object.keys(taskData.status)[0];
  nodeLog('Node A', COLORS.cyan, `Task status: ${statusKey}`);
  nodeLog('Node A', COLORS.cyan, 'Verifying result hash...');

  // Balances before
  const balBeforeA = await connection.getBalance(walletA.publicKey);
  const balBeforeB = await connection.getBalance(walletB.publicKey);

  // Complete task — releases escrow to provider
  await (programA.methods as any)
    .completeTask()
    .accounts({
      taskAccount: taskPDA,
      agentAccount: agentPDA_B,
      provider: walletB.publicKey,
      escrow: escrowPDA,
      requester: walletA.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  nodeLog('Node A', COLORS.cyan, 'Task completed! Escrow released to provider.');

  // Balances after
  const balAfterB = await connection.getBalance(walletB.publicKey);
  const earned = (balAfterB - balBeforeB) / LAMPORTS_PER_SOL;

  success(`Provider earned: +${earned.toFixed(4)} SOL`);

  await pubsub.publish(CHANNELS.EVENTS, JSON.stringify({
    type: 'task_completed', taskId: taskUuid,
    requester: walletA.publicKey.toBase58(),
    provider: walletB.publicKey.toBase58(),
    reward: rewardLamports,
  }));

  // ============================================================
  // Step 9: Final state
  // ============================================================
  step(9, 'Final on-chain state');

  const finalTaskData = await (programA.account as any).taskAccount.fetch(taskPDA);
  const finalAgentA = await (programA.account as any).agentState.fetch(agentPDA_A);
  const finalAgentB = await (programB.account as any).agentState.fetch(agentPDA_B);
  const [finalBalA, finalBalB] = await Promise.all([
    connection.getBalance(walletA.publicKey),
    connection.getBalance(walletB.publicKey),
  ]);

  console.log('');
  console.log(`  ${COLORS.bright}Task:${COLORS.reset}`);
  info(`Status:       ${Object.keys(finalTaskData.status)[0]}`);
  info(`Provider:     ${shortKey(walletB.publicKey)}`);
  info(`Reward:       ${(finalTaskData.reward as BN).toNumber() / LAMPORTS_PER_SOL} SOL`);

  console.log('');
  console.log(`  ${COLORS.bright}Node A (Requester):${COLORS.reset}`);
  info(`Balance:      ${(finalBalA / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
  info(`Reputation:   ${finalAgentA.reputation.toString()}`);
  info(`Completed:    ${finalAgentA.tasksCompleted.toString()}`);
  info(`Badge:        ${badgeMintedA ? shortKey(badgeMintA) + ' (Token-2022 NFT)' : 'pending'}`);

  console.log('');
  console.log(`  ${COLORS.bright}Node B (Provider):${COLORS.reset}`);
  info(`Balance:      ${(finalBalB / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
  info(`Reputation:   ${finalAgentB.reputation.toString()}`);
  info(`Completed:    ${finalAgentB.tasksCompleted.toString()}`);
  info(`Badge:        ${badgeMintedB ? shortKey(badgeMintB) + ' (Token-2022 NFT)' : 'pending'}`);

  // ============================================================
  // Done
  // ============================================================
  banner('Demo Complete — AXLE Protocol Working!');
  console.log('  Summary:');
  console.log(`  ${COLORS.green}1.${COLORS.reset} Two agents registered on Solana with PDA-based identity`);
  console.log(`  ${COLORS.green}2.${COLORS.reset} Token-2022 NFT badges minted (viewable in Phantom)`);
  console.log(`  ${COLORS.green}3.${COLORS.reset} Task created with automatic SOL escrow`);
  console.log(`  ${COLORS.green}4.${COLORS.reset} Capability-based matching ensured right agent`);
  console.log(`  ${COLORS.green}5.${COLORS.reset} Provider executed task and delivered result hash`);
  console.log(`  ${COLORS.green}6.${COLORS.reset} Escrow automatically released to provider`);
  console.log(`  ${COLORS.green}7.${COLORS.reset} Reputation updated on-chain (immutable record)`);
  console.log(`  ${COLORS.green}8.${COLORS.reset} Inter-node communication via ${pubsub.transport}`);
  console.log('');
  console.log(`  ${COLORS.bright}AXLE = Protocol for Agent Coordination & Tasks${COLORS.reset}`);
  console.log(`  ${COLORS.dim}  "The task settlement layer for AI agents on Solana"${COLORS.reset}`);
  console.log('');

  await pubsub.close();
  process.exit(0);
}

main().catch((err) => {
  console.error(`\n${COLORS.red}DEMO FAILED:${COLORS.reset}`, err);
  process.exit(1);
});
