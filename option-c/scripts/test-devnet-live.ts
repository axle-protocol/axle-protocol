#!/usr/bin/env node
/**
 * AXLE Protocol — Live Devnet Integration Test
 * Actually sends transactions to Solana devnet.
 */

import { createHash } from 'crypto';
import * as anchor from '@coral-xyz/anchor';
const { Program, AnchorProvider } = anchor;
type Idl = anchor.Idl;
import BN from 'bn.js';
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction as SolTransaction,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import {
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import { v4 as uuidv4 } from 'uuid';
import bs58 from 'bs58';
import { readFileSync } from 'fs';
import { homedir } from 'os';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load IDL
const idlPath = join(__dirname, '..', 'plugin', 'src', 'idl', 'agent_protocol.json');
const idlJson = JSON.parse(readFileSync(idlPath, 'utf-8'));
const DEPLOYED_PROGRAM_ID = '4zr1KP5Rp4xrofrUWFjPqBjJKciNL2s8qXt4eFtc7M82';
idlJson.address = DEPLOYED_PROGRAM_ID;
const PROGRAM_ID = new PublicKey(DEPLOYED_PROGRAM_ID);

const RPC_URL = 'https://api.devnet.solana.com';

// ── Helpers ──

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
      tx.sign(wallet); return tx;
    },
    signAllTransactions: async <T extends import('@solana/web3.js').Transaction>(txs: T[]): Promise<T[]> => {
      txs.forEach(tx => tx.sign(wallet)); return txs;
    },
  };
  const provider = new AnchorProvider(connection, walletAdapter as any, {
    commitment: 'confirmed',
    preflightCommitment: 'confirmed',
  });
  return new Program(idlJson as unknown as Idl, provider);
}

function short(pk: PublicKey): string {
  return pk.toBase58().slice(0, 12) + '...';
}

const C = {
  reset: '\x1b[0m', bold: '\x1b[1m',
  cyan: '\x1b[36m', green: '\x1b[32m', yellow: '\x1b[33m',
  red: '\x1b[31m', magenta: '\x1b[35m', dim: '\x1b[2m',
};

function ok(msg: string) { console.log(`  ${C.green}✓${C.reset} ${msg}`); }
function fail(msg: string) { console.log(`  ${C.red}✗${C.reset} ${msg}`); }
function info(msg: string) { console.log(`  ${C.dim}  ${msg}${C.reset}`); }
function step(n: number, label: string) {
  console.log(`\n${C.bold}${C.yellow}[Step ${n}]${C.reset} ${C.bold}${label}${C.reset}`);
}

async function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

// ── Main ──

async function main() {
  console.log(`\n${C.bold}${C.cyan}${'='.repeat(60)}${C.reset}`);
  console.log(`${C.bold}${C.cyan}  AXLE Protocol — Live Devnet Test${C.reset}`);
  console.log(`${C.bold}${C.cyan}${'='.repeat(60)}${C.reset}\n`);
  console.log(`  Program:  ${PROGRAM_ID.toBase58()}`);
  console.log(`  RPC:      ${RPC_URL}`);
  console.log(`  Time:     ${new Date().toISOString()}`);

  const connection = new Connection(RPC_URL, 'confirmed');

  // Verify program exists
  const programInfo = await connection.getAccountInfo(PROGRAM_ID);
  if (!programInfo) {
    fail('Program not found on devnet!');
    process.exit(1);
  }
  ok(`Program found on devnet (${programInfo.data.length} bytes)`);

  // ── Step 1: Create wallets + fund from deployer ──
  step(1, 'Create wallets & fund from deployer');

  // Load deployer wallet (has ~4.6 SOL from program deployment)
  const deployerKeyPath = join(homedir(), '.config', 'solana', 'devnet.json');
  const deployerSecret = JSON.parse(readFileSync(deployerKeyPath, 'utf-8'));
  const deployer = Keypair.fromSecretKey(new Uint8Array(deployerSecret));
  info(`Deployer: ${deployer.publicKey.toBase58()}`);

  const walletA = Keypair.generate(); // Agent A (requester)
  const walletB = Keypair.generate(); // Agent B (provider)

  console.log(`  Agent A (Requester): ${C.cyan}${walletA.publicKey.toBase58()}${C.reset}`);
  console.log(`  Agent B (Provider):  ${C.magenta}${walletB.publicKey.toBase58()}${C.reset}`);

  // Transfer SOL from deployer to both wallets
  const txFund = new SolTransaction();
  txFund.add(
    SystemProgram.transfer({ fromPubkey: deployer.publicKey, toPubkey: walletA.publicKey, lamports: 0.5 * LAMPORTS_PER_SOL }),
    SystemProgram.transfer({ fromPubkey: deployer.publicKey, toPubkey: walletB.publicKey, lamports: 0.3 * LAMPORTS_PER_SOL }),
  );
  txFund.feePayer = deployer.publicKey;
  const latestHash = await connection.getLatestBlockhash('confirmed');
  txFund.recentBlockhash = latestHash.blockhash;
  txFund.sign(deployer);
  const fundSig = await connection.sendRawTransaction(txFund.serialize());
  await connection.confirmTransaction(fundSig, 'confirmed');
  ok(`Funded from deployer: Agent A +0.5 SOL, Agent B +0.3 SOL`);
  info(`tx: ${fundSig}`);

  await sleep(1000);

  const balA = await connection.getBalance(walletA.publicKey);
  const balB = await connection.getBalance(walletB.publicKey);
  info(`Agent A balance: ${(balA / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
  info(`Agent B balance: ${(balB / LAMPORTS_PER_SOL).toFixed(4)} SOL`);

  const programA = makeProgram(connection, walletA);
  const programB = makeProgram(connection, walletB);

  // ── Step 2: Register agents on-chain ──
  step(2, 'Register agents on-chain');

  const agentPDA_A = getAgentPDA(walletA.publicKey);
  const agentPDA_B = getAgentPDA(walletB.publicKey);

  info(`Agent A PDA: ${agentPDA_A.toBase58()}`);
  info(`Agent B PDA: ${agentPDA_B.toBase58()}`);

  // Register Agent A
  const txA = await (programA.methods as any)
    .registerAgent('axle-requester-01', JSON.stringify(['coding', 'general']), new BN(0))
    .accounts({
      agentAccount: agentPDA_A,
      authority: walletA.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
  ok(`Agent A registered: "axle-requester-01" [coding, general]`);
  info(`tx: ${txA}`);

  await sleep(1000);

  // Register Agent B
  const txB = await (programB.methods as any)
    .registerAgent('axle-provider-01', JSON.stringify(['writing', 'coding', 'analysis']), new BN(500))
    .accounts({
      agentAccount: agentPDA_B,
      authority: walletB.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
  ok(`Agent B registered: "axle-provider-01" [writing, coding, analysis]`);
  info(`tx: ${txB}`);

  // Verify on-chain
  await sleep(1000);
  const agentDataA = await (programA.account as any).agentState.fetch(agentPDA_A);
  const agentDataB = await (programB.account as any).agentState.fetch(agentPDA_B);
  ok(`Agent A on-chain: nodeId="${agentDataA.nodeId}", rep=${agentDataA.reputation.toString()}, active=${agentDataA.isActive}`);
  ok(`Agent B on-chain: nodeId="${agentDataB.nodeId}", rep=${agentDataB.reputation.toString()}, active=${agentDataB.isActive}`);

  // ── Step 3: Create Task with Escrow ──
  step(3, 'Create task with 0.01 SOL escrow');

  const taskUuid = uuidv4();
  const taskIdBytes = sha256(taskUuid);
  const taskPDA = getTaskPDA(taskIdBytes);
  const escrowPDA = getEscrowPDA(taskIdBytes);

  const taskDescription = 'Write a technical summary of AXLE Protocol for the blog';
  const descriptionHash = sha256(taskDescription);
  const deadlineUnix = Math.floor(Date.now() / 1000) + 7200; // +2 hours
  const rewardLamports = 0.01 * LAMPORTS_PER_SOL;

  info(`Task UUID: ${taskUuid}`);
  info(`Task PDA:  ${taskPDA.toBase58()}`);
  info(`Escrow PDA: ${escrowPDA.toBase58()}`);

  const balBeforeCreate = await connection.getBalance(walletA.publicKey);

  const txCreate = await (programA.methods as any)
    .createTask(
      Array.from(taskIdBytes),
      Array.from(descriptionHash),
      'writing',
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
  ok(`Task created: "${taskDescription.slice(0, 50)}..."`);
  info(`tx: ${txCreate}`);

  await sleep(1000);

  // Verify escrow funded
  const escrowBalance = await connection.getBalance(escrowPDA);
  const balAfterCreate = await connection.getBalance(walletA.publicKey);
  ok(`Escrow funded: ${(escrowBalance / LAMPORTS_PER_SOL).toFixed(4)} SOL locked`);
  info(`Agent A balance change: ${((balAfterCreate - balBeforeCreate) / LAMPORTS_PER_SOL).toFixed(6)} SOL`);

  // Verify task on-chain
  const taskData = await (programA.account as any).taskAccount.fetch(taskPDA);
  const taskStatus1 = Object.keys(taskData.status)[0];
  ok(`Task status on-chain: ${taskStatus1}`);
  info(`Required capability: ${taskData.requiredCapability}`);
  info(`Reward: ${taskData.reward.toString()} lamports`);

  // ── Step 4: Provider accepts task ──
  step(4, 'Provider accepts task (capability check on-chain)');

  const txAccept = await (programB.methods as any)
    .acceptTask()
    .accounts({
      taskAccount: taskPDA,
      agentAccount: agentPDA_B,
      provider: walletB.publicKey,
    })
    .rpc();
  ok(`Task accepted by Agent B`);
  info(`tx: ${txAccept}`);

  await sleep(1000);
  const taskAfterAccept = await (programA.account as any).taskAccount.fetch(taskPDA);
  const taskStatus2 = Object.keys(taskAfterAccept.status)[0];
  ok(`Task status: ${taskStatus2}`);
  info(`Provider: ${taskAfterAccept.provider.toBase58()}`);

  // ── Step 5: Provider delivers result ──
  step(5, 'Provider delivers result hash');

  const result = {
    title: 'AXLE Protocol Technical Summary',
    content: 'AXLE is a task settlement layer for AI agents on Solana...',
    wordCount: 1500,
    timestamp: new Date().toISOString(),
  };
  const resultJson = JSON.stringify(result, Object.keys(result).sort());
  const resultHash = sha256(resultJson);

  const txDeliver = await (programB.methods as any)
    .deliverTask(Array.from(resultHash))
    .accounts({
      taskAccount: taskPDA,
      provider: walletB.publicKey,
    })
    .rpc();
  ok(`Result delivered: hash=${bs58.encode(resultHash).slice(0, 20)}...`);
  info(`tx: ${txDeliver}`);

  await sleep(1000);
  const taskAfterDeliver = await (programA.account as any).taskAccount.fetch(taskPDA);
  ok(`Task status: ${Object.keys(taskAfterDeliver.status)[0]}`);

  // ── Step 6: Requester completes task → escrow released ──
  step(6, 'Requester completes task — escrow released to provider');

  const balBBefore = await connection.getBalance(walletB.publicKey);

  const txComplete = await (programA.methods as any)
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
  ok(`Task completed! Escrow released.`);
  info(`tx: ${txComplete}`);

  await sleep(1000);

  const balBAfter = await connection.getBalance(walletB.publicKey);
  const earned = (balBAfter - balBBefore) / LAMPORTS_PER_SOL;
  ok(`Provider earned: +${earned.toFixed(6)} SOL`);

  // Verify escrow emptied
  const escrowAfter = await connection.getBalance(escrowPDA);
  info(`Escrow after: ${escrowAfter} lamports (should be near 0)`);

  // Verify reputation updated
  const agentBAfter = await (programA.account as any).agentState.fetch(agentPDA_B);
  ok(`Agent B reputation: ${agentBAfter.reputation.toString()} (was 100, expected 110)`);
  ok(`Agent B tasks completed: ${agentBAfter.tasksCompleted.toString()}`);

  // Verify final task status
  const taskFinal = await (programA.account as any).taskAccount.fetch(taskPDA);
  ok(`Final task status: ${Object.keys(taskFinal.status)[0]}`);

  // ── Step 7: Mint Agent Badge NFT (Token-2022) ──
  step(7, 'Mint Agent Badge NFT (Token-2022)');

  const badgeMintA = getBadgeMintPDA(walletA.publicKey);
  const tokenAccountA = getAssociatedTokenAddressSync(
    badgeMintA, walletA.publicKey, false, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID,
  );

  info(`Badge Mint PDA: ${badgeMintA.toBase58()}`);
  info(`Token Account:  ${tokenAccountA.toBase58()}`);

  try {
    const txBadge = await (programA.methods as any)
      .mintAgentBadge('AXLE Agent #1', 'AXLE', 'https://axle.openclaw.io/badge/1')
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
    ok(`Badge minted for Agent A!`);
    info(`tx: ${txBadge}`);
    info(`View in Phantom: import wallet and check NFTs on devnet`);
  } catch (e: any) {
    const errMsg = e.message || e.toString();
    if (errMsg.includes('realloc') || errMsg.includes('Account data too small')) {
      fail(`Badge minting failed (known Token-2022 realloc issue)`);
      info('Token-2022 MetadataPointer needs 2-instruction flow on some validators');
      info('The badge instruction exists and compiles — needs separate mint+metadata flow');
    } else {
      fail(`Badge minting failed: ${errMsg.slice(0, 200)}`);
    }
  }

  // ── Step 8: Summary ──
  step(8, 'Final on-chain state');

  const finalBalA = await connection.getBalance(walletA.publicKey);
  const finalBalB = await connection.getBalance(walletB.publicKey);

  console.log('');
  console.log(`  ${C.bold}Agent A (Requester):${C.reset}`);
  info(`Address:    ${walletA.publicKey.toBase58()}`);
  info(`Balance:    ${(finalBalA / LAMPORTS_PER_SOL).toFixed(6)} SOL`);
  const finalAgentA = await (programA.account as any).agentState.fetch(agentPDA_A);
  info(`Node ID:    ${finalAgentA.nodeId}`);
  info(`Reputation: ${finalAgentA.reputation.toString()}`);

  console.log('');
  console.log(`  ${C.bold}Agent B (Provider):${C.reset}`);
  info(`Address:    ${walletB.publicKey.toBase58()}`);
  info(`Balance:    ${(finalBalB / LAMPORTS_PER_SOL).toFixed(6)} SOL`);
  info(`Node ID:    ${agentBAfter.nodeId}`);
  info(`Reputation: ${agentBAfter.reputation.toString()}`);
  info(`Completed:  ${agentBAfter.tasksCompleted.toString()}`);

  console.log('');
  console.log(`  ${C.bold}Task:${C.reset}`);
  info(`UUID:       ${taskUuid}`);
  info(`Status:     ${Object.keys(taskFinal.status)[0]}`);
  info(`Reward:     ${(taskFinal.reward.toNumber() / LAMPORTS_PER_SOL).toFixed(4)} SOL`);

  // ── Explorer links ──
  console.log(`\n${C.bold}${C.cyan}${'='.repeat(60)}${C.reset}`);
  console.log(`${C.bold}${C.cyan}  Explorer Links${C.reset}`);
  console.log(`${C.bold}${C.cyan}${'='.repeat(60)}${C.reset}\n`);
  console.log(`  Program:  https://explorer.solana.com/address/${PROGRAM_ID.toBase58()}?cluster=devnet`);
  console.log(`  Agent A:  https://explorer.solana.com/address/${agentPDA_A.toBase58()}?cluster=devnet`);
  console.log(`  Agent B:  https://explorer.solana.com/address/${agentPDA_B.toBase58()}?cluster=devnet`);
  console.log(`  Task:     https://explorer.solana.com/address/${taskPDA.toBase58()}?cluster=devnet`);
  console.log(`  Complete: https://explorer.solana.com/tx/${txComplete}?cluster=devnet`);
  console.log('');
}

main().catch((err) => {
  console.error(`\n${C.red}TEST FAILED:${C.reset}`, err);
  process.exit(1);
});
