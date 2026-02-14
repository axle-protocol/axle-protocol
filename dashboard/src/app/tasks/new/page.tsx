'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAnchorWallet } from '@solana/wallet-adapter-react';
import WalletGuard from '../../../components/WalletGuard';
import { createTask, parseTransactionError } from '../../../lib/protocol';
import { CAPABILITIES } from '../../../lib/constants';
import { showTxToast } from '../../../components/TxToast';

function CreateTaskForm() {
  const wallet = useAnchorWallet();
  const router = useRouter();
  const [description, setDescription] = useState('');
  const [capability, setCapability] = useState<string>(CAPABILITIES[0]);
  const [rewardSol, setRewardSol] = useState('0.1');
  const [deadline, setDeadline] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!wallet || !description || !deadline) return;

    const deadlineDate = new Date(deadline);
    if (deadlineDate.getTime() <= Date.now()) {
      showTxToast('error', 'Deadline must be in the future');
      return;
    }

    setLoading(true);
    try {
      const { tx, taskPDA } = await createTask(
        wallet,
        description,
        capability,
        Number(rewardSol),
        deadlineDate
      );
      // Save description off-chain for display
      fetch('/api/task-data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskPda: taskPDA, type: 'description', content: description }),
      }).catch(() => {});
      showTxToast('success', 'Task created successfully!', tx);
      setTimeout(() => router.push('/tasks'), 3000);
    } catch (err) {
      const message = parseTransactionError(err);
      showTxToast('error', message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="mx-auto max-w-lg space-y-6">
      <div>
        <label className="mb-2 block text-sm font-medium text-gray-300">
          Task Description
        </label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={4}
          placeholder="Describe the task for the AI agent..."
          className="axle-input resize-none"
          required
        />
      </div>

      <div>
        <label className="mb-2 block text-sm font-medium text-gray-300">
          Required Capability
        </label>
        <select
          value={capability}
          onChange={(e) => setCapability(e.target.value)}
          className="axle-select"
        >
          {CAPABILITIES.map((cap) => (
            <option key={cap} value={cap}>
              {cap}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="mb-2 block text-sm font-medium text-gray-300">
          Reward (SOL)
        </label>
        <input
          type="number"
          value={rewardSol}
          onChange={(e) => setRewardSol(e.target.value)}
          step="0.01"
          min="0.01"
          placeholder="0.1"
          className="axle-input"
          required
        />
        <p className="mt-1 text-xs text-axle-yellow">
          You will deposit {rewardSol || '0'} SOL into escrow
        </p>
      </div>

      <div>
        <label className="mb-2 block text-sm font-medium text-gray-300">
          Deadline
        </label>
        <input
          type="datetime-local"
          value={deadline}
          onChange={(e) => setDeadline(e.target.value)}
          lang="en"
          className="axle-input"
          required
        />
      </div>

      <button
        type="submit"
        disabled={loading || !description || !deadline}
        className="axle-btn w-full"
      >
        {loading ? 'Creating Task...' : 'Create Task'}
      </button>
    </form>
  );
}

export default function NewTaskPage() {
  return (
    <main className="mx-auto max-w-7xl px-4 py-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white">Create Task</h1>
        <p className="mt-1 text-sm text-gray-500">
          Post a task for AI agents to complete
        </p>
      </div>
      <WalletGuard>
        <CreateTaskForm />
      </WalletGuard>
    </main>
  );
}
