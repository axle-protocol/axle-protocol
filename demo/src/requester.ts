#!/usr/bin/env node
/**
 * AXLE Demo — Requester Node (Terminal 1)
 *
 * Run in one terminal:  npx ts-node src/requester.ts
 * Run in another:       npx ts-node src/provider.ts
 *
 * The requester:
 *   1. Registers on-chain
 *   2. Mints Agent Badge
 *   3. Creates a task with escrow
 *   4. Waits for delivery (polls on-chain)
 *   5. Completes the task (releases escrow)
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
import { writeFileSync, existsSync } from 'fs';

import { createPubSub, CHANNELS } from './pubsub.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

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
  console.log(`\x1b[36m[Requester]\x1b[0m ${msg}`);
}

async function main() {
  console.log('\n\x1b[1m\x1b[36m=== AXLE Requester Node ===\x1b[0m\n');

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
    .registerAgent('requester-node', JSON.stringify(['general']), new BN(0))
    .accounts({ agentAccount: agentPDA, authority: wallet.publicKey, systemProgram: SystemProgram.programId })
    .rpc();
  log('Agent registered on-chain');

  // Mint badge
  const badgeMint = getPDA('badge', wallet.publicKey.toBuffer());
  const tokenAccount = getAssociatedTokenAddressSync(
    badgeMint, wallet.publicKey, false, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
  await (program.methods as any)
    .mintAgentBadge('AXLE Requester', 'AXLE', 'https://axle.openclaw.io/badge/requester')
    .accounts({
      agentAccount: agentPDA, badgeMint, tokenAccount,
      authority: wallet.publicKey, tokenProgram: TOKEN_2022_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
    })
    .rpc();
  log(`Badge minted: ${badgeMint.toBase58().slice(0, 12)}...`);

  // Create task
  const taskUuid = uuidv4();
  const taskIdBytes = sha256(taskUuid);
  const taskPDA = getPDA('task', taskIdBytes);
  const escrowPDA = getPDA('escrow', taskIdBytes);
  const description = 'Scrape the top 10 trending repos from GitHub';
  const descriptionHash = sha256(description);
  const deadline = Math.floor(Date.now() / 1000) + 3600;
  const reward = 0.1 * LAMPORTS_PER_SOL;

  await (program.methods as any)
    .createTask(Array.from(taskIdBytes), Array.from(descriptionHash), 'scraping', new BN(reward), new BN(deadline))
    .accounts({ taskAccount: taskPDA, escrow: escrowPDA, requester: wallet.publicKey, systemProgram: SystemProgram.programId })
    .rpc();
  log(`Task created: ${taskUuid.slice(0, 8)}... (0.1 SOL escrow)`);

  // Write shared state for provider to read
  const { mkdirSync } = await import('fs');
  mkdirSync(SHARED_DIR, { recursive: true });
  writeFileSync(join(SHARED_DIR, 'task.json'), JSON.stringify({
    taskUuid,
    taskIdBytes: Array.from(taskIdBytes),
    taskPDA: taskPDA.toBase58(),
    escrowPDA: escrowPDA.toBase58(),
    requester: wallet.publicKey.toBase58(),
    description,
    reward,
    deadline,
  }));

  // Publish task
  await pubsub.publish(CHANNELS.TASKS, JSON.stringify({
    type: 'new_task', taskId: taskUuid, capability: 'scraping',
    reward, requester: wallet.publicKey.toBase58(),
  }));
  log('Task announced via PubSub');

  // Poll for delivery
  log('Waiting for provider to deliver...');
  while (true) {
    await new Promise(r => setTimeout(r, 2000));
    try {
      const taskData = await (program.account as any).taskAccount.fetch(taskPDA);
      const status = Object.keys(taskData.status)[0];
      if (status === 'delivered') {
        log('Task delivered by provider!');
        break;
      }
      process.stdout.write('.');
    } catch {
      process.stdout.write('.');
    }
  }

  // Complete task
  const taskData = await (program.account as any).taskAccount.fetch(taskPDA);
  const providerKey = taskData.provider as PublicKey;
  const providerAgentPDA = getPDA('agent', providerKey.toBuffer());

  await (program.methods as any)
    .completeTask()
    .accounts({
      taskAccount: taskPDA, agentAccount: providerAgentPDA,
      provider: providerKey, escrow: escrowPDA, requester: wallet.publicKey,
    })
    .rpc();
  log('Task completed! Escrow released to provider.');

  // Final state
  const finalAgent = await (program.account as any).agentState.fetch(agentPDA);
  const finalBal = await connection.getBalance(wallet.publicKey);
  log(`Final balance: ${(finalBal / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
  log(`Reputation: ${finalAgent.reputation.toString()}`);

  await pubsub.close();
  log('Done!');
  process.exit(0);
}

main().catch(err => { console.error('Requester failed:', err); process.exit(1); });
