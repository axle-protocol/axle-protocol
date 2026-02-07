import { NextRequest, NextResponse } from 'next/server';
import { Connection, Keypair, PublicKey, SystemProgram } from '@solana/web3.js';
import { Program, AnchorProvider, BN } from '@coral-xyz/anchor';
import { ServerWallet } from '@/lib/server-wallet';
import { createHash, randomBytes } from 'crypto';
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
    const { description, requiredCapability, rewardSol, deadlineUnix, keypairSecret } = body;

    if (!description || !requiredCapability || !rewardSol || !deadlineUnix || !keypairSecret) {
      return NextResponse.json(
        { error: 'Missing required fields: description, requiredCapability, rewardSol, deadlineUnix, keypairSecret' },
        { status: 400 }
      );
    }

    if (deadlineUnix <= Math.floor(Date.now() / 1000)) {
      return NextResponse.json({ error: 'Deadline must be in the future' }, { status: 400 });
    }

    const secretKey = Buffer.from(keypairSecret, 'base64');
    const keypair = Keypair.fromSecretKey(secretKey);

    const connection = new Connection(RPC_URL, 'confirmed');
    const wallet = new ServerWallet(keypair);
    const provider = new AnchorProvider(connection, wallet, { commitment: 'confirmed' });
    const program = new Program(idl as any, provider);

    // Generate task ID and description hash
    const taskIdBytes = createHash('sha256').update(randomBytes(32)).digest();
    const descriptionHash = createHash('sha256').update(description).digest();

    const [taskPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from('task'), taskIdBytes],
      PROGRAM_ID
    );
    const [escrowPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from('escrow'), taskIdBytes],
      PROGRAM_ID
    );

    const rewardLamports = new BN(Math.round(rewardSol * 1e9));
    const deadline = new BN(deadlineUnix);

    const txSignature = await (program.methods as any)
      .createTask(
        Array.from(taskIdBytes),
        Array.from(descriptionHash),
        requiredCapability,
        rewardLamports,
        deadline
      )
      .accounts({
        taskAccount: taskPDA,
        escrow: escrowPDA,
        requester: keypair.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    return NextResponse.json({
      success: true,
      txSignature,
      taskPDA: taskPDA.toBase58(),
      escrowPDA: escrowPDA.toBase58(),
      twitterHandle: keyData.twitterHandle,
      solscanUrl: `https://solscan.io/tx/${txSignature}?cluster=devnet`,
    });
  } catch (err) {
    console.error('Task creation error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
