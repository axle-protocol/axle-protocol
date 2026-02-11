/**
 * Server-side wallet wrapper for Anchor + on-chain registration helper
 */
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  VersionedTransaction,
} from '@solana/web3.js';
import { Program, AnchorProvider, BN } from '@coral-xyz/anchor';
import { PROGRAM_ID, RPC_URL } from './constants';
import idl from './idl/agent_protocol.json';

export class ServerWallet {
  constructor(readonly payer: Keypair) {}

  get publicKey(): PublicKey {
    return this.payer.publicKey;
  }

  async signTransaction<T extends Transaction | VersionedTransaction>(tx: T): Promise<T> {
    if (tx instanceof Transaction) {
      tx.partialSign(this.payer);
    }
    return tx;
  }

  async signAllTransactions<T extends Transaction | VersionedTransaction>(txs: T[]): Promise<T[]> {
    for (const tx of txs) {
      if (tx instanceof Transaction) {
        tx.partialSign(this.payer);
      }
    }
    return txs;
  }
}

// ---------- Server-side agent registration ----------

const SERVER_KEYPAIR_B64 = process.env.SERVER_KEYPAIR;

export async function registerAgentOnChain(opts: {
  walletAddress: string;
  nodeId: string;
  capabilities: string[];
  feeLamports: number;
}): Promise<{ txSignature: string; agentPDA: string } | null> {
  if (!SERVER_KEYPAIR_B64) {
    console.warn('SERVER_KEYPAIR not set — skipping on-chain registration');
    return null;
  }

  try {
    const secretKey = Buffer.from(SERVER_KEYPAIR_B64, 'base64');
    const serverKeypair = Keypair.fromSecretKey(secretKey);
    const agentAuthority = new PublicKey(opts.walletAddress);

    const connection = new Connection(RPC_URL, 'confirmed');
    const wallet = new ServerWallet(serverKeypair);
    const provider = new AnchorProvider(connection, wallet, { commitment: 'confirmed' });
    const program = new Program(idl as any, provider);

    const [agentPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from('agent'), agentAuthority.toBuffer()],
      PROGRAM_ID
    );

    const capsJson = JSON.stringify(opts.capabilities);

    const txSignature = await (program.methods as any)
      .registerAgent(opts.nodeId, capsJson, new BN(opts.feeLamports))
      .accounts({
        agentAccount: agentPDA,
        authority: agentAuthority,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    return {
      txSignature,
      agentPDA: agentPDA.toBase58(),
    };
  } catch (err) {
    console.error('On-chain registration failed:', err);
    return null;
  }
}
