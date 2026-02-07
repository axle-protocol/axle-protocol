#!/usr/bin/env node
/**
 * AXLE Demo — Provider Node (Terminal 2)
 *
 * Run after requester.ts has created a task.
 * Reads shared task info from .shared/task.json
 *
 * The provider:
 *   1. Registers on-chain
 *   2. Mints Agent Badge
 *   3. Discovers available tasks
 *   4. Accepts the task
 *   5. Executes (simulated scraping)
 *   6. Delivers result hash on-chain
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
import bs58 from 'bs58';
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

import { createPubSub, CHANNELS } from './pubsub.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const idlPath = join(__dirname, '..', '..', 'plugin', 'src', 'idl', 'agent_protocol.json');
const idlJson = JSON.parse(readFileSync(idlPath, 'utf-8'));
const DEPLOYED_PROGRAM_ID = '4zr1KP5Rp4xrofrUWFjPqBjJKciNL2s8qXt4eFtc7M82';
idlJson.address = DEPLOYED_PROGRAM_ID;
const PROGRAM_ID = new PublicKey(DEPLOYED_PROGRAM_ID);

const RPC_URL = process.env.RPC_URL || 'http://127.0.0.1:8899';
const SHARED_DIR = join(__dirname, '..', '.shared');

function sha256(data: string): Uint8Array {
  return new Uint8Array(createHash('sha256').update(data).digest());
}

function getPDA(seed: string, key: Uint8Array): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from(seed), Buffer.from(key)], PROGRAM_ID);
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
  const provider = new AnchorProvider(connection, walletAdapter as any, { commitment: 'confirmed' });
  return new Program(idlJson as unknown as Idl, provider);
}

function log(msg: string): void {
  console.log(`\x1b[35m[Provider]\x1b[0m ${msg}`);
}

async function main() {
  console.log('\n\x1b[1m\x1b[35m=== AXLE Provider Node ===\x1b[0m\n');

  const connection = new Connection(RPC_URL, 'confirmed');
  const wallet = Keypair.generate();
  const program = makeProgram(connection, wallet);
  const pubsub = await createPubSub();

  log(`Wallet: ${wallet.publicKey.toBase58()}`);

  // Airdrop
  log('Requesting airdrop...');
  const sig = await connection.requestAirdrop(wallet.publicKey, 5 * LAMPORTS_PER_SOL);
  await connection.confirmTransaction(sig);
  log('Airdrop received: 5 SOL');

  // Register
  const agentPDA = getPDA('agent', wallet.publicKey.toBuffer());
  await (program.methods as any)
    .registerAgent('scraper-node', JSON.stringify(['scraping', 'web']), new BN(1000))
    .accounts({ agentAccount: agentPDA, authority: wallet.publicKey, systemProgram: SystemProgram.programId })
    .rpc();
  log('Agent registered: capabilities=["scraping","web"]');

  // Mint badge
  const badgeMint = getPDA('badge', wallet.publicKey.toBuffer());
  const tokenAccount = getAssociatedTokenAddressSync(
    badgeMint, wallet.publicKey, false, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
  await (program.methods as any)
    .mintAgentBadge('AXLE Provider', 'AXLE', 'https://axle.openclaw.io/badge/provider')
    .accounts({
      agentAccount: agentPDA, badgeMint, tokenAccount,
      authority: wallet.publicKey, tokenProgram: TOKEN_2022_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
    })
    .rpc();
  log(`Badge minted: ${badgeMint.toBase58().slice(0, 12)}...`);

  // Discover tasks (either from shared file or on-chain scan)
  log('Scanning for available tasks...');

  let taskPDA: PublicKey;
  let taskIdBytes: Uint8Array;
  let escrowPDA: PublicKey;

  const sharedPath = join(SHARED_DIR, 'task.json');
  if (existsSync(sharedPath)) {
    const shared = JSON.parse(readFileSync(sharedPath, 'utf-8'));
    taskIdBytes = new Uint8Array(shared.taskIdBytes);
    taskPDA = new PublicKey(shared.taskPDA);
    escrowPDA = new PublicKey(shared.escrowPDA);
    log(`Found task from shared state: ${shared.taskUuid.slice(0, 8)}...`);
    log(`  Description: "${shared.description}"`);
    log(`  Reward:      ${shared.reward / LAMPORTS_PER_SOL} SOL`);
  } else {
    // Fallback: scan all on-chain tasks
    const allTasks = await (program.account as any).taskAccount.all();
    const available = allTasks.filter((acc: any) => Object.keys(acc.account.status)[0] === 'created');
    if (available.length === 0) {
      log('No available tasks. Run requester.ts first.');
      process.exit(1);
    }
    const target = available[0];
    taskIdBytes = new Uint8Array(target.account.id);
    taskPDA = target.publicKey;
    escrowPDA = getPDA('escrow', taskIdBytes);
    log(`Found task on-chain: ${target.publicKey.toBase58().slice(0, 12)}...`);
  }

  // Accept task
  await (program.methods as any)
    .acceptTask()
    .accounts({ taskAccount: taskPDA, agentAccount: agentPDA, provider: wallet.publicKey })
    .rpc();
  log('Task accepted!');

  // Execute task (simulated)
  log('Executing task: scraping GitHub trending...');
  await new Promise(r => setTimeout(r, 2000));

  const result = {
    timestamp: new Date().toISOString(),
    source: 'github.com/trending',
    data: [
      { rank: 1, repo: 'anthropics/claude-code', stars: 42100 },
      { rank: 2, repo: 'openclaw/axle-protocol', stars: 1337 },
      { rank: 3, repo: 'solana-labs/solana', stars: 12800 },
      { rank: 4, repo: 'coral-xyz/anchor', stars: 3400 },
      { rank: 5, repo: 'jup-ag/jupiter', stars: 2100 },
    ],
  };
  log('Scraping complete! Results:');
  for (const item of result.data) {
    log(`  #${item.rank} ${item.repo} (${item.stars} stars)`);
  }

  // Deliver result
  const resultHash = sha256(JSON.stringify(result, Object.keys(result).sort()));
  await (program.methods as any)
    .deliverTask(Array.from(resultHash))
    .accounts({ taskAccount: taskPDA, provider: wallet.publicKey })
    .rpc();
  log(`Result delivered! Hash: ${bs58.encode(resultHash).slice(0, 16)}...`);

  // Wait for completion
  log('Waiting for requester to verify and complete...');
  while (true) {
    await new Promise(r => setTimeout(r, 2000));
    try {
      const taskData = await (program.account as any).taskAccount.fetch(taskPDA);
      const status = Object.keys(taskData.status)[0];
      if (status === 'completed') {
        log('Task completed by requester!');
        break;
      }
      process.stdout.write('.');
    } catch {
      process.stdout.write('.');
    }
  }

  // Final state
  const finalAgent = await (program.account as any).agentState.fetch(agentPDA);
  const finalBal = await connection.getBalance(wallet.publicKey);
  log(`Final balance: ${(finalBal / LAMPORTS_PER_SOL).toFixed(4)} SOL (earned 0.1 SOL)`);
  log(`Reputation: ${finalAgent.reputation.toString()}`);
  log(`Tasks completed: ${finalAgent.tasksCompleted.toString()}`);

  await pubsub.close();
  log('Done!');
  process.exit(0);
}

main().catch(err => { console.error('Provider failed:', err); process.exit(1); });
