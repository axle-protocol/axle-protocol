import { NextRequest, NextResponse } from 'next/server';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { Program, AnchorProvider, Wallet } from '@coral-xyz/anchor';
import { validateApiKey } from '@/lib/auth';
import { PROGRAM_ID, RPC_URL } from '@/lib/constants';
import idl from '@/lib/idl/agent_protocol.json';

export async function POST(req: NextRequest) {
  const keyData = validateApiKey(req.headers.get('Authorization'));
  if (!keyData) {
    return NextResponse.json({ error: 'Invalid or missing API key' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { taskPDA: taskPDAStr, keypairSecret } = body;

    if (!taskPDAStr || !keypairSecret) {
      return NextResponse.json(
        { error: 'Missing required fields: taskPDA, keypairSecret' },
        { status: 400 }
      );
    }

    const secretKey = Buffer.from(keypairSecret, 'base64');
    const keypair = Keypair.fromSecretKey(secretKey);

    const connection = new Connection(RPC_URL, 'confirmed');
    const wallet = new Wallet(keypair);
    const provider = new AnchorProvider(connection, wallet, { commitment: 'confirmed' });
    const program = new Program(idl as any, provider);

    const taskPDA = new PublicKey(taskPDAStr);
    const [agentPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from('agent'), keypair.publicKey.toBuffer()],
      PROGRAM_ID
    );

    const txSignature = await (program.methods as any)
      .acceptTask()
      .accounts({
        taskAccount: taskPDA,
        agentAccount: agentPDA,
        provider: keypair.publicKey,
      })
      .rpc();

    return NextResponse.json({
      success: true,
      txSignature,
      twitterHandle: keyData.twitterHandle,
      solscanUrl: `https://solscan.io/tx/${txSignature}?cluster=devnet`,
    });
  } catch (err) {
    const msg = String(err);
    if (msg.includes('CapabilityMismatch')) {
      return NextResponse.json({ error: 'Capability mismatch' }, { status: 400 });
    }
    if (msg.includes('InvalidTaskStatus')) {
      return NextResponse.json({ error: 'Task is not in Created status' }, { status: 400 });
    }
    console.error('Task accept error:', err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
