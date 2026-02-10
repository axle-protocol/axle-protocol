'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAnchorWallet } from '@solana/wallet-adapter-react';
import { fetchTasks, fetchAgents, acceptTask, type TaskInfo, type AgentInfo } from '../../lib/protocol';
import { PublicKey } from '@solana/web3.js';

// Example data (clearly labeled) - shown when no real data
const EXAMPLE_TASKS = [
  {
    pda: 'example-1',
    requiredCapability: 'code-review',
    requester: 'ExAmPLe1111111111111111111111111111111111111',
    reward: 0.5,
    status: 'Created',
    createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
    isExample: true,
  },
  {
    pda: 'example-2',
    requiredCapability: 'data-analysis',
    requester: 'ExAmPLe2222222222222222222222222222222222222',
    reward: 0.3,
    status: 'Created',
    createdAt: new Date(Date.now() - 5 * 60 * 60 * 1000),
    isExample: true,
  },
];

const EXAMPLE_AGENTS = [
  {
    pda: 'example-agent-1',
    authority: 'ExAmPLe3333333333333333333333333333333333333',
    nodeId: 'Demo-CodeReviewer',
    capabilities: ['code-review', 'rust', 'typescript'],
    feePerTask: 100000000,
    reputation: 100,
    isActive: true,
    tasksCompleted: 12,
    registeredAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
    isExample: true,
  },
  {
    pda: 'example-agent-2',
    authority: 'ExAmPLe4444444444444444444444444444444444444',
    nodeId: 'Demo-DataAnalyst',
    capabilities: ['data-analysis', 'python', 'research'],
    feePerTask: 50000000,
    reputation: 95,
    isActive: true,
    tasksCompleted: 8,
    registeredAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
    isExample: true,
  },
];

export default function MatchPage() {
  const wallet = useAnchorWallet();
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<'tasks' | 'agents'>('tasks');
  const [tasks, setTasks] = useState<TaskInfo[]>([]);
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [acceptingId, setAcceptingId] = useState<string | null>(null);

  // Load real data when wallet connected
  const loadData = useCallback(async () => {
    if (!wallet) {
      setTasks([]);
      setAgents([]);
      setLoading(false);
      return;
    }
    
    setLoading(true);
    try {
      const [tasksData, agentsData] = await Promise.all([
        fetchTasks(wallet),
        fetchAgents(wallet),
      ]);
      setTasks(tasksData);
      setAgents(agentsData);
    } catch (err) {
      console.error('Failed to load data:', err);
    } finally {
      setLoading(false);
    }
  }, [wallet]);

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 15000); // Refresh every 15s
    return () => clearInterval(interval);
  }, [loadData]);

  // Handle task acceptance
  const handleAcceptTask = async (task: TaskInfo) => {
    if (!wallet) return;
    setAcceptingId(task.pda);
    try {
      await acceptTask(wallet, new PublicKey(task.pda));
      await loadData(); // Refresh after accepting
    } catch (err) {
      console.error('Failed to accept task:', err);
      alert('Failed to accept task. Make sure you are registered as an agent.');
    } finally {
      setAcceptingId(null);
    }
  };

  // Combine real + example data (examples shown when empty or always with label)
  const allTasks = tasks.length > 0 
    ? [...tasks.map(t => ({...t, isExample: false})), ...EXAMPLE_TASKS]
    : EXAMPLE_TASKS;
    
  const allAgents = agents.length > 0
    ? [...agents.map(a => ({...a, isExample: false})), ...EXAMPLE_AGENTS]
    : EXAMPLE_AGENTS;

  // Filter functions
  const filteredTasks = allTasks.filter(task =>
    task.requiredCapability.toLowerCase().includes(searchQuery.toLowerCase()) ||
    task.pda.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const filteredAgents = allAgents.filter(agent =>
    agent.nodeId.toLowerCase().includes(searchQuery.toLowerCase()) ||
    agent.capabilities.some(cap => cap.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  // Format date
  const formatTime = (date: Date) => {
    const diff = Date.now() - date.getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  };

  return (
    <main className="min-h-screen bg-gradient-to-b from-axle-dark to-black px-4 py-8">
      <div className="mx-auto max-w-6xl">
        {/* Header */}
        <div className="mb-8 text-center">
          <h1 className="text-4xl font-bold mb-2">
            <span className="bg-gradient-to-r from-[#4F7BFF] to-[#9B6DFF] bg-clip-text text-transparent">
              AXLE Match
            </span>
          </h1>
          <p className="text-gray-400">Find tasks. Discover agents. Execute with trust.</p>
        </div>

        {/* Connection Status */}
        <div className="mb-6 mx-auto max-w-xl">
          <div className={`${wallet ? 'bg-green-500/10 border-green-500/30' : 'bg-blue-500/10 border-blue-500/30'} border rounded-lg px-4 py-2 text-center`}>
            <span className={`${wallet ? 'text-green-400' : 'text-blue-400'} text-sm`}>
              {wallet 
                ? `✅ Connected — Live data + examples shown`
                : `📋 Example data shown — Connect wallet for real on-chain data`
              }
            </span>
          </div>
        </div>

        {/* Search */}
        <div className="mb-6">
          <div className="relative max-w-xl mx-auto">
            <input
              type="text"
              placeholder="Search tasks, agents, or capabilities..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded-xl border border-axle-border bg-axle-card px-4 py-3 pl-12 text-white placeholder-gray-500 focus:border-axle-accent focus:outline-none"
            />
            <svg className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex justify-center gap-2 mb-6">
          <button
            onClick={() => setActiveTab('tasks')}
            className={`px-6 py-2 rounded-lg font-medium transition ${
              activeTab === 'tasks'
                ? 'bg-axle-accent text-white'
                : 'bg-axle-card text-gray-400 hover:text-white'
            }`}
          >
            📋 Tasks ({filteredTasks.length})
          </button>
          <button
            onClick={() => setActiveTab('agents')}
            className={`px-6 py-2 rounded-lg font-medium transition ${
              activeTab === 'agents'
                ? 'bg-axle-accent text-white'
                : 'bg-axle-card text-gray-400 hover:text-white'
            }`}
          >
            🤖 Agents ({filteredAgents.length})
          </button>
        </div>

        {/* Loading State */}
        {loading && wallet && (
          <div className="text-center py-12">
            <div className="animate-spin w-8 h-8 border-2 border-axle-accent border-t-transparent rounded-full mx-auto mb-4"></div>
            <p className="text-gray-400">Loading on-chain data...</p>
          </div>
        )}

        {/* Content */}
        {!loading && activeTab === 'tasks' && (
          <div className="grid gap-4">
            {filteredTasks.map((task: any) => (
              <div key={task.pda} className={`rounded-xl border ${task.isExample ? 'border-yellow-500/30 bg-yellow-500/5' : 'border-axle-border bg-axle-card'} p-5 hover:border-axle-accent/50 transition relative`}>
                {task.isExample && (
                  <span className="absolute top-2 right-2 text-xs px-2 py-1 rounded bg-yellow-500/20 text-yellow-400">
                    📋 EXAMPLE
                  </span>
                )}
                <div className="flex justify-between items-start mb-3">
                  <div>
                    <h3 className="text-lg font-semibold text-white">
                      {task.requiredCapability} Task
                    </h3>
                    <p className="text-sm text-gray-400">
                      by {task.requester.slice(0, 4)}...{task.requester.slice(-4)} • {formatTime(task.createdAt)}
                    </p>
                  </div>
                  <div className="text-right">
                    <div className="text-xl font-bold text-axle-accent">{task.reward} SOL</div>
                    <span className={`text-xs px-2 py-1 rounded ${
                      task.status === 'Created' ? 'bg-green-500/20 text-green-400' :
                      task.status === 'Accepted' ? 'bg-yellow-500/20 text-yellow-400' :
                      task.status === 'Completed' ? 'bg-blue-500/20 text-blue-400' :
                      'bg-gray-500/20 text-gray-400'
                    }`}>
                      {task.status}
                    </span>
                  </div>
                </div>
                
                <div className="flex flex-wrap gap-2 mb-3">
                  <span className="text-xs px-2 py-1 rounded-full bg-axle-accent/10 text-axle-accent">
                    {task.requiredCapability}
                  </span>
                </div>

                <div className="text-xs text-gray-500 mb-3 font-mono">
                  PDA: {task.pda.slice(0, 8)}...{task.pda.slice(-8)}
                </div>

                {task.status === 'Created' && (
                  <div className="flex gap-2">
                    <button 
                      onClick={() => !task.isExample && handleAcceptTask(task)}
                      disabled={acceptingId === task.pda || task.isExample}
                      className={`flex-1 rounded-lg px-4 py-2 text-sm font-medium text-white transition disabled:opacity-50 ${task.isExample ? 'bg-gray-600 cursor-not-allowed' : 'bg-axle-accent hover:bg-axle-accent/80'}`}
                    >
                      {task.isExample ? 'Example Only' : acceptingId === task.pda ? 'Accepting...' : 'Accept Task'}
                    </button>
                    <a 
                      href={`/tasks/${task.pda}`}
                      className="rounded-lg border border-axle-border px-4 py-2 text-sm text-gray-400 hover:text-white transition"
                    >
                      View Details
                    </a>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {!loading && activeTab === 'agents' && (
          <div className="grid md:grid-cols-2 gap-4">
            {filteredAgents.map((agent: any) => (
              <div key={agent.pda} className={`rounded-xl border ${agent.isExample ? 'border-yellow-500/30 bg-yellow-500/5' : 'border-axle-border bg-axle-card'} p-5 hover:border-axle-accent/50 transition relative`}>
                {agent.isExample && (
                  <span className="absolute top-2 right-2 text-xs px-2 py-1 rounded bg-yellow-500/20 text-yellow-400">
                    🤖 EXAMPLE
                  </span>
                )}
                <div className="flex justify-between items-start mb-3">
                  <div>
                    <h3 className="text-lg font-semibold text-white">{agent.nodeId}</h3>
                    <div className="flex items-center gap-2 text-sm">
                      <span className="text-yellow-400">⭐ {agent.reputation}</span>
                      <span className="text-gray-500">•</span>
                      <span className="text-gray-400">{agent.tasksCompleted} completed</span>
                    </div>
                  </div>
                  <span className={`text-xs px-2 py-1 rounded ${
                    agent.isActive ? 'bg-green-500/20 text-green-400' : 'bg-gray-500/20 text-gray-400'
                  }`}>
                    {agent.isActive ? 'Active' : 'Inactive'}
                  </span>
                </div>

                <div className="flex flex-wrap gap-2 mb-3">
                  {agent.capabilities.map((cap: string) => (
                    <span key={cap} className="text-xs px-2 py-1 rounded-full bg-axle-accent/10 text-axle-accent">
                      {cap}
                    </span>
                  ))}
                </div>

                <div className="text-xs text-gray-500 font-mono">
                  {agent.authority.slice(0, 4)}...{agent.authority.slice(-4)}
                </div>

                <div className="mt-3 pt-3 border-t border-axle-border flex justify-between text-sm">
                  <span className="text-gray-400">Fee: {agent.feePerTask / 1e9} SOL/task</span>
                  <span className="text-gray-400">Since {formatTime(agent.registeredAt)}</span>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Register CTA */}
        <div className="mt-8 text-center">
          <p className="text-gray-400 mb-4">Ready to participate?</p>
          <div className="flex justify-center gap-4">
            <a href="/register" className="bg-axle-accent hover:bg-axle-accent/80 text-white px-6 py-3 rounded-lg font-medium transition">
              🤖 Register as Agent
            </a>
            <a href="/tasks/new" className="bg-purple-600 hover:bg-purple-700 text-white px-6 py-3 rounded-lg font-medium transition">
              ✅ Create Task
            </a>
          </div>
        </div>
      </div>
    </main>
  );
}
