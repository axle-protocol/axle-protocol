/**
 * @axle-protocol/plugin-eliza
 *
 * AXLE Protocol plugin for the Eliza AI framework.
 * Enables Eliza agents to participate in on-chain task settlement on Solana.
 */

import { AxleSDK, type Task, type Agent } from '@axle-protocol/sdk';

// ── Minimal Eliza Type Definitions ──
// Avoids requiring @ai16z/eliza as a dependency.

interface IAgentRuntime {
  getSetting(key: string): string | undefined;
  composeState(message: Memory): Promise<State>;
}

interface Memory {
  content: { text: string; [key: string]: any };
  userId: string;
  roomId: string;
}

interface State {
  [key: string]: any;
}

interface Action {
  name: string;
  description: string;
  similes: string[];
  handler: (runtime: IAgentRuntime, message: Memory, state?: State) => Promise<any>;
  validate: (runtime: IAgentRuntime) => Promise<boolean>;
  examples: Array<Array<{ user: string; content: { text: string } }>>;
}

interface Plugin {
  name: string;
  description: string;
  actions: Action[];
  providers?: any[];
}

// ── SDK Factory ──

function createAxleSDK(runtime: IAgentRuntime): AxleSDK {
  const cluster = (runtime.getSetting('AXLE_CLUSTER') as 'devnet' | 'mainnet-beta' | 'localnet') || 'devnet';
  const rpcUrl = runtime.getSetting('AXLE_RPC_URL');
  const secretKey = runtime.getSetting('AXLE_SECRET_KEY');

  const sdk = new AxleSDK({ cluster, rpcUrl });
  if (secretKey) sdk.loadWallet(secretKey);
  return sdk;
}

function hasWallet(runtime: IAgentRuntime): boolean {
  return !!runtime.getSetting('AXLE_SECRET_KEY');
}

// ── Actions ──

const registerAction: Action = {
  name: 'AXLE_REGISTER',
  description: 'Register as an AI agent on the AXLE Protocol network',
  similes: ['register agent', 'join axle network', 'sign up as agent', 'register on axle'],
  handler: async (runtime, message) => {
    const sdk = createAxleSDK(runtime);
    const capabilities = message.content.capabilities || ['general'];
    const nodeId = message.content.nodeId || `eliza-${Date.now()}`;
    const feePerTask = message.content.feePerTask || 1000;

    const agent = await sdk.registerAgent({ nodeId, capabilities, feePerTask });
    return {
      success: true,
      agent,
      message: `Registered agent "${agent.nodeId}" with capabilities [${agent.capabilities.join(', ')}]. Initial reputation: ${agent.reputation}.`,
    };
  },
  validate: async (runtime) => hasWallet(runtime),
  examples: [[
    { user: 'user', content: { text: 'Register me as an AXLE agent with scraping capabilities' } },
    { user: 'agent', content: { text: 'I\'ve registered you as an AXLE agent with scraping capabilities. Your initial reputation is 100.' } },
  ]],
};

const getTasksAction: Action = {
  name: 'AXLE_GET_TASKS',
  description: 'List available tasks on the AXLE Protocol network, optionally filtered by capability',
  similes: ['list tasks', 'show tasks', 'get available tasks', 'find tasks', 'browse tasks'],
  handler: async (runtime, message) => {
    const sdk = createAxleSDK(runtime);
    const capability = message.content.capability;
    const tasks = await sdk.listTasks(capability);

    if (tasks.length === 0) {
      return { tasks: [], message: capability ? `No tasks found for capability "${capability}".` : 'No tasks currently available.' };
    }

    const summary = tasks.map(t => `- [${t.id}] ${t.capability} — ${t.reward} lamports, deadline ${t.deadline.toISOString()}`).join('\n');
    return {
      tasks,
      message: `Found ${tasks.length} task(s):\n${summary}`,
    };
  },
  validate: async (runtime) => hasWallet(runtime),
  examples: [[
    { user: 'user', content: { text: 'Show me available scraping tasks on AXLE' } },
    { user: 'agent', content: { text: 'Found 2 scraping tasks:\n- [abc-123] scraping — 50000000 lamports\n- [def-456] scraping — 30000000 lamports' } },
  ]],
};

const acceptTaskAction: Action = {
  name: 'AXLE_ACCEPT_TASK',
  description: 'Accept a task on the AXLE Protocol network for execution',
  similes: ['accept task', 'take task', 'claim task', 'start task'],
  handler: async (runtime, message) => {
    const sdk = createAxleSDK(runtime);
    const taskId = message.content.taskId;
    if (!taskId) {
      return { success: false, message: 'Please provide a taskId to accept.' };
    }

    const task = await sdk.acceptTask(taskId);
    return {
      success: true,
      task,
      message: `Accepted task ${taskId}. Reward: ${task.reward} lamports. Deadline: ${task.deadline.toISOString()}.`,
    };
  },
  validate: async (runtime) => hasWallet(runtime),
  examples: [[
    { user: 'user', content: { text: 'Accept AXLE task abc-123' } },
    { user: 'agent', content: { text: 'Accepted task abc-123. Reward: 50000000 lamports. Deadline: 2026-02-20T00:00:00.000Z.' } },
  ]],
};

const deliverTaskAction: Action = {
  name: 'AXLE_DELIVER_TASK',
  description: 'Submit results for a task on the AXLE Protocol network',
  similes: ['deliver task', 'submit task', 'complete task', 'send results', 'finish task'],
  handler: async (runtime, message) => {
    const sdk = createAxleSDK(runtime);
    const taskId = message.content.taskId;
    const result = message.content.result;

    if (!taskId || !result) {
      return { success: false, message: 'Please provide both taskId and result.' };
    }

    const task = await sdk.deliverTask(taskId, result);
    return {
      success: true,
      task,
      message: `Delivered results for task ${taskId}. Result hash stored on-chain. Awaiting requester approval.`,
    };
  },
  validate: async (runtime) => hasWallet(runtime),
  examples: [[
    { user: 'user', content: { text: 'Deliver results for AXLE task abc-123' } },
    { user: 'agent', content: { text: 'Delivered results for task abc-123. Result hash stored on-chain. Awaiting requester approval.' } },
  ]],
};

const createTaskAction: Action = {
  name: 'AXLE_CREATE_TASK',
  description: 'Create a new task with escrow funding on the AXLE Protocol network',
  similes: ['create task', 'post task', 'new task', 'submit task request', 'request work'],
  handler: async (runtime, message) => {
    const sdk = createAxleSDK(runtime);
    const description = message.content.description || message.content.text;
    const capability = message.content.capability || 'general';
    const reward = message.content.reward || 50_000_000;
    const deadline = message.content.deadline
      ? new Date(message.content.deadline)
      : new Date(Date.now() + 86400_000);

    const task = await sdk.createTask({ description, capability, reward, deadline });
    return {
      success: true,
      task,
      message: `Created task ${task.id}. Capability: ${task.capability}. Reward: ${task.reward} lamports escrowed. Deadline: ${task.deadline.toISOString()}.`,
    };
  },
  validate: async (runtime) => hasWallet(runtime),
  examples: [[
    { user: 'user', content: { text: 'Create an AXLE task for web scraping with 0.05 SOL reward' } },
    { user: 'agent', content: { text: 'Created task abc-123. Capability: scraping. Reward: 50000000 lamports escrowed. Deadline: 2026-02-09.' } },
  ]],
};

const getReputationAction: Action = {
  name: 'AXLE_GET_REPUTATION',
  description: 'Query an agent\'s on-chain reputation score on the AXLE Protocol network',
  similes: ['get reputation', 'check reputation', 'agent score', 'agent rating', 'show reputation'],
  handler: async (runtime, message) => {
    const sdk = createAxleSDK(runtime);
    const agentPublicKey = message.content.agentPublicKey;

    if (!agentPublicKey) {
      return { success: false, message: 'Please provide an agentPublicKey to look up.' };
    }

    const agent = await sdk.getAgent(agentPublicKey);
    if (!agent) {
      return { reputation: 0, agent: null, message: `No agent found for public key ${agentPublicKey}.` };
    }

    return {
      reputation: agent.reputation,
      agent,
      message: `Agent "${agent.nodeId}" — Reputation: ${agent.reputation}, Tasks completed: ${agent.tasksCompleted}, Tasks failed: ${agent.tasksFailed}.`,
    };
  },
  validate: async (runtime) => hasWallet(runtime),
  examples: [[
    { user: 'user', content: { text: 'What is the reputation of AXLE agent 7xKXt...?' } },
    { user: 'agent', content: { text: 'Agent "scraper-01" — Reputation: 150, Tasks completed: 5, Tasks failed: 0.' } },
  ]],
};

// ── Plugin Export ──

export const axlePlugin: Plugin = {
  name: 'axle-protocol',
  description: 'AXLE Protocol plugin for Eliza — on-chain task settlement for AI agents on Solana',
  actions: [
    registerAction,
    getTasksAction,
    acceptTaskAction,
    deliverTaskAction,
    createTaskAction,
    getReputationAction,
  ],
};

export default axlePlugin;
