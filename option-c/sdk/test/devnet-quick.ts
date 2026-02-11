/**
 * Quick Devnet Connection Test
 */
import { Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';

async function main() {
  console.log('=== AXLE Devnet Quick Test ===\n');

  const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
  const programId = new PublicKey('4zr1KP5Rp4xrofrUWFjPqBjJKciNL2s8qXt4eFtc7M82');
  const wallet = new PublicKey('22bFtzYzGtz9rm9wVLK2mXhqjYquKo6h8xM1EyiTzBqN');

  // Check program exists
  const programInfo = await connection.getAccountInfo(programId);
  if (programInfo) {
    console.log('✅ Program found on Devnet');
    console.log(`   Executable: ${programInfo.executable}`);
    console.log(`   Owner: ${programInfo.owner.toBase58()}`);
    console.log(`   Data size: ${programInfo.data.length} bytes`);
  } else {
    console.log('❌ Program NOT found on Devnet');
  }

  // Check wallet balance
  const balance = await connection.getBalance(wallet);
  console.log(`\n💰 Wallet Balance: ${balance / LAMPORTS_PER_SOL} SOL`);

  // Get recent transactions
  const signatures = await connection.getSignaturesForAddress(programId, { limit: 5 });
  console.log(`\n📜 Recent Program Transactions: ${signatures.length}`);
  for (const sig of signatures) {
    const date = new Date(sig.blockTime! * 1000).toISOString();
    console.log(`   ${sig.signature.slice(0, 20)}... (${date})`);
  }

  console.log('\n=== Test Complete ===');
}

main().catch(console.error);
