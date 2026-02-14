/**
 * @axle-protocol/sdk — Type definitions
 * Task settlement protocol for AI agents on Solana
 */

// ── Agent Types ──

export interface Agent {
  publicKey: string;
  nodeId: string;
  capabilities: string[];
  feePerTask: number;
  reputation: number;
  isActive: boolean;
  tasksCompleted: number;
  tasksFailed: number;
  registeredAt: Date;
}

export interface AgentRegistration {
  nodeId: string;
  capabilities: string[];
  feePerTask: number;
}

// ── Task Types ──

export enum TaskStatus {
  Created = 'created',
  Accepted = 'accepted',
  Delivered = 'delivered',
  Completed = 'completed',
  Disputed = 'disputed',
  Cancelled = 'cancelled',
  TimedOut = 'timed_out',
}

export interface Task {
  id: string;
  requester: string;
  provider?: string;
  description: string;
  descriptionHash: string;
  capability: string;
  reward: number;
  deadline: Date;
  status: TaskStatus;
  resultHash?: string;
  result?: any;
  createdAt: Date;
  acceptedAt?: Date;
  completedAt?: Date;
}

export interface TaskCreation {
  description: string;
  capability: string;
  reward: number;
  deadline: Date;
}

// ── Messaging Types ──

export type MessageType =
  | 'DISCOVER' | 'OFFER' | 'ACCEPT' | 'REJECT'
  | 'DELIVER' | 'VERIFY' | 'SETTLE' | 'PING' | 'PONG';

export interface AgentMessage {
  id: string;
  type: MessageType;
  sender: string;
  recipient?: string;
  timestamp: number;
  payload: MessagePayload;
  signature: string;
}

export interface MessagePayload {
  taskId?: string;
  description?: string;
  capability?: string;
  price?: number;
  deadline?: number;
  resultHash?: string;
  result?: any;
  error?: string;
  agents?: Agent[];
}

// ── Config Types ──

export interface AxleConfig {
  cluster: 'devnet' | 'mainnet-beta' | 'localnet';
  rpcUrl?: string;
  programId?: string;
  nodeId?: string;
  capabilities?: string[];
  feePerTask?: number;
}

// ── Event Types ──

export type EventType =
  | 'agent_registered' | 'task_created' | 'task_accepted'
  | 'task_delivered' | 'task_completed' | 'task_cancelled'
  | 'task_timed_out' | 'reputation_updated';

export interface ProtocolEvent {
  type: EventType;
  data: any;
  timestamp: Date;
}

export type EventHandler = (event: ProtocolEvent) => void | Promise<void>;
