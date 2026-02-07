/**
 * Browser-compatible Anchor client for AXLE Protocol
 */
import { Program, AnchorProvider, BN } from '@coral-xyz/anchor';
import { Connection, PublicKey, SystemProgram, LAMPORTS_PER_SOL } from '@solana/web3.js';
import type { AnchorWallet } from '@solana/wallet-adapter-react';
import idl from './idl/agent_protocol.json';
import { PROGRAM_ID, RPC_URL } from './constants';

// ---------- PDA Helpers ----------

export function getAgentPDA(authority: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('agent'), authority.toBuffer()],
    PROGRAM_ID
  );
}

export function getTaskPDA(taskId: Uint8Array): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('task'), taskId],
    PROGRAM_ID
  );
}

export function getEscrowPDA(taskId: Uint8Array): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('escrow'), taskId],
    PROGRAM_ID
  );
}

// ---------- SHA-256 (Web Crypto) ----------

export async function sha256(input: string): Promise<Uint8Array> {
  const encoded = new TextEncoder().encode(input);
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoded);
  return new Uint8Array(hashBuffer);
}

// ---------- Program Factory ----------

export function createProgram(wallet: AnchorWallet) {
  const connection = new Connection(RPC_URL, 'confirmed');
  const provider = new AnchorProvider(connection, wallet, {
    commitment: 'confirmed',
  });
  return new Program(idl as any, provider);
}

// ---------- Instructions ----------

export async function registerAgent(
  wallet: AnchorWallet,
  nodeId: string,
  capabilities: string[],
  feePerTask: number
): Promise<string> {
  const program = createProgram(wallet);
  const [agentPDA] = getAgentPDA(wallet.publicKey);

  const tx = await (program.methods as any)
    .registerAgent(nodeId, JSON.stringify(capabilities), new BN(feePerTask))
    .accounts({
      agentAccount: agentPDA,
      authority: wallet.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  return tx;
}

export async function createTask(
  wallet: AnchorWallet,
  description: string,
  requiredCapability: string,
  rewardSol: number,
  deadlineDate: Date
): Promise<{ tx: string; taskPDA: string }> {
  const program = createProgram(wallet);

  // Generate unique task ID from random bytes
  const randomBytes = crypto.getRandomValues(new Uint8Array(32));
  const taskIdBytes = await sha256(
    Array.from(randomBytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
  );
  const descriptionHash = await sha256(description);

  const [taskPDA] = getTaskPDA(taskIdBytes);
  const [escrowPDA] = getEscrowPDA(taskIdBytes);

  const rewardLamports = new BN(Math.round(rewardSol * LAMPORTS_PER_SOL));
  const deadline = new BN(Math.floor(deadlineDate.getTime() / 1000));

  const tx = await (program.methods as any)
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
      requester: wallet.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  return { tx, taskPDA: taskPDA.toBase58() };
}

export async function acceptTask(
  wallet: AnchorWallet,
  taskPDA: PublicKey
): Promise<string> {
  const program = createProgram(wallet);
  const [agentPDA] = getAgentPDA(wallet.publicKey);

  const tx = await (program.methods as any)
    .acceptTask()
    .accounts({
      taskAccount: taskPDA,
      agentAccount: agentPDA,
      provider: wallet.publicKey,
    })
    .rpc();

  return tx;
}

export async function deliverTask(
  wallet: AnchorWallet,
  taskPDA: PublicKey,
  resultText: string
): Promise<string> {
  const program = createProgram(wallet);
  const resultHash = await sha256(resultText);

  const tx = await (program.methods as any)
    .deliverTask(Array.from(resultHash))
    .accounts({
      taskAccount: taskPDA,
      provider: wallet.publicKey,
    })
    .rpc();

  return tx;
}

export async function completeTask(
  wallet: AnchorWallet,
  taskPDA: PublicKey,
  providerPubkey: PublicKey,
  taskIdBytes: Uint8Array
): Promise<string> {
  const program = createProgram(wallet);
  const [agentPDA] = getAgentPDA(providerPubkey);
  const [escrowPDA] = getEscrowPDA(taskIdBytes);

  const tx = await (program.methods as any)
    .completeTask()
    .accounts({
      taskAccount: taskPDA,
      agentAccount: agentPDA,
      provider: providerPubkey,
      escrow: escrowPDA,
      requester: wallet.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  return tx;
}

export async function cancelTask(
  wallet: AnchorWallet,
  taskPDA: PublicKey,
  taskIdBytes: Uint8Array
): Promise<string> {
  const program = createProgram(wallet);
  const [escrowPDA] = getEscrowPDA(taskIdBytes);

  const tx = await (program.methods as any)
    .cancelTask()
    .accounts({
      taskAccount: taskPDA,
      escrow: escrowPDA,
      requester: wallet.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  return tx;
}

export function getBadgeMintPDA(authority: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('badge'), authority.toBuffer()],
    PROGRAM_ID
  );
}

const TOKEN_2022_PROGRAM_ID = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');

function getAssociatedTokenAddressSync(
  mint: PublicKey,
  owner: PublicKey,
  tokenProgramId: PublicKey
): PublicKey {
  const [address] = PublicKey.findProgramAddressSync(
    [owner.toBuffer(), tokenProgramId.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID
  );
  return address;
}

export async function mintAgentBadge(
  wallet: AnchorWallet,
  name: string,
  symbol: string,
  uri: string
): Promise<string> {
  const program = createProgram(wallet);
  const [agentPDA] = getAgentPDA(wallet.publicKey);
  const [badgeMint] = getBadgeMintPDA(wallet.publicKey);
  const tokenAccount = getAssociatedTokenAddressSync(
    badgeMint,
    wallet.publicKey,
    TOKEN_2022_PROGRAM_ID
  );

  const tx = await (program.methods as any)
    .mintAgentBadge(name, symbol, uri)
    .accounts({
      agentAccount: agentPDA,
      badgeMint,
      tokenAccount,
      authority: wallet.publicKey,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  return tx;
}

export async function fetchTaskByPDA(
  wallet: AnchorWallet,
  taskPDA: PublicKey
): Promise<TaskInfo | null> {
  const program = createProgram(wallet);

  try {
    const d = await (program.account as any).taskAccount.fetch(taskPDA);
    const isDefaultProvider =
      d.provider.toBase58() === '11111111111111111111111111111111';

    return {
      pda: taskPDA.toBase58(),
      id: Array.from(d.id as Uint8Array),
      requester: d.requester.toBase58(),
      provider: isDefaultProvider ? '' : d.provider.toBase58(),
      requiredCapability: d.requiredCapability,
      reward: d.reward.toNumber() / LAMPORTS_PER_SOL,
      deadline: new Date(d.deadline.toNumber() * 1000),
      status: parseStatus(d.status),
      createdAt: new Date(d.createdAt.toNumber() * 1000),
      resultHash: Array.from(d.resultHash as Uint8Array),
      acceptedAt: d.acceptedAt ? new Date(d.acceptedAt.toNumber() * 1000) : null,
      deliveredAt: d.deliveredAt ? new Date(d.deliveredAt.toNumber() * 1000) : null,
      completedAt: d.completedAt ? new Date(d.completedAt.toNumber() * 1000) : null,
    };
  } catch {
    return null;
  }
}

// ---------- Data Fetchers ----------

export interface AgentInfo {
  pda: string;
  authority: string;
  nodeId: string;
  capabilities: string[];
  feePerTask: number;
  reputation: number;
  isActive: boolean;
  tasksCompleted: number;
  tasksFailed: number;
  registeredAt: Date;
}

export interface TaskInfo {
  pda: string;
  id: number[];
  requester: string;
  provider: string;
  requiredCapability: string;
  reward: number;
  deadline: Date;
  status: string;
  createdAt: Date;
  resultHash: number[];
  acceptedAt: Date | null;
  deliveredAt: Date | null;
  completedAt: Date | null;
}

const STATUS_MAP: Record<string, string> = {
  created: 'Created',
  accepted: 'Accepted',
  delivered: 'Delivered',
  completed: 'Completed',
  disputed: 'Disputed',
  cancelled: 'Cancelled',
  timedOut: 'TimedOut',
};

function parseStatus(statusObj: any): string {
  if (!statusObj) return 'Unknown';
  const key = Object.keys(statusObj)[0];
  return STATUS_MAP[key] || key || 'Unknown';
}

export async function fetchAgents(wallet: AnchorWallet): Promise<AgentInfo[]> {
  const program = createProgram(wallet);

  try {
    const accounts = await (program.account as any).agentState.all();
    return accounts.map((acc: any) => {
      const d = acc.account;
      let capabilities: string[];
      try {
        capabilities = JSON.parse(d.capabilities);
        if (!Array.isArray(capabilities)) capabilities = [d.capabilities];
      } catch {
        capabilities = [d.capabilities];
      }

      return {
        pda: acc.publicKey.toBase58(),
        authority: d.authority.toBase58(),
        nodeId: d.nodeId,
        capabilities,
        feePerTask: d.feePerTask.toNumber(),
        reputation: d.reputation.toNumber(),
        isActive: d.isActive,
        tasksCompleted: d.tasksCompleted.toNumber(),
        tasksFailed: d.tasksFailed.toNumber(),
        registeredAt: new Date(d.registeredAt.toNumber() * 1000),
      };
    });
  } catch {
    return [];
  }
}

export async function fetchTasks(wallet: AnchorWallet): Promise<TaskInfo[]> {
  const program = createProgram(wallet);

  try {
    const accounts = await (program.account as any).taskAccount.all();
    return accounts.map((acc: any) => {
      const d = acc.account;
      const isDefaultProvider =
        d.provider.toBase58() === '11111111111111111111111111111111';

      return {
        pda: acc.publicKey.toBase58(),
        id: Array.from(d.id as Uint8Array),
        requester: d.requester.toBase58(),
        provider: isDefaultProvider ? '' : d.provider.toBase58(),
        requiredCapability: d.requiredCapability,
        reward: d.reward.toNumber() / LAMPORTS_PER_SOL,
        deadline: new Date(d.deadline.toNumber() * 1000),
        status: parseStatus(d.status),
        createdAt: new Date(d.createdAt.toNumber() * 1000),
        resultHash: Array.from(d.resultHash as Uint8Array),
        acceptedAt: d.acceptedAt ? new Date(d.acceptedAt.toNumber() * 1000) : null,
        deliveredAt: d.deliveredAt ? new Date(d.deliveredAt.toNumber() * 1000) : null,
        completedAt: d.completedAt ? new Date(d.completedAt.toNumber() * 1000) : null,
      };
    });
  } catch {
    return [];
  }
}

// ---------- Error Handling ----------

export function parseTransactionError(err: unknown): string {
  const msg = String(err);
  if (msg.includes('already in use')) return 'Agent already registered';
  if (msg.includes('insufficient funds') || msg.includes('0x1')) return 'Insufficient SOL balance';
  if (msg.includes('User rejected')) return 'Transaction cancelled';
  if (msg.includes('CapabilityMismatch')) return 'Capability mismatch';
  if (msg.includes('InvalidTaskStatus')) return 'Invalid task status';
  if (msg.includes('AgentNotActive')) return 'Agent is not active';
  if (msg.includes('AccountNotInitialized') || msg.includes('Account does not exist') || msg.includes('3012'))
    return 'You need to register as an agent first to accept tasks.';
  return msg;
}
