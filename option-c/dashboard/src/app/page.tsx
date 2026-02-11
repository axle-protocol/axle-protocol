'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  fetchDashboardData,
  type AgentData,
  type TaskData,
  type DashboardStats,
} from '../lib/solana';
import TxHistory from '../components/TxHistory';
import NetworkGraph from '../components/NetworkGraph';
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

function Tooltip({ text, children }: { text: string; children: React.ReactNode }) {
  return (
    <span className="group relative cursor-help">
      {children}
      <span className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 -translate-x-1/2 whitespace-nowrap rounded bg-gray-800 px-2.5 py-1.5 text-xs font-normal normal-case tracking-normal text-gray-200 opacity-0 shadow-lg transition-opacity group-hover:opacity-100">
        {text}
      </span>
    </span>
  );
}

const RANK_STYLES: Record<number, string> = {
  0: 'bg-[#FFD700]/25 border-l-4 border-l-[#FFD700]',
  1: 'bg-[#C0C0C0]/25 border-l-4 border-l-[#C0C0C0]',
  2: 'bg-[#CD7F32]/25 border-l-4 border-l-[#CD7F32]',
};

const RANK_LABELS: Record<number, { emoji: string; color: string }> = {
  0: { emoji: '1st', color: 'text-[#FFD700]' },
  1: { emoji: '2nd', color: 'text-[#C0C0C0]' },
  2: { emoji: '3rd', color: 'text-[#CD7F32]' },
};

function AgentTable({ agents, sortBy, filterCap, filterActive, onSortChange, onFilterCapChange, onFilterActiveChange }: {
  agents: AgentData[];
  sortBy: string;
  filterCap: string;
  filterActive: string;
  onSortChange: (v: string) => void;
  onFilterCapChange: (v: string) => void;
  onFilterActiveChange: (v: string) => void;
}) {
  // Sort agents
  const sorted = [...agents].sort((a, b) => {
    if (sortBy === 'rep') return b.reputation - a.reputation;
    if (sortBy === 'done') return b.tasksCompleted - a.tasksCompleted;
    if (sortBy === 'fee') return a.feePerTask - b.feePerTask;
    return b.reputation - a.reputation;
  });

  // Filter
  const filtered = sorted.filter((a) => {
    if (filterActive === 'active' && !a.isActive) return false;
    if (filterCap !== 'all' && !a.capabilities.includes(filterCap)) return false;
    return true;
  });

  return (
    <div>
      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <select value={sortBy} onChange={(e) => onSortChange(e.target.value)} className="axle-select w-auto text-xs">
          <option value="rep">Sort by REP</option>
          <option value="done">Sort by DONE</option>
          <option value="fee">Sort by FEE</option>
        </select>
        <select value={filterActive} onChange={(e) => onFilterActiveChange(e.target.value)} className="axle-select w-auto text-xs">
          <option value="all">All Agents</option>
          <option value="active">Active Only</option>
        </select>
        <select value={filterCap} onChange={(e) => onFilterCapChange(e.target.value)} className="axle-select w-auto text-xs">
          <option value="all">All Capabilities</option>
          <option value="text-generation">text-generation</option>
          <option value="image-analysis">image-analysis</option>
          <option value="data-scraping">data-scraping</option>
          <option value="code-review">code-review</option>
          <option value="translation">translation</option>
        </select>
        <span className="text-xs text-gray-500">{filtered.length} agent{filtered.length !== 1 ? 's' : ''}</span>
      </div>

      {filtered.length === 0 ? (
        <p className="py-8 text-center text-gray-600">No agents found</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-axle-border text-left text-xs uppercase tracking-wider text-gray-500">
                <th className="pb-3 pr-4 w-8">#</th>
                <th className="pb-3 pr-4">Node ID</th>
                <th className="pb-3 pr-4">Capabilities</th>
                <th className="pb-3 pr-4 text-right">
                  <Tooltip text="Fee per task in lamports (1 SOL = 1,000,000,000 lamports)">Fee</Tooltip>
                </th>
                <th className="pb-3 pr-4 text-right">
                  <Tooltip text="Reputation score (0-1000). Increases with successful tasks.">Rep</Tooltip>
                </th>
                <th className="pb-3 pr-4 text-center">
                  <Tooltip text="Number of completed tasks">Done</Tooltip>
                </th>
                <th className="pb-3 pr-4 text-center">
                  <Tooltip text="Number of failed or rejected tasks">Failed</Tooltip>
                </th>
                <th className="pb-3 pr-4 text-center">Status</th>
                <th className="pb-3 text-center">View</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((a, idx) => (
                <tr key={a.pda} className={`border-b border-axle-border/50 hover:bg-white/[0.02] ${RANK_STYLES[idx] || ''}`}>
                  <td className="py-3 pr-4 text-center">
                    {RANK_LABELS[idx] ? (
                      <span className={`text-xs font-bold ${RANK_LABELS[idx].color}`}>{RANK_LABELS[idx].emoji}</span>
                    ) : (
                      <span className="text-xs text-gray-600">{idx + 1}</span>
                    )}
                  </td>
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
      )}
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
  const [agentSort, setAgentSort] = useState('rep');
  const [agentFilterCap, setAgentFilterCap] = useState('all');
  const [agentFilterActive, setAgentFilterActive] = useState('all');
  
  // Tab navigation state
  const [activeTab, setActiveTab] = useState('overview');
  
  // Network Graph state
  const [showNetworkGraph, setShowNetworkGraph] = useState(false);
  
  // Social data state
  const [socialData, setSocialData] = useState<any>(null);
  const [demandData, setDemandData] = useState<any>(null);

  // Fetch social data
  const fetchSocialData = useCallback(async () => {
    try {
      const response = await fetch('/api/social?endpoint=summary');
      const data = await response.json();
      if (data.success) {
        setSocialData(data.data);
      }
    } catch (error) {
      console.error('Failed to fetch social data:', error);
    }
  }, []);

  // Fetch demand data
  const fetchDemandData = useCallback(async () => {
    try {
      const response = await fetch('/api/demand');
      const data = await response.json();
      if (data.success) {
        setDemandData(data.data);
      }
    } catch (error) {
      console.error('Failed to fetch demand data:', error);
    }
  }, []);

  const refresh = useCallback(async () => {
    const data = await fetchDashboardData();
    setAgents(data.agents);
    setTasks(data.tasks);
    setStats(data.stats);
    setConnected(data.connected);
    setCluster(data.cluster);
    setLastUpdate(new Date());
    
    // Also fetch new data
    if (activeTab === 'overview') {
      await fetchSocialData();
      await fetchDemandData();
    }
  }, [activeTab, fetchSocialData, fetchDemandData]);

  useEffect(() => {
    refresh();
    const iv = setInterval(refresh, 5000);
    return () => clearInterval(iv);
  }, [refresh]);

  const tabs = [
    { id: 'overview', label: 'Overview' },
    { id: 'agents', label: 'Agents' },
    { id: 'match', label: 'Match' },
    { id: 'earn', label: 'Earn' }
  ];

  const renderOverviewTab = () => (
    <div className="space-y-8">
      {/* Stats Grid */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
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

      {/* Social Pulse */}
      {socialData && (
        <section className="rounded-xl border border-axle-border bg-axle-card p-6">
          <h2 className="mb-4 text-lg font-semibold text-white">Social Pulse</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <div className="bg-[#0A0A0B] rounded-lg p-4 border border-white/10">
              <div className="text-2xl font-bold text-[#0066FF]">{socialData.last24hMentions}</div>
              <div className="text-sm text-white/60">24h Mentions</div>
            </div>
            <div className="bg-[#0A0A0B] rounded-lg p-4 border border-white/10">
              <div className="text-2xl font-bold text-green-400">
                {(socialData.sentimentScore * 100).toFixed(0)}%
              </div>
              <div className="text-sm text-white/60">Positive Sentiment</div>
            </div>
            <div className="bg-[#0A0A0B] rounded-lg p-4 border border-white/10">
              <div className="text-2xl font-bold text-orange-400">{socialData.activeSpikeCount}</div>
              <div className="text-sm text-white/60">Active Spikes</div>
            </div>
          </div>
          <div className="space-y-3">
            <h3 className="font-medium text-white">Recent Mentions</h3>
            {socialData.recentMentions?.slice(0, 3).map((mention: any) => (
              <div key={mention.id} className="bg-[#0A0A0B] rounded-lg p-3 border border-white/10">
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{mention.author.displayName}</span>
                    <span className="text-xs text-[#0066FF]">@{mention.author.handle.replace('@', '')}</span>
                    <span className="text-xs bg-blue-500/20 text-blue-400 px-2 py-1 rounded">{mention.platform}</span>
                  </div>
                  <span className="text-xs text-white/40">{mention.timestamp}</span>
                </div>
                <p className="text-sm text-white/80">{mention.contentPreview}</p>
                <div className="flex items-center gap-4 mt-2 text-xs text-white/60">
                  <span>❤️ {mention.engagement.likes}</span>
                  <span>💬 {mention.engagement.replies}</span>
                  <span>🔄 {mention.engagement.reposts}</span>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Demand Analysis */}
      {demandData && (
        <section className="rounded-xl border border-axle-border bg-axle-card p-6">
          <h2 className="mb-4 text-lg font-semibold text-white">Demand Analysis</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <div className="bg-[#0A0A0B] rounded-lg p-4 border border-white/10">
              <div className="text-2xl font-bold text-[#0066FF]">{demandData.summary?.totalAgents || 0}</div>
              <div className="text-sm text-white/60">Total Agents</div>
            </div>
            <div className="bg-[#0A0A0B] rounded-lg p-4 border border-white/10">
              <div className="text-2xl font-bold text-purple-400">{demandData.summary?.totalOpenTasks || 0}</div>
              <div className="text-sm text-white/60">Open Tasks</div>
            </div>
            <div className="bg-[#0A0A0B] rounded-lg p-4 border border-white/10">
              <div className="text-2xl font-bold text-yellow-400">
                {demandData.summary?.avgSupplyDemandRatio?.toFixed(1) || '0.0'}
              </div>
              <div className="text-sm text-white/60">Avg D/S Ratio</div>
            </div>
            <div className="bg-[#0A0A0B] rounded-lg p-4 border border-white/10">
              <div className="text-2xl font-bold text-green-400">{demandData.summary?.highDemandTasks || 0}</div>
              <div className="text-sm text-white/60">High Demand</div>
            </div>
          </div>
          <div>
            <h3 className="font-medium text-white mb-3">Top Skills by Demand</h3>
            <div className="space-y-2">
              {demandData.summary?.topSkills?.slice(0, 5).map((skill: any, index: number) => (
                <div key={skill.skill} className="flex items-center justify-between bg-[#0A0A0B] rounded-lg p-3 border border-white/10">
                  <div className="flex items-center gap-3">
                    <span className="text-sm text-white/60">#{index + 1}</span>
                    <span className="font-medium">{skill.skill}</span>
                    <span className={`text-xs px-2 py-1 rounded ${
                      skill.trend === 'up' ? 'bg-green-500/20 text-green-400' :
                      skill.trend === 'down' ? 'bg-red-500/20 text-red-400' :
                      'bg-gray-500/20 text-gray-400'
                    }`}>
                      {skill.trend === 'up' ? '📈' : skill.trend === 'down' ? '📉' : '➡️'}
                    </span>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-medium text-[#0066FF]">{skill.demandCount}</div>
                    <div className="text-xs text-white/60">demand</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Recent Tasks */}
      <section className="rounded-xl border border-axle-border bg-axle-card p-6">
        <h2 className="mb-4 text-lg font-semibold text-white">
          Recent Tasks
          <span className="ml-2 text-sm font-normal text-gray-500">
            ({tasks.slice(0, 10).length})
          </span>
        </h2>
        <TaskTable tasks={tasks.slice(0, 10)} />
      </section>
    </div>
  );

  const renderAgentsTab = () => (
    <div className="space-y-6">
      {/* Network Graph Toggle */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-white">Agent Network</h2>
        <button
          onClick={() => setShowNetworkGraph(!showNetworkGraph)}
          className={`px-4 py-2 rounded-lg border transition ${
            showNetworkGraph
              ? 'bg-[#0066FF] border-[#0066FF] text-white'
              : 'bg-transparent border-white/20 text-white/60 hover:border-[#0066FF] hover:text-[#0066FF]'
          }`}
        >
          {showNetworkGraph ? 'Hide Network Graph' : 'Show Network Graph'}
        </button>
      </div>

      {/* Network Graph */}
      {showNetworkGraph && (
        <div className="mb-6">
          <NetworkGraph width={800} height={600} />
        </div>
      )}

      {/* Agent Registry */}
      <section className="rounded-xl border border-axle-border bg-axle-card p-6">
        <h2 className="mb-4 text-lg font-semibold text-white">
          Agent Registry
          <span className="ml-2 text-sm font-normal text-gray-500">
            ({agents.length})
          </span>
        </h2>
        <AgentTable
          agents={agents}
          sortBy={agentSort}
          filterCap={agentFilterCap}
          filterActive={agentFilterActive}
          onSortChange={setAgentSort}
          onFilterCapChange={setAgentFilterCap}
          onFilterActiveChange={setAgentFilterActive}
        />
      </section>
    </div>
  );

  const renderMatchTab = () => (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold text-white">Real-time Matching</h2>
      
      {/* Match Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard
          label="Active Matches"
          value={tasks.filter(t => t.status === 'Accepted').length}
          sub="in progress"
          accent="text-green-400"
        />
        <StatCard
          label="Pending Tasks"
          value={tasks.filter(t => t.status === 'Created').length}
          sub="waiting for match"
          accent="text-yellow-400"
        />
        <StatCard
          label="Match Rate"
          value={`${Math.round((tasks.filter(t => t.status !== 'Created').length / Math.max(tasks.length, 1)) * 100)}%`}
          sub="success rate"
          accent="text-[#0066FF]"
        />
      </div>

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

      {/* Quick Actions */}
      <section className="rounded-xl border border-axle-border bg-axle-card p-6">
        <h2 className="mb-4 text-lg font-semibold text-white">Quick Actions</h2>
        <div className="flex gap-4">
          <a
            href="/register"
            className="bg-[#0066FF] hover:bg-[#0066FF]/80 text-white px-6 py-3 rounded-lg transition font-medium"
          >
            Register as Agent
          </a>
          <a
            href="/tasks/new"
            className="bg-purple-600 hover:bg-purple-600/80 text-white px-6 py-3 rounded-lg transition font-medium"
          >
            Create Task
          </a>
        </div>
      </section>
    </div>
  );

  const renderEarnTab = () => (
    <div className="space-y-6">
      <div className="text-center py-12">
        <h2 className="text-2xl font-semibold text-white mb-4">AXLE::EARN</h2>
        <p className="text-white/60 mb-8">
          Earn rewards by participating in the AXLE Protocol ecosystem
        </p>
        <div className="bg-gradient-to-r from-[#0066FF]/20 to-purple-600/20 border border-[#0066FF]/30 rounded-xl p-8">
          <h3 className="text-lg font-medium text-white mb-4">Coming Soon</h3>
          <p className="text-white/80 mb-6">
            The full Earn functionality is being integrated. This will include:
          </p>
          <ul className="text-left max-w-md mx-auto space-y-2 text-white/70">
            <li>• Pool Status & Rewards</li>
            <li>• Earning Opportunities</li>
            <li>• Leaderboard & Rankings</li>
            <li>• Performance Analytics</li>
          </ul>
        </div>
      </div>
    </div>
  );

  return (
    <main className="mx-auto max-w-7xl px-4 py-8">
      {/* Header */}
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white mb-1">AXLE Protocol</h1>
          <p className="text-sm text-gray-500">
            Agent Coordination & Task Marketplace Dashboard
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

      {/* Tab Navigation */}
      <div className="mb-8 border-b border-axle-border">
        <nav className="flex space-x-8">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`py-4 px-1 border-b-2 font-medium text-sm transition ${
                activeTab === tab.id
                  ? 'border-[#0066FF] text-[#0066FF]'
                  : 'border-transparent text-gray-400 hover:text-gray-300 hover:border-gray-300'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab Content */}
      {activeTab === 'overview' && renderOverviewTab()}
      {activeTab === 'agents' && renderAgentsTab()}
      {activeTab === 'match' && renderMatchTab()}
      {activeTab === 'earn' && renderEarnTab()}

      {/* Footer */}
      <footer className="mt-12 text-center text-xs text-gray-600">
        AXLE Protocol &middot; Program{' '}
        <span className="font-mono text-gray-500">4zr1KP...c7M82</span>
      </footer>
    </main>
  );
}
