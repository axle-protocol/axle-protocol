/**
 * Shared Solana utilities for AXLE Dashboard
 * Centralized RPC connection and common operations
 */
import { Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { PROGRAM_ID, RPC_URL } from './constants';

// Singleton connection instance
let connectionInstance: Connection | null = null;

export function getConnection(): Connection {
  if (!connectionInstance) {
    connectionInstance = new Connection(RPC_URL, 'confirmed');
  }
  return connectionInstance;
}

// Cache for program accounts
interface AccountEntry {
  pubkey: PublicKey;
  account: any;
}

interface AccountsCache {
  data: AccountEntry[] | null;
  timestamp: number;
}

let accountsCache: AccountsCache = { data: null, timestamp: 0 };
const CACHE_DURATION = 10000; // 10 seconds

export async function getProgramAccounts(): Promise<AccountEntry[]> {
  const now = Date.now();
  
  if (accountsCache.data && (now - accountsCache.timestamp) < CACHE_DURATION) {
    return accountsCache.data;
  }
  
  try {
    const connection = getConnection();
    const accounts = await connection.getProgramAccounts(PROGRAM_ID, {
      commitment: 'confirmed',
    });
    
    // Convert to mutable array
    const accountsList: AccountEntry[] = accounts.map(a => ({ pubkey: a.pubkey, account: a.account }));
    
    accountsCache = { data: accountsList, timestamp: now };
    return accountsList;
  } catch (error) {
    console.error('Failed to fetch program accounts:', error);
    return accountsCache.data || [];
  }
}

// BorshDeserialize helpers
export function readString(buf: Buffer, offset: number): [string, number] {
  const len = buf.readUInt32LE(offset);
  const str = buf.slice(offset + 4, offset + 4 + len).toString('utf-8');
  return [str, offset + 4 + len];
}

export function readPubkey(buf: Buffer, offset: number): [string, number] {
  const key = new PublicKey(buf.slice(offset, offset + 32));
  return [key.toBase58(), offset + 32];
}

export function readU64(buf: Buffer, offset: number): [number, number] {
  const lo = buf.readUInt32LE(offset);
  const hi = buf.readUInt32LE(offset + 4);
  return [lo + hi * 0x100000000, offset + 8];
}

export function readI64(buf: Buffer, offset: number): [number, number] {
  const lo = buf.readUInt32LE(offset);
  const hi = buf.readInt32LE(offset + 4);
  return [lo + hi * 0x100000000, offset + 8];
}

export function readBool(buf: Buffer, offset: number): [boolean, number] {
  return [buf[offset] === 1, offset + 1];
}

export function readOptionalI64(buf: Buffer, offset: number): [number | null, number] {
  const hasValue = buf[offset] === 1;
  if (hasValue) {
    const [val, newOff] = readI64(buf, offset + 1);
    return [val, newOff];
  }
  return [null, offset + 9];
}

// Agent data interface (exported for reuse)
export interface AgentData {
  publicKey: string;
  pda: string;
  nodeId: string;
  capabilities: string[];
  feePerTask: number;
  reputation: number;
  isActive: boolean;
  tasksCompleted: number;
  tasksFailed: number;
  registeredAt: Date;
}

// Task data interface
export interface TaskData {
  pda: string;
  id: string;
  requester: string;
  provider: string | null;
  requiredCapability: string;
  reward: number;
  deadline: Date;
  status: string;
  createdAt: Date;
  acceptedAt: Date | null;
  completedAt: Date | null;
}

const STATUS_NAMES: Record<number, string> = {
  0: 'Created',
  1: 'Accepted',
  2: 'Delivered',
  3: 'Completed',
  4: 'Disputed',
  5: 'Cancelled',
  6: 'TimedOut',
};

export function parseAgentAccount(data: Buffer, pda: string): AgentData | null {
  try {
    let offset = 8;
    const [authority, o1] = readPubkey(data, offset); offset = o1;
    const [nodeId, o2] = readString(data, offset); offset = o2;
    const [capStr, o3] = readString(data, offset); offset = o3;
    const [feePerTask, o4] = readU64(data, offset); offset = o4;
    const [reputation, o5] = readU64(data, offset); offset = o5;
    const [isActive, o6] = readBool(data, offset); offset = o6;
    const [tasksCompleted, o7] = readU64(data, offset); offset = o7;
    const [tasksFailed, o8] = readU64(data, offset); offset = o8;
    const [registeredAt, o9] = readI64(data, offset); offset = o9;

    let capabilities: string[];
    try {
      capabilities = JSON.parse(capStr);
      if (!Array.isArray(capabilities)) capabilities = [capStr];
    } catch {
      capabilities = [capStr];
    }

    return {
      publicKey: authority,
      pda,
      nodeId,
      capabilities,
      feePerTask,
      reputation,
      isActive,
      tasksCompleted,
      tasksFailed,
      registeredAt: new Date(registeredAt * 1000),
    };
  } catch {
    return null;
  }
}

export function parseTaskAccount(data: Buffer, pda: string): TaskData | null {
  try {
    let offset = 8;
    const id = data.slice(offset, offset + 32); offset += 32;
    const [requester, o1] = readPubkey(data, offset); offset = o1;
    const [provider, o2] = readPubkey(data, offset); offset = o2;
    offset += 32; // description_hash
    const [requiredCapability, o3] = readString(data, offset); offset = o3;
    const [reward, o4] = readU64(data, offset); offset = o4;
    const [deadline, o5] = readI64(data, offset); offset = o5;
    const statusByte = data[offset]; offset += 1;
    offset += 32; // result_hash
    const [createdAt, o6] = readI64(data, offset); offset = o6;
    const [acceptedAt, o7] = readOptionalI64(data, offset); offset = o7;
    offset += 9; // delivered_at
    const [completedAt, o9] = readOptionalI64(data, offset); offset = o9;

    const isDefaultProvider = provider === '11111111111111111111111111111111';

    return {
      pda,
      id: Buffer.from(id).toString('hex').slice(0, 16),
      requester: requester.slice(0, 8) + '...',
      provider: isDefaultProvider ? null : provider.slice(0, 8) + '...',
      requiredCapability,
      reward: reward / LAMPORTS_PER_SOL,
      deadline: new Date(deadline * 1000),
      status: STATUS_NAMES[statusByte] || 'Unknown',
      createdAt: new Date(createdAt * 1000),
      acceptedAt: acceptedAt ? new Date(acceptedAt * 1000) : null,
      completedAt: completedAt ? new Date(completedAt * 1000) : null,
    };
  } catch {
    return null;
  }
}

// Fetch all agents and tasks from program accounts
export async function fetchAgentsAndTasks(): Promise<{
  agents: AgentData[];
  tasks: TaskData[];
}> {
  const accounts = await getProgramAccounts();
  
  const agents: AgentData[] = [];
  const tasks: TaskData[] = [];

  for (const { pubkey, account } of accounts) {
    const data = Buffer.from(account.data);
    if (data.length < 8) continue;

    const agent = parseAgentAccount(data, pubkey.toBase58());
    if (agent && agent.nodeId.length > 0 && agent.nodeId.length < 65) {
      agents.push(agent);
      continue;
    }

    const task = parseTaskAccount(data, pubkey.toBase58());
    if (task && task.reward > 0) {
      tasks.push(task);
    }
  }

  return { agents, tasks };
}
