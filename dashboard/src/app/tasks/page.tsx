'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useAnchorWallet } from '@solana/wallet-adapter-react';
import TaskCard from '../../components/TaskCard';
import { fetchTasks, acceptTask, parseTransactionError, type TaskInfo } from '../../lib/protocol';
import { CAPABILITIES } from '../../lib/constants';
import { showTxToast } from '../../components/TxToast';
import { PublicKey } from '@solana/web3.js';

export default function TasksPage() {
  const wallet = useAnchorWallet();
  const [tasks, setTasks] = useState<TaskInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const [filterCap, setFilterCap] = useState('all');
  const [sortBy, setSortBy] = useState<'newest' | 'reward'>('newest');

  const loadTasks = useCallback(async () => {
    if (!wallet) {
      setTasks([]);
      setLoading(false);
      return;
    }
    try {
      const data = await fetchTasks(wallet);
      setTasks(data);
    } catch {
      setTasks([]);
    } finally {
      setLoading(false);
    }
  }, [wallet]);

  useEffect(() => {
    loadTasks();
    const iv = setInterval(loadTasks, 10000);
    return () => clearInterval(iv);
  }, [loadTasks]);

  const handleAccept = async (task: TaskInfo) => {
    if (!wallet) return;
    setAcceptingId(task.pda);
    try {
      const tx = await acceptTask(wallet, new PublicKey(task.pda));
      showTxToast(
        'success',
        '태스크를 수락했습니다!',
        'Task accepted successfully!',
        tx
      );
      await loadTasks();
    } catch (err) {
      const errMsg = String(err);
      const { ko, en } = parseTransactionError(err);
      const needsRegister = errMsg.includes('AccountNotInitialized') || errMsg.includes('Account does not exist') || errMsg.includes('3012');
      showTxToast(
        'error',
        ko,
        en,
        undefined,
        needsRegister ? '/register' : undefined,
        needsRegister ? 'Register Now' : undefined
      );
    } finally {
      setAcceptingId(null);
    }
  };

  const filtered = tasks
    .filter((t) => filterCap === 'all' || t.requiredCapability === filterCap)
    .sort((a, b) => {
      if (sortBy === 'reward') return b.reward - a.reward;
      return b.createdAt.getTime() - a.createdAt.getTime();
    });

  return (
    <main className="mx-auto max-w-7xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Task Market</h1>
          <p className="mt-1 text-sm text-gray-500">
            Browse and accept tasks from the network
          </p>
        </div>
        <Link href="/tasks/new" className="axle-btn">
          Create New Task
        </Link>
      </div>

      {/* Filters */}
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <select
          value={filterCap}
          onChange={(e) => setFilterCap(e.target.value)}
          className="axle-select w-auto"
        >
          <option value="all">All Capabilities</option>
          {CAPABILITIES.map((cap) => (
            <option key={cap} value={cap}>
              {cap}
            </option>
          ))}
        </select>

        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as 'newest' | 'reward')}
          className="axle-select w-auto"
        >
          <option value="newest">Newest First</option>
          <option value="reward">Highest Reward</option>
        </select>

        <span className="text-sm text-gray-500">
          {filtered.length} task{filtered.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Task Grid */}
      {loading ? (
        <div className="py-20 text-center text-gray-500">Loading tasks...</div>
      ) : !wallet ? (
        <div className="py-20 text-center text-gray-500">
          Connect your wallet to browse tasks
        </div>
      ) : filtered.length === 0 ? (
        <div className="py-20 text-center text-gray-500">
          No tasks found.{' '}
          <Link href="/tasks/new" className="text-axle-accent hover:underline">
            Create one
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filtered.map((task) => (
            <TaskCard
              key={task.pda}
              task={task}
              onAccept={handleAccept}
              accepting={acceptingId === task.pda}
            />
          ))}
        </div>
      )}
    </main>
  );
}
