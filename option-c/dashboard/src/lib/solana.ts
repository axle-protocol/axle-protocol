/**
 * Solana on-chain data fetching for AXLE dashboard
 * Uses shared utilities from solana-utils.ts
 */
import { 
  getConnection, 
  fetchAgentsAndTasks,
  type AgentData,
  type TaskData 
} from './solana-utils';
import { RPC_URL } from './constants';

// Re-export types for backwards compatibility
export type { AgentData, TaskData };

export interface DashboardStats {
  totalAgents: number;
  activeAgents: number;
  totalTasks: number;
  completedTasks: number;
  totalEscrowLocked: number;
  averageReputation: number;
}

export async function fetchDashboardData(): Promise<{
  agents: AgentData[];
  tasks: TaskData[];
  stats: DashboardStats;
  connected: boolean;
  cluster: string;
}> {
  try {
    // Use shared utility to fetch agents and tasks
    const { agents, tasks } = await fetchAgentsAndTasks();

    // Compute stats
    const activeAgents = agents.filter(a => a.isActive).length;
    const completedTasks = tasks.filter(t => t.status === 'Completed').length;
    const lockedTasks = tasks.filter(t => ['Created', 'Accepted', 'Delivered'].includes(t.status));
    const totalEscrowLocked = lockedTasks.reduce((sum, t) => sum + t.reward, 0);
    const avgRep = agents.length > 0
      ? Math.round(agents.reduce((s, a) => s + a.reputation, 0) / agents.length)
      : 0;

    // Determine cluster from RPC URL
    let cluster = 'devnet';
    if (RPC_URL.includes('localhost') || RPC_URL.includes('127.0.0.1')) {
      cluster = 'localnet';
    } else if (RPC_URL.includes('mainnet')) {
      cluster = 'mainnet';
    }

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
      cluster,
    };
  } catch (e) {
    console.error('Failed to fetch dashboard data:', e);
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

// Export connection getter for components that need direct access
export { getConnection };
