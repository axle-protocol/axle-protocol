/**
 * Solana on-chain data fetching for PACT dashboard
 */
import { Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';

const PROGRAM_ID = new PublicKey('4zr1KP5Rp4xrofrUWFjPqBjJKciNL2s8qXt4eFtc7M82');
const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL || 'http://127.0.0.1:8899';

// Anchor account discriminators (first 8 bytes of SHA-256 of "account:<Name>")
const AGENT_DISCRIMINATOR = Buffer.from([140, 154, 67, 252, 116, 79, 127, 51]); // placeholder
const TASK_DISCRIMINATOR = Buffer.from([210, 34, 189, 86, 13, 100, 175, 116]); // placeholder

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

export interface DashboardStats {
  totalAgents: number;
  activeAgents: number;
  totalTasks: number;
  completedTasks: number;
  totalEscrowLocked: number;
  averageReputation: number;
}

// BorshDeserialize helpers
function readString(buf: Buffer, offset: number): [string, number] {
  const len = buf.readUInt32LE(offset);
  const str = buf.slice(offset + 4, offset + 4 + len).toString('utf-8');
  return [str, offset + 4 + len];
}

function readPubkey(buf: Buffer, offset: number): [string, number] {
  const key = new PublicKey(buf.slice(offset, offset + 32));
  return [key.toBase58(), offset + 32];
}

function readU64(buf: Buffer, offset: number): [number, number] {
  const lo = buf.readUInt32LE(offset);
  const hi = buf.readUInt32LE(offset + 4);
  return [lo + hi * 0x100000000, offset + 8];
}

function readI64(buf: Buffer, offset: number): [number, number] {
  const lo = buf.readUInt32LE(offset);
  const hi = buf.readInt32LE(offset + 4);
  return [lo + hi * 0x100000000, offset + 8];
}

function readBool(buf: Buffer, offset: number): [boolean, number] {
  return [buf[offset] === 1, offset + 1];
}

function readOptionalI64(buf: Buffer, offset: number): [number | null, number] {
  const hasValue = buf[offset] === 1;
  if (hasValue) {
    const [val, newOff] = readI64(buf, offset + 1);
    return [val, newOff];
  }
  return [null, offset + 9]; // skip 1 (option tag) + 8 (i64)
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

function parseAgentAccount(data: Buffer, pda: string): AgentData | null {
  try {
    // Skip 8-byte discriminator
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

function parseTaskAccount(data: Buffer, pda: string): TaskData | null {
  try {
    let offset = 8; // discriminator
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
    offset += 9; // delivered_at (skip)
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

export async function fetchDashboardData(): Promise<{
  agents: AgentData[];
  tasks: TaskData[];
  stats: DashboardStats;
  connected: boolean;
  cluster: string;
}> {
  try {
    const connection = new Connection(RPC_URL, 'confirmed');

    // Fetch all program accounts
    const accounts = await connection.getProgramAccounts(PROGRAM_ID, {
      commitment: 'confirmed',
    });

    const agents: AgentData[] = [];
    const tasks: TaskData[] = [];

    for (const { pubkey, account } of accounts) {
      const data = Buffer.from(account.data);
      if (data.length < 8) continue;

      // Try parsing as agent
      const agent = parseAgentAccount(data, pubkey.toBase58());
      if (agent && agent.nodeId.length > 0 && agent.nodeId.length < 65) {
        agents.push(agent);
        continue;
      }

      // Try parsing as task
      const task = parseTaskAccount(data, pubkey.toBase58());
      if (task && task.reward > 0) {
        tasks.push(task);
      }
    }

    // Compute stats
    const activeAgents = agents.filter(a => a.isActive).length;
    const completedTasks = tasks.filter(t => t.status === 'Completed').length;
    const lockedTasks = tasks.filter(t => ['Created', 'Accepted', 'Delivered'].includes(t.status));
    const totalEscrowLocked = lockedTasks.reduce((sum, t) => sum + t.reward, 0);
    const avgRep = agents.length > 0
      ? Math.round(agents.reduce((s, a) => s + a.reputation, 0) / agents.length)
      : 0;

    return {
      agents,
      tasks,
      stats: {
        totalAgents: agents.length,
        activeAgents,
        totalTasks: tasks.length,
        completedTasks,
        totalEscrowLocked,
        averageReputation: avgRep,
      },
      connected: true,
      cluster: RPC_URL.includes('localhost') || RPC_URL.includes('127.0.0.1') ? 'localnet' : 'devnet',
    };
  } catch (e) {
    return {
      agents: [],
      tasks: [],
      stats: {
        totalAgents: 0,
        activeAgents: 0,
        totalTasks: 0,
        completedTasks: 0,
        totalEscrowLocked: 0,
        averageReputation: 0,
      },
      connected: false,
      cluster: 'disconnected',
    };
  }
}
