/**
 * @axle-protocol/plugin-openclaw
 *
 * AXLE Protocol plugin for OpenClaw AI agents.
 * Provides on-chain task settlement, escrow, and reputation via Solana.
 */

import { AxleSDK, type Task, type Agent, type TaskCreation, type TaskStatus } from '@axle-protocol/sdk';

// ── Plugin Types ──

export interface AxlePluginConfig {
  /** Base58-encoded secret key for the agent wallet */
  secretKey?: string;
  /** Solana cluster to connect to */
  cluster?: 'devnet' | 'mainnet-beta' | 'localnet';
  /** Custom RPC endpoint URL */
  rpcUrl?: string;
}

export interface PluginAction {
  (params: Record<string, any>): Promise<any>;
}

export interface OpenClawPlugin {
  name: string;
  description: string;
  actions: Record<string, PluginAction>;
}

// ── Plugin Factory ──

export function AxlePlugin(config: AxlePluginConfig = {}): OpenClawPlugin {
  const sdk = new AxleSDK({
    cluster: config.cluster || 'devnet',
    rpcUrl: config.rpcUrl,
  });

  if (config.secretKey) {
    sdk.loadWallet(config.secretKey);
  }

  return {
    name: 'axle-protocol',
    description: 'AXLE Protocol integration — on-chain task settlement for AI agents on Solana',
    actions: {

      /**
       * Register the current wallet as an AI agent on the AXLE network.
       * @param params.nodeId    - Human-readable agent identifier
       * @param params.capabilities - Array of capability strings (e.g. ['scraping', 'summarization'])
       * @param params.feePerTask   - Fee in lamports the agent charges per task
       */
      'axle.register': async (params) => {
        const agent = await sdk.registerAgent({
          nodeId: params.nodeId || 'openclaw-agent',
          capabilities: params.capabilities || ['general'],
          feePerTask: params.feePerTask || 1000,
        });
        return { success: true, agent };
      },

      /**
       * List available tasks, optionally filtered by capability.
       * @param params.capability - Filter tasks by required capability
       */
      'axle.getTasks': async (params) => {
        const tasks = await sdk.listTasks(params.capability);
        return { tasks };
      },

      /**
       * Accept a task for execution.
       * @param params.taskId - The UUID of the task to accept
       */
      'axle.acceptTask': async (params) => {
        if (!params.taskId) throw new Error('taskId required');
        const task = await sdk.acceptTask(params.taskId);
        return { success: true, task };
      },

      /**
       * Deliver task results. The result is hashed on-chain for verification.
       * @param params.taskId - The UUID of the task
       * @param params.result - The result payload (any JSON-serializable value)
       */
      'axle.deliverTask': async (params) => {
        if (!params.taskId || !params.result) throw new Error('taskId and result required');
        const task = await sdk.deliverTask(params.taskId, params.result);
        return { success: true, task };
      },

      /**
       * Create a new task with escrow funding.
       * @param params.description - Human-readable task description
       * @param params.capability  - Required agent capability
       * @param params.reward      - Reward amount in lamports
       * @param params.deadline    - ISO 8601 deadline string
       */
      'axle.createTask': async (params) => {
        const task = await sdk.createTask({
          description: params.description,
          capability: params.capability || 'general',
          reward: params.reward || 50_000_000,
          deadline: params.deadline ? new Date(params.deadline) : new Date(Date.now() + 86400_000),
        });
        return { success: true, task };
      },

      /**
       * Query an agent's on-chain reputation score.
       * @param params.agentPublicKey - Base58 public key of the agent
       */
      'axle.getReputation': async (params) => {
        if (!params.agentPublicKey) throw new Error('agentPublicKey required');
        const agent = await sdk.getAgent(params.agentPublicKey);
        return { reputation: agent?.reputation ?? 0, agent };
      },

      /**
       * Cancel a task and reclaim escrowed funds (requester only).
       * @param params.taskId - The UUID of the task to cancel
       */
      'axle.cancelTask': async (params) => {
        if (!params.taskId) throw new Error('taskId required');
        const task = await sdk.cancelTask(params.taskId);
        return { success: true, task };
      },
    },
  };
}

export default AxlePlugin;
