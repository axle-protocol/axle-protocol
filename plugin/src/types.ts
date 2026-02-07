/**
 * Option C Protocol Types
 * Distributed Agent Task Network on Solana
 */

// Agent Registry Types
export interface Agent {
  publicKey: string;
  nodeId: string;
  capabilities: string[];
  feePerTask: number;  // in lamports
  reputation: number;  // 0-1000
  isActive: boolean;
  tasksCompleted: number;
  tasksFailed: number;
  stakedAmount: number;
  registeredAt: Date;
}

export interface AgentRegistration {
  nodeId: string;
  capabilities: string[];
  feePerTask: number;
  stakeAmount?: number;
}

// Task Types
export enum TaskStatus {
  Created = 'created',
  Accepted = 'accepted',
  InProgress = 'in_progress',
  Delivered = 'delivered',
  Completed = 'completed',
  Disputed = 'disputed',
  Cancelled = 'cancelled',
  TimedOut = 'timed_out',
}

export interface Task {
  id: string;
  requester: string;        // Pubkey
  provider?: string;        // Pubkey (assigned when accepted)
  description: string;
  descriptionHash: string;
  capability: string;       // Required capability
  reward: number;           // Lamports
  deadline: Date;
  status: TaskStatus;
  resultHash?: string;
  result?: any;             // Off-chain result data
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

export interface TaskResult {
  taskId: string;
  data: any;
  hash: string;
}

// Inter-Agent Communication Protocol (IACP)
export type MessageType = 
  | 'DISCOVER'    // Find agents with capability
  | 'OFFER'       // Offer task to agent
  | 'ACCEPT'      // Accept task offer
  | 'REJECT'      // Reject task offer
  | 'DELIVER'     // Submit task result
  | 'VERIFY'      // Request verification
  | 'SETTLE'      // Confirm settlement
  | 'PING'        // Health check
  | 'PONG';       // Health response

export interface AgentMessage {
  id: string;
  type: MessageType;
  sender: string;           // did:sol:PUBKEY
  recipient?: string;       // did:sol:PUBKEY (optional for broadcasts)
  timestamp: number;
  payload: MessagePayload;
  signature: string;        // Ed25519 signature
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
  agents?: Agent[];         // For DISCOVER responses
}

// Wallet Types
export interface Wallet {
  publicKey: string;
  secretKey: Uint8Array;
}

// Network Types
export interface NetworkConfig {
  cluster: 'devnet' | 'mainnet-beta' | 'testnet';
  rpcUrl: string;
  programId: {
    agentRegistry: string;
    taskEscrow: string;
  };
}

// Plugin Config
export interface PluginConfig {
  network: NetworkConfig;
  wallet?: Wallet;
  nodeId: string;
  capabilities: string[];
  feePerTask: number;
  autoAcceptTasks: boolean;
  maxConcurrentTasks: number;
}

// Events
export interface ProtocolEvent {
  type: 'agent_registered' | 'task_created' | 'task_accepted' | 
        'task_completed' | 'task_disputed' | 'reputation_updated';
  data: any;
  timestamp: Date;
}

export type EventHandler = (event: ProtocolEvent) => void | Promise<void>;
