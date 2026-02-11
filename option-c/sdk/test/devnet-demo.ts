/**
 * AXLE Protocol — Devnet Demo Script
 * Creates real on-chain transactions for hackathon demo
 * 
 * Usage: npx tsx test/devnet-demo.ts
 */

import { AxleSDK, TaskStatus } from '../src/index.js';
import { Keypair, LAMPORTS_PER_SOL } from '@solana/web3.js';
import * as fs from 'fs';
import * as path from 'path';

// Wallet secret key from .env.local
const SECRET_KEY = [142,124,243,253,191,35,42,46,212,130,22,255,55,202,94,153,17,228,51,246,12,235,157,77,201,29,96,61,96,5,48,141,46,44,142,143,61,227,229,33,233,108,197,85,88,188,228,70,175,238,228,248,104,140,171,185,204,5,224,18,25,251,165,240];

async function main() {
  console.log('=== AXLE Protocol Devnet Demo ===\n');

  // Load wallet from secret key
  const walletKeypair = Keypair.fromSecretKey(Uint8Array.from(SECRET_KEY));
  console.log(`Wallet: ${walletKeypair.publicKey.toBase58()}`);

  // Initialize SDK for devnet
  const sdk = new AxleSDK({ 
    cluster: 'devnet',
    wallet: walletKeypair 
  });

  // Check balance
  const balance = await sdk.getBalance();
  console.log(`Balance: ${balance / LAMPORTS_PER_SOL} SOL\n`);

  if (balance < 0.1 * LAMPORTS_PER_SOL) {
    console.error('Insufficient balance. Need at least 0.1 SOL');
    process.exit(1);
  }

  // ── Step 1: Register Agent ──
  console.log('[Step 1] Registering AXLE-Assistant agent...');
  try {
    const agent = await sdk.registerAgent({
      nodeId: 'AXLE-Assistant',
      capabilities: ['code-review', 'writing', 'research', 'general'],
      feePerTask: 1000, // 0.000001 SOL
    });
    console.log(`✅ Agent registered!`);
    console.log(`   Node ID: ${agent.nodeId}`);
    console.log(`   Reputation: ${agent.reputation}`);
    console.log(`   Capabilities: ${agent.capabilities.join(', ')}`);
  } catch (e: any) {
    if (e.message?.includes('already in use')) {
      console.log('ℹ️  Agent already registered');
    } else {
      console.error('Registration error:', e.message);
    }
  }

  // ── Step 2: Create Task ──
  console.log('\n[Step 2] Creating a demo task...');
  try {
    const task = await sdk.createTask({
      description: 'Write a short summary of AXLE Protocol features',
      capability: 'writing',
      reward: 10000, // 0.00001 SOL
      deadline: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
    });
    console.log(`✅ Task created!`);
    console.log(`   Task ID: ${task.taskId}`);
    console.log(`   Capability: ${task.capability}`);
    console.log(`   Reward: ${task.reward} lamports`);
    console.log(`   Status: ${TaskStatus[task.status]}`);

    // ── Step 3: Accept Task (as same wallet for demo) ──
    console.log('\n[Step 3] Accepting task...');
    const accepted = await sdk.acceptTask(task.taskId);
    console.log(`✅ Task accepted!`);
    console.log(`   Provider: ${accepted.provider?.toBase58()}`);
    console.log(`   Status: ${TaskStatus[accepted.status]}`);

    // ── Step 4: Complete Task ──
    console.log('\n[Step 4] Completing task...');
    const completed = await sdk.completeTask(task.taskId);
    console.log(`✅ Task completed!`);
    console.log(`   Status: ${TaskStatus[completed.status]}`);

    // ── Step 5: Verify Task ──
    console.log('\n[Step 5] Verifying task (requester confirms)...');
    const verified = await sdk.verifyTask(task.taskId, 5); // 5 star rating
    console.log(`✅ Task verified!`);
    console.log(`   Final Status: ${TaskStatus[verified.status]}`);

    console.log('\n=== Demo Complete! ===');
    console.log('Check transactions on Solscan:');
    console.log(`https://solscan.io/account/${walletKeypair.publicKey.toBase58()}?cluster=devnet`);

  } catch (e: any) {
    console.error('Task error:', e.message);
  }
}

main().catch(console.error);
