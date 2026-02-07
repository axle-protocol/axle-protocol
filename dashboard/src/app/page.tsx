'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  fetchDashboardData,
  type AgentData,
  type TaskData,
  type DashboardStats,
} from '../lib/solana';
import TxHistory from '../components/TxHistory';
import { solscanAccountUrl } from '../lib/constants';

const STATUS_COLORS: Record<string, string> = {
  Created: 'bg-blue-500/20 text-blue-400',
  Accepted: 'bg-yellow-500/20 text-yellow-400',
  Delivered: 'bg-purple-500/20 text-purple-400',
  Completed: 'bg-green-500/20 text-green-400',
  Cancelled: 'bg-gray-500/20 text-gray-400',
  Disputed: 'bg-red-500/20 text-red-400',
  TimedOut: 'bg-red-500/20 text-red-400',
};

function StatCard({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string | number;
  sub?: string;
  accent?: string;
}) {
  return (
    <div className="glow-border rounded-xl bg-axle-card p-5">
      <p className="text-xs uppercase tracking-wider text-gray-500">{label}</p>
      <p className={`mt-1 text-3xl font-bold ${accent || 'text-white'}`}>{value}</p>
      {sub && <p className="mt-1 text-xs text-gray-500">{sub}</p>}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_COLORS[status] || 'bg-gray-600 text-gray-300'}`}
    >
      {status}
    </span>
  );
}

function ConnectionDot({ connected, cluster }: { connected: boolean; cluster: string }) {
  return (
    <div className="flex items-center gap-2">
      <span
        className={`inline-block h-2.5 w-2.5 rounded-full ${connected ? 'bg-axle-green pulse-green' : 'bg-red-500'}`}
      />
      <span className="text-sm text-gray-400">
        {connected ? cluster : 'disconnected'}
      </span>
    </div>
  );
}

function AgentTable({ agents }: { agents: AgentData[] }) {
  if (agents.length === 0) {
    return <p className="py-8 text-center text-gray-600">No agents registered</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-axle-border text-left text-xs uppercase tracking-wider text-gray-500">
            <th className="pb-3 pr-4">Node ID</th>
            <th className="pb-3 pr-4">Capabilities</th>
            <th className="pb-3 pr-4 text-right">Fee</th>
            <th className="pb-3 pr-4 text-right">Rep</th>
            <th className="pb-3 pr-4 text-center">Done</th>
            <th className="pb-3 pr-4 text-center">Failed</th>
            <th className="pb-3 pr-4 text-center">Status</th>
            <th className="pb-3 text-center">View</th>
          </tr>
        </thead>
        <tbody>
          {agents.map((a) => (
            <tr key={a.pda} className="border-b border-axle-border/50 hover:bg-white/[0.02]">
              <td className="py-3 pr-4 font-mono text-axle-accent">{a.nodeId}</td>
              <td className="py-3 pr-4">
                <div className="flex flex-wrap gap-1">
                  {a.capabilities.map((c) => (
                    <span
                      key={c}
                      className="rounded bg-axle-purple/20 px-1.5 py-0.5 text-xs text-axle-purple"
                    >
                      {c}
                    </span>
                  ))}
                </div>
              </td>
              <td className="py-3 pr-4 text-right font-mono">{a.feePerTask}</td>
              <td className="py-3 pr-4 text-right">
                <span className={a.reputation >= 100 ? 'text-axle-green' : 'text-axle-yellow'}>
                  {a.reputation}
                </span>
              </td>
              <td className="py-3 pr-4 text-center text-axle-green">{a.tasksCompleted}</td>
              <td className="py-3 pr-4 text-center text-axle-red">{a.tasksFailed}</td>
              <td className="py-3 pr-4 text-center">
                <span
                  className={`inline-block h-2 w-2 rounded-full ${a.isActive ? 'bg-axle-green' : 'bg-gray-600'}`}
                />
              </td>
              <td className="py-3 text-center">
                <a
                  href={solscanAccountUrl(a.pda)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-axle-accent hover:underline"
                >
                  Solscan ↗
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TaskTable({ tasks }: { tasks: TaskData[] }) {
  if (tasks.length === 0) {
    return <p className="py-8 text-center text-gray-600">No tasks found</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-axle-border text-left text-xs uppercase tracking-wider text-gray-500">
            <th className="pb-3 pr-4">ID</th>
            <th className="pb-3 pr-4">Capability</th>
            <th className="pb-3 pr-4">Requester</th>
            <th className="pb-3 pr-4">Provider</th>
            <th className="pb-3 pr-4 text-right">Reward</th>
            <th className="pb-3 pr-4">Status</th>
            <th className="pb-3 pr-4">Flow</th>
            <th className="pb-3 text-center">View</th>
          </tr>
        </thead>
        <tbody>
          {tasks.map((t) => (
            <tr key={t.pda} className="border-b border-axle-border/50 hover:bg-white/[0.02]">
              <td className="py-3 pr-4 font-mono text-xs text-gray-400">{t.id}</td>
              <td className="py-3 pr-4">
                <span className="rounded bg-axle-purple/20 px-1.5 py-0.5 text-xs text-axle-purple">
                  {t.requiredCapability}
                </span>
              </td>
              <td className="py-3 pr-4 font-mono text-xs">{t.requester}</td>
              <td className="py-3 pr-4 font-mono text-xs">{t.provider || '—'}</td>
              <td className="py-3 pr-4 text-right font-mono text-axle-accent">
                {t.reward.toFixed(4)} SOL
              </td>
              <td className="py-3 pr-4">
                <StatusBadge status={t.status} />
              </td>
              <td className="py-3 pr-4">
                <TaskFlowArrow status={t.status} />
              </td>
              <td className="py-3 text-center">
                <a
                  href={solscanAccountUrl(t.pda)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-axle-accent hover:underline"
                >
                  Solscan ↗
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TaskFlowArrow({ status }: { status: string }) {
  const steps = ['Created', 'Accepted', 'Delivered', 'Completed'];
  const idx = steps.indexOf(status);
  const isFinal = ['Cancelled', 'TimedOut', 'Disputed'].includes(status);
  return (
    <div className="flex items-center gap-0.5">
      {steps.map((s, i) => (
        <div key={s} className="flex items-center">
          <div
            className={`h-1.5 w-1.5 rounded-full ${
              isFinal
                ? 'bg-red-500/50'
                : i <= idx
                  ? 'bg-axle-green'
                  : 'bg-gray-700'
            }`}
          />
          {i < steps.length - 1 && (
            <div
              className={`mx-0.5 h-px w-3 ${
                isFinal
                  ? 'bg-red-500/30'
                  : i < idx
                    ? 'bg-axle-green/60'
                    : 'bg-gray-700'
              }`}
            />
          )}
        </div>
      ))}
    </div>
  );
}

export default function DashboardPage() {
  const [agents, setAgents] = useState<AgentData[]>([]);
  const [tasks, setTasks] = useState<TaskData[]>([]);
  const [stats, setStats] = useState<DashboardStats>({
    totalAgents: 0,
    activeAgents: 0,
    totalTasks: 0,
    completedTasks: 0,
    totalEscrowLocked: 0,
    averageReputation: 0,
  });
  const [connected, setConnected] = useState(false);
  const [cluster, setCluster] = useState('disconnected');
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  const refresh = useCallback(async () => {
    const data = await fetchDashboardData();
    setAgents(data.agents);
    setTasks(data.tasks);
    setStats(data.stats);
    setConnected(data.connected);
    setCluster(data.cluster);
    setLastUpdate(new Date());
  }, []);

  useEffect(() => {
    refresh();
    const iv = setInterval(refresh, 5000);
    return () => clearInterval(iv);
  }, [refresh]);

  return (
    <main className="mx-auto max-w-7xl px-4 py-8">
      {/* Header */}
      <div className="mb-8 flex items-center justify-between">
        <div>
          <p className="text-sm text-gray-500">
            Protocol for Agent Coordination & Tasks — God View
          </p>
        </div>
        <div className="flex items-center gap-4">
          <ConnectionDot connected={connected} cluster={cluster} />
          {lastUpdate && (
            <span className="text-xs text-gray-600">
              {lastUpdate.toLocaleTimeString()}
            </span>
          )}
          <button
            onClick={refresh}
            className="rounded-lg border border-axle-border bg-axle-card px-3 py-1.5 text-xs text-gray-400 transition hover:border-axle-accent hover:text-axle-accent"
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="Agents"
          value={stats.totalAgents}
          sub={`${stats.activeAgents} active`}
          accent="text-axle-accent"
        />
        <StatCard
          label="Tasks"
          value={stats.totalTasks}
          sub={`${stats.completedTasks} completed`}
          accent="text-axle-purple"
        />
        <StatCard
          label="Escrow Locked"
          value={`${stats.totalEscrowLocked.toFixed(4)}`}
          sub="SOL"
          accent="text-axle-yellow"
        />
        <StatCard
          label="Avg Reputation"
          value={stats.averageReputation}
          sub="/ 1000"
          accent="text-axle-green"
        />
      </div>

      {/* Agent Registry */}
      <section className="mb-8 rounded-xl border border-axle-border bg-axle-card p-6">
        <h2 className="mb-4 text-lg font-semibold text-white">
          Agent Registry
          <span className="ml-2 text-sm font-normal text-gray-500">
            ({agents.length})
          </span>
        </h2>
        <AgentTable agents={agents} />
      </section>

      {/* Task Feed */}
      <section className="rounded-xl border border-axle-border bg-axle-card p-6">
        <h2 className="mb-4 text-lg font-semibold text-white">
          Task Feed
          <span className="ml-2 text-sm font-normal text-gray-500">
            ({tasks.length})
          </span>
        </h2>
        <TaskTable tasks={tasks} />
      </section>

      {/* Transaction History */}
      <section className="mt-8 rounded-xl border border-axle-border bg-axle-card p-6">
        <h2 className="mb-4 text-lg font-semibold text-white">
          Recent Transactions
        </h2>
        <TxHistory />
      </section>

      {/* Footer */}
      <footer className="mt-8 text-center text-xs text-gray-600">
        AXLE Protocol &middot; Program{' '}
        <span className="font-mono text-gray-500">4zr1KP...c7M82</span>
      </footer>
    </main>
  );
}
