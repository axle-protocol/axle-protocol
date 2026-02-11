import { NextRequest, NextResponse } from 'next/server';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { Program, AnchorProvider } from '@coral-xyz/anchor';
import { ServerWallet } from '@/lib/server-wallet';
import { createHash } from 'crypto';
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
    const { taskPDA: taskPDAStr, resultData, keypairSecret } = body;

    if (!taskPDAStr || !resultData || !keypairSecret) {
      return NextResponse.json(
        { error: 'Missing required fields: taskPDA, resultData, keypairSecret' },
        { status: 400 }
      );
    }

    const secretKey = Buffer.from(keypairSecret, 'base64');
    const keypair = Keypair.fromSecretKey(secretKey);

    const connection = new Connection(RPC_URL, 'confirmed');
    const wallet = new ServerWallet(keypair);
    const provider = new AnchorProvider(connection, wallet, { commitment: 'confirmed' });
    const program = new Program(idl as any, provider);

    const taskPDA = new PublicKey(taskPDAStr);
    const [agentPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from('agent'), keypair.publicKey.toBuffer()],
      PROGRAM_ID
    );

    // Fetch task to get escrow PDA + requester
    const taskAccount = await (program.account as any).taskAccount.fetch(taskPDA);
    const taskIdBytes = Buffer.from(taskAccount.id as number[]);
    const [escrowPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from('escrow'), taskIdBytes],
      PROGRAM_ID
    );

    const resultHash = Array.from(createHash('sha256').update(resultData).digest());

    const txSignature = await (program.methods as any)
      .completeTask(resultHash)
      .accounts({
        taskAccount: taskPDA,
        agentAccount: agentPDA,
        escrow: escrowPDA,
        provider: keypair.publicKey,
        requester: taskAccount.requester,
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
    if (msg.includes('InvalidTaskStatus')) {
      return NextResponse.json({ error: 'Task is not in deliverable status' }, { status: 400 });
    }
    console.error('Task complete error:', err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
