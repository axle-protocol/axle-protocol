import { NextRequest, NextResponse } from 'next/server';
import { Connection, Keypair, PublicKey, SystemProgram } from '@solana/web3.js';
import { Program, AnchorProvider, BN } from '@coral-xyz/anchor';
import { ServerWallet } from '@/lib/server-wallet';
import { validateApiKey } from '@/lib/auth';
import { PROGRAM_ID, RPC_URL } from '@/lib/constants';
import idl from '@/lib/idl/agent_protocol.json';

export async function POST(req: NextRequest) {
  // Verify API key
  const keyData = validateApiKey(req.headers.get('Authorization'));
  if (!keyData) {
    return NextResponse.json({ error: 'Invalid or missing API key' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { nodeId, capabilities, feePerTask, keypairSecret } = body;

    if (!nodeId || !capabilities || feePerTask === undefined || !keypairSecret) {
      return NextResponse.json(
        { error: 'Missing required fields: nodeId, capabilities, feePerTask, keypairSecret' },
        { status: 400 }
      );
    }

    // Reconstruct keypair from secret
    const secretKey = Buffer.from(keypairSecret, 'base64');
    const keypair = Keypair.fromSecretKey(secretKey);

    // Create connection and program
    const connection = new Connection(RPC_URL, 'confirmed');
    const wallet = new ServerWallet(keypair);
    const provider = new AnchorProvider(connection, wallet, { commitment: 'confirmed' });
    const program = new Program(idl as any, provider);

    // Derive PDA
    const [agentPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from('agent'), keypair.publicKey.toBuffer()],
      PROGRAM_ID
    );

    const capsJson = Array.isArray(capabilities) ? JSON.stringify(capabilities) : capabilities;

    const txSignature = await (program.methods as any)
      .registerAgent(nodeId, capsJson, new BN(feePerTask))
      .accounts({
        agentAccount: agentPDA,
        authority: keypair.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    return NextResponse.json({
      success: true,
      txSignature,
      agentPDA: agentPDA.toBase58(),
      authority: keypair.publicKey.toBase58(),
      twitterHandle: keyData.twitterHandle,
      solscanUrl: `https://solscan.io/tx/${txSignature}?cluster=devnet`,
    });
  } catch (err) {
    const msg = String(err);
    if (msg.includes('already in use')) {
      return NextResponse.json({ error: 'Agent already registered' }, { status: 409 });
    }
    if (msg.includes('insufficient funds')) {
      return NextResponse.json({ error: 'Insufficient SOL balance' }, { status: 400 });
    }
    console.error('Agent registration error:', err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
