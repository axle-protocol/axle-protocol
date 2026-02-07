/**
 * @openclaw/solana-protocol
 *
 * OpenClaw plugin for the distributed agent task protocol on Solana.
 * Uses Anchor IDL to send real on-chain transactions.
 */

import { createHash } from 'crypto';
import { Program, AnchorProvider, BN } from '@coral-xyz/anchor';
import type { Idl } from '@coral-xyz/anchor';
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
import * as nacl from 'tweetnacl';
import bs58 from 'bs58';

import {
  Agent,
  AgentRegistration,
  Task,
  TaskCreation,
  TaskStatus,
  AgentMessage,
  MessageType,
  PluginConfig,
  NetworkConfig,
  EventHandler,
  ProtocolEvent,
} from './types.js';

import idlJson from './idl/agent_protocol.json';

const PROGRAM_ID = new PublicKey(idlJson.address);

// Default localnet configuration
const DEFAULT_CONFIG: NetworkConfig = {
  cluster: 'devnet',
  rpcUrl: 'http://127.0.0.1:8899',
  programId: {
    agentRegistry: idlJson.address,
    taskEscrow: idlJson.address,
  },
};

// ============ PDA Helpers ============

function getAgentPDA(authority: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from('agent'), authority.toBuffer()],
    PROGRAM_ID,
  );
  return pda;
}

function getTaskPDA(taskId: Uint8Array): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from('task'), taskId],
    PROGRAM_ID,
  );
  return pda;
}

function getEscrowPDA(taskId: Uint8Array): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from('escrow'), taskId],
    PROGRAM_ID,
  );
  return pda;
}

function getBadgeMintPDA(authority: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from('badge'), authority.toBuffer()],
    PROGRAM_ID,
  );
  return pda;
}

/** SHA-256 hash a string and return 32 bytes */
function sha256(data: string): Uint8Array {
  return new Uint8Array(createHash('sha256').update(data).digest());
}

/** Convert a UUID string to a deterministic 32-byte task ID */
function uuidToTaskId(uuid: string): Uint8Array {
  return sha256(uuid);
}

// ============ On-chain data mappers ============

function mapOnChainAgent(data: any, pda: PublicKey): Agent {
  return {
    publicKey: (data.authority as PublicKey).toBase58(),
    nodeId: data.nodeId as string,
    capabilities: parseCapabilities(data.capabilities as string),
    feePerTask: (data.feePerTask as BN).toNumber(),
    reputation: (data.reputation as BN).toNumber(),
    isActive: data.isActive as boolean,
    tasksCompleted: (data.tasksCompleted as BN).toNumber(),
    tasksFailed: (data.tasksFailed as BN).toNumber(),
    stakedAmount: 0,
    registeredAt: new Date((data.registeredAt as BN).toNumber() * 1000),
  };
}

function parseCapabilities(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [raw];
  } catch {
    return [raw];
  }
}

const STATUS_MAP: Record<string, TaskStatus> = {
  created: TaskStatus.Created,
  accepted: TaskStatus.Accepted,
  delivered: TaskStatus.Delivered,
  completed: TaskStatus.Completed,
  disputed: TaskStatus.Disputed,
  cancelled: TaskStatus.Cancelled,
  timedOut: TaskStatus.TimedOut,
};

function mapOnChainTask(data: any, pda: PublicKey): Task {
  // Anchor enums deserialize to { variantName: {} }
  const statusKey = Object.keys(data.status)[0];
  return {
    id: bs58.encode(data.id as Uint8Array),
    requester: (data.requester as PublicKey).toBase58(),
    provider: (data.provider as PublicKey).equals(PublicKey.default)
      ? undefined
      : (data.provider as PublicKey).toBase58(),
    description: '',
    descriptionHash: bs58.encode(data.descriptionHash as Uint8Array),
    capability: data.requiredCapability as string,
    reward: (data.reward as BN).toNumber(),
    deadline: new Date((data.deadline as BN).toNumber() * 1000),
    status: STATUS_MAP[statusKey] ?? TaskStatus.Created,
    resultHash: bs58.encode(data.resultHash as Uint8Array),
    createdAt: new Date((data.createdAt as BN).toNumber() * 1000),
    acceptedAt: data.acceptedAt
      ? new Date((data.acceptedAt as BN).toNumber() * 1000)
      : undefined,
    completedAt: data.completedAt
      ? new Date((data.completedAt as BN).toNumber() * 1000)
      : undefined,
  };
}

// ============ Main Protocol Class ============

export class SolanaProtocol {
  private connection: Connection;
  private wallet: Keypair | null = null;
  private program: Program | null = null;
  private config: PluginConfig;
  private eventHandlers: Map<string, EventHandler[]> = new Map();
  private isRegistered: boolean = false;

  // Local task ID mapping: uuid -> taskIdBytes
  private taskIdMap: Map<string, Uint8Array> = new Map();

  constructor(config: Partial<PluginConfig> = {}) {
    this.config = {
      network: config.network || DEFAULT_CONFIG,
      nodeId: config.nodeId || `node-${uuidv4().slice(0, 8)}`,
      capabilities: config.capabilities || ['general'],
      feePerTask: config.feePerTask || 1000,
      autoAcceptTasks: config.autoAcceptTasks ?? false,
      maxConcurrentTasks: config.maxConcurrentTasks || 5,
    };

    this.connection = new Connection(this.config.network.rpcUrl, 'confirmed');
  }

  /** Initialize Anchor program (called after wallet is loaded) */
  private initProgram(): void {
    if (!this.wallet) throw new Error('Wallet not initialized');
    const walletAdapter = {
      publicKey: this.wallet.publicKey,
      signTransaction: async <T extends import('@solana/web3.js').Transaction>(tx: T): Promise<T> => {
        tx.sign(this.wallet!);
        return tx;
      },
      signAllTransactions: async <T extends import('@solana/web3.js').Transaction>(txs: T[]): Promise<T[]> => {
        txs.forEach(tx => tx.sign(this.wallet!));
        return txs;
      },
    };
    const provider = new AnchorProvider(
      this.connection,
      walletAdapter as any,
      { commitment: 'confirmed' },
    );
    this.program = new Program(idlJson as unknown as Idl, provider);
  }

  private requireProgram(): Program {
    if (!this.program) throw new Error('Wallet not initialized — call createWallet() or loadWallet() first');
    return this.program;
  }

  // ============ Wallet Management ============

  async createWallet(): Promise<{ publicKey: string; secretKey: string }> {
    const keypair = Keypair.generate();
    this.wallet = keypair;
    this.initProgram();
    return {
      publicKey: keypair.publicKey.toBase58(),
      secretKey: bs58.encode(keypair.secretKey),
    };
  }

  async loadWallet(secretKey: string): Promise<string> {
    const decoded = bs58.decode(secretKey);
    this.wallet = Keypair.fromSecretKey(decoded);
    this.initProgram();
    return this.wallet.publicKey.toBase58();
  }

  async getBalance(): Promise<number> {
    if (!this.wallet) throw new Error('Wallet not initialized');
    const balance = await this.connection.getBalance(this.wallet.publicKey);
    return balance / LAMPORTS_PER_SOL;
  }

  async requestAirdrop(amount: number = 1): Promise<string> {
    if (!this.wallet) throw new Error('Wallet not initialized');
    const signature = await this.connection.requestAirdrop(
      this.wallet.publicKey,
      amount * LAMPORTS_PER_SOL,
    );
    await this.connection.confirmTransaction(signature);
    return signature;
  }

  // ============ Agent Registry (On-Chain) ============

  async registerAgent(registration?: Partial<AgentRegistration>): Promise<Agent> {
    const program = this.requireProgram();

    const nodeId = registration?.nodeId || this.config.nodeId;
    const capabilities = registration?.capabilities || this.config.capabilities;
    const feePerTask = registration?.feePerTask || this.config.feePerTask;
    const authority = this.wallet!.publicKey;
    const agentPDA = getAgentPDA(authority);

    await (program.methods as any)
      .registerAgent(nodeId, JSON.stringify(capabilities), new BN(feePerTask))
      .accounts({
        agentAccount: agentPDA,
        authority,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    this.isRegistered = true;

    const data = await (program.account as any).agentState.fetch(agentPDA);
    const agent = mapOnChainAgent(data, agentPDA);

    this.emit({ type: 'agent_registered', data: agent, timestamp: new Date() });
    console.log(`[Protocol] Agent registered on-chain: ${nodeId} (${authority.toBase58().slice(0, 8)}...)`);
    return agent;
  }

  async findAgents(capability: string): Promise<Agent[]> {
    const program = this.requireProgram();
    const allAccounts = await (program.account as any).agentState.all();
    return allAccounts
      .map((acc: any) => mapOnChainAgent(acc.account, acc.publicKey))
      .filter((a: Agent) => a.isActive && a.capabilities.includes(capability));
  }

  async getAgent(publicKey: string): Promise<Agent | null> {
    const program = this.requireProgram();
    const authority = new PublicKey(publicKey);
    const agentPDA = getAgentPDA(authority);
    try {
      const data = await (program.account as any).agentState.fetch(agentPDA);
      return mapOnChainAgent(data, agentPDA);
    } catch {
      return null;
    }
  }

  async setAgentActive(active: boolean): Promise<void> {
    const program = this.requireProgram();
    const authority = this.wallet!.publicKey;
    const agentPDA = getAgentPDA(authority);

    await (program.methods as any)
      .updateAgent(null, null, active)
      .accounts({
        agentAccount: agentPDA,
        authority,
      })
      .rpc();
  }

  // ============ Task Management (On-Chain) ============

  async createTask(creation: TaskCreation): Promise<Task> {
    const program = this.requireProgram();
    const requester = this.wallet!.publicKey;

    const uuid = uuidv4();
    const taskIdBytes = uuidToTaskId(uuid);
    this.taskIdMap.set(uuid, taskIdBytes);

    const descriptionHash = sha256(creation.description);
    const deadlineUnix = Math.floor(creation.deadline.getTime() / 1000);

    const taskPDA = getTaskPDA(taskIdBytes);
    const escrowPDA = getEscrowPDA(taskIdBytes);

    await (program.methods as any)
      .createTask(
        Array.from(taskIdBytes),
        Array.from(descriptionHash),
        creation.capability,
        new BN(creation.reward),
        new BN(deadlineUnix),
      )
      .accounts({
        taskAccount: taskPDA,
        escrow: escrowPDA,
        requester,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const data = await (program.account as any).taskAccount.fetch(taskPDA);
    const task = mapOnChainTask(data, taskPDA);
    task.description = creation.description;
    task.id = uuid; // Keep human-readable UUID; on-chain uses hash

    this.taskIdMap.set(uuid, taskIdBytes);

    this.emit({ type: 'task_created', data: task, timestamp: new Date() });
    console.log(`[Protocol] Task created on-chain: ${uuid.slice(0, 8)}... (${creation.capability})`);
    return task;
  }

  async acceptTask(taskId: string): Promise<Task> {
    const program = this.requireProgram();
    const provider = this.wallet!.publicKey;

    const taskIdBytes = this.resolveTaskId(taskId);
    const taskPDA = getTaskPDA(taskIdBytes);
    const agentPDA = getAgentPDA(provider);

    await (program.methods as any)
      .acceptTask()
      .accounts({
        taskAccount: taskPDA,
        agentAccount: agentPDA,
        provider,
      })
      .rpc();

    const data = await (program.account as any).taskAccount.fetch(taskPDA);
    const task = mapOnChainTask(data, taskPDA);

    this.emit({ type: 'task_accepted', data: task, timestamp: new Date() });
    console.log(`[Protocol] Task accepted on-chain: ${taskId.slice(0, 8)}...`);
    return task;
  }

  async deliverTask(taskId: string, result: any): Promise<Task> {
    const program = this.requireProgram();
    const provider = this.wallet!.publicKey;

    const taskIdBytes = this.resolveTaskId(taskId);
    const taskPDA = getTaskPDA(taskIdBytes);
    const resultHash = sha256(this.canonicalJson(result));

    await (program.methods as any)
      .deliverTask(Array.from(resultHash))
      .accounts({
        taskAccount: taskPDA,
        provider,
      })
      .rpc();

    const data = await (program.account as any).taskAccount.fetch(taskPDA);
    const task = mapOnChainTask(data, taskPDA);
    task.result = result;

    console.log(`[Protocol] Task delivered on-chain: ${taskId.slice(0, 8)}...`);
    return task;
  }

  async completeTask(taskId: string): Promise<Task> {
    const program = this.requireProgram();
    const requester = this.wallet!.publicKey;

    const taskIdBytes = this.resolveTaskId(taskId);
    const taskPDA = getTaskPDA(taskIdBytes);
    const escrowPDA = getEscrowPDA(taskIdBytes);

    // Fetch task to get provider
    const taskData = await (program.account as any).taskAccount.fetch(taskPDA);
    const providerKey = taskData.provider as PublicKey;
    const agentPDA = getAgentPDA(providerKey);

    await (program.methods as any)
      .completeTask()
      .accounts({
        taskAccount: taskPDA,
        agentAccount: agentPDA,
        provider: providerKey,
        escrow: escrowPDA,
        requester,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const data = await (program.account as any).taskAccount.fetch(taskPDA);
    const task = mapOnChainTask(data, taskPDA);

    this.emit({ type: 'task_completed', data: task, timestamp: new Date() });
    console.log(`[Protocol] Task completed on-chain: ${taskId.slice(0, 8)}...`);
    return task;
  }

  async cancelTask(taskId: string): Promise<Task> {
    const program = this.requireProgram();
    const requester = this.wallet!.publicKey;

    const taskIdBytes = this.resolveTaskId(taskId);
    const taskPDA = getTaskPDA(taskIdBytes);
    const escrowPDA = getEscrowPDA(taskIdBytes);

    await (program.methods as any)
      .cancelTask()
      .accounts({
        taskAccount: taskPDA,
        escrow: escrowPDA,
        requester,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const data = await (program.account as any).taskAccount.fetch(taskPDA);
    const task = mapOnChainTask(data, taskPDA);

    console.log(`[Protocol] Task cancelled on-chain: ${taskId.slice(0, 8)}...`);
    return task;
  }

  async timeoutTask(taskId: string): Promise<Task> {
    const program = this.requireProgram();
    const requester = this.wallet!.publicKey;

    const taskIdBytes = this.resolveTaskId(taskId);
    const taskPDA = getTaskPDA(taskIdBytes);
    const escrowPDA = getEscrowPDA(taskIdBytes);

    // Fetch task to get provider
    const taskData = await (program.account as any).taskAccount.fetch(taskPDA);
    const providerKey = taskData.provider as PublicKey;
    const agentPDA = getAgentPDA(providerKey);

    await (program.methods as any)
      .timeoutTask()
      .accounts({
        taskAccount: taskPDA,
        agentAccount: agentPDA,
        escrow: escrowPDA,
        requester,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const data = await (program.account as any).taskAccount.fetch(taskPDA);
    return mapOnChainTask(data, taskPDA);
  }

  async getTask(taskId: string): Promise<Task | null> {
    const program = this.requireProgram();
    const taskIdBytes = this.resolveTaskId(taskId);
    const taskPDA = getTaskPDA(taskIdBytes);
    try {
      const data = await (program.account as any).taskAccount.fetch(taskPDA);
      return mapOnChainTask(data, taskPDA);
    } catch {
      return null;
    }
  }

  async listTasks(capability?: string): Promise<Task[]> {
    const program = this.requireProgram();
    const allAccounts = await (program.account as any).taskAccount.all();
    let tasks = allAccounts.map((acc: any) => mapOnChainTask(acc.account, acc.publicKey));
    if (capability) {
      tasks = tasks.filter((t: Task) => t.capability === capability && t.status === TaskStatus.Created);
    }
    return tasks;
  }

  // ============ Agent Badge (Token-2022 NFT) ============

  async mintAgentBadge(name: string, symbol: string, uri: string): Promise<string> {
    const program = this.requireProgram();
    const authority = this.wallet!.publicKey;
    const agentPDA = getAgentPDA(authority);
    const badgeMint = getBadgeMintPDA(authority);
    const tokenAccount = getAssociatedTokenAddressSync(
      badgeMint,
      authority,
      false,
      TOKEN_2022_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID,
    );

    await (program.methods as any)
      .mintAgentBadge(name, symbol, uri)
      .accounts({
        agentAccount: agentPDA,
        badgeMint,
        tokenAccount,
        authority,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    console.log(`[Protocol] Agent Badge minted: ${badgeMint.toBase58()}`);
    return badgeMint.toBase58();
  }

  // ============ Messaging (Off-Chain, Ed25519) ============

  createMessage(type: MessageType, recipient: string | undefined, payload: any): AgentMessage {
    if (!this.wallet) throw new Error('Wallet not initialized');

    const message: AgentMessage = {
      id: uuidv4(),
      type,
      sender: `did:sol:${this.wallet.publicKey.toBase58()}`,
      recipient: recipient ? `did:sol:${recipient}` : undefined,
      timestamp: Date.now(),
      payload,
      signature: '',
    };

    const signable = { ...message, signature: undefined };
    const messageBytes = new TextEncoder().encode(this.canonicalJson(signable));
    const signatureBytes = nacl.sign.detached(messageBytes, this.wallet.secretKey);
    message.signature = bs58.encode(signatureBytes);

    return message;
  }

  verifyMessage(message: AgentMessage): boolean {
    try {
      const senderPubkey = message.sender.replace('did:sol:', '');
      const publicKey = bs58.decode(senderPubkey);

      const signable = { ...message, signature: undefined };
      const messageBytes = new TextEncoder().encode(this.canonicalJson(signable));
      const signatureBytes = bs58.decode(message.signature);

      return nacl.sign.detached.verify(messageBytes, signatureBytes, publicKey);
    } catch {
      return false;
    }
  }

  // ============ Events ============

  on(eventType: string, handler: EventHandler): void {
    const handlers = this.eventHandlers.get(eventType) || [];
    handlers.push(handler);
    this.eventHandlers.set(eventType, handlers);
  }

  private emit(event: ProtocolEvent): void {
    const handlers = this.eventHandlers.get(event.type) || [];
    handlers.forEach(h => h(event));
    const allHandlers = this.eventHandlers.get('all') || [];
    allHandlers.forEach(h => h(event));
  }

  // ============ Utilities ============

  private canonicalJson(obj: any): string {
    if (obj === null || obj === undefined) return JSON.stringify(obj);
    if (typeof obj !== 'object') return JSON.stringify(obj);
    if (Array.isArray(obj)) {
      return '[' + obj.map(item => this.canonicalJson(item)).join(',') + ']';
    }
    const sortedKeys = Object.keys(obj).sort();
    const pairs = sortedKeys
      .filter(key => obj[key] !== undefined)
      .map(key => JSON.stringify(key) + ':' + this.canonicalJson(obj[key]));
    return '{' + pairs.join(',') + '}';
  }

  private hashData(data: string): string {
    return bs58.encode(sha256(data));
  }

  /** Resolve task ID: uuid string -> 32-byte hash */
  private resolveTaskId(taskId: string): Uint8Array {
    const cached = this.taskIdMap.get(taskId);
    if (cached) return cached;
    // If not cached, assume it's a UUID and hash it
    const bytes = uuidToTaskId(taskId);
    this.taskIdMap.set(taskId, bytes);
    return bytes;
  }

  // ============ Public Getters ============

  getConfig(): PluginConfig {
    return { ...this.config };
  }

  getWalletAddress(): string | null {
    return this.wallet?.publicKey.toBase58() || null;
  }

  isAgentRegistered(): boolean {
    return this.isRegistered;
  }

  getProgramId(): string {
    return PROGRAM_ID.toBase58();
  }

  /** Expose PDA helpers for external use */
  static PDA = { getAgentPDA, getTaskPDA, getEscrowPDA, getBadgeMintPDA };
}

// Export types
export * from './types.js';

// Default export
export default SolanaProtocol;
