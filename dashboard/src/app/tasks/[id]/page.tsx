'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useAnchorWallet } from '@solana/wallet-adapter-react';
import { PublicKey } from '@solana/web3.js';
import {
  fetchTaskByPDA,
  deliverTask,
  completeTask,
  acceptTask,
  cancelTask,
  parseTransactionError,
  type TaskInfo,
} from '../../../lib/protocol';
import { solscanAccountUrl } from '../../../lib/constants';
import { showTxToast } from '../../../components/TxToast';
import CapabilityBadge from '../../../components/CapabilityBadge';

function formatDate(date: Date | null): string {
  if (!date) return '-';
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function timeLeft(deadline: Date): string {
  const diff = deadline.getTime() - Date.now();
  if (diff <= 0) return 'Expired';
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  if (days > 0) return `${days}d ${remainingHours}h left`;
  const minutes = Math.floor((diff / (1000 * 60)) % 60);
  if (hours > 0) return `${hours}h ${minutes}m left`;
  return `${minutes}m left`;
}

function statusColor(status: string) {
  switch (status) {
    case 'Created': return 'bg-blue-500/10 text-blue-400 border-blue-500/30';
    case 'Accepted': return 'bg-axle-yellow/10 text-axle-yellow border-axle-yellow/30';
    case 'Delivered': return 'bg-axle-purple/10 text-axle-purple border-axle-purple/30';
    case 'Completed': return 'bg-axle-green/10 text-axle-green border-axle-green/30';
    case 'Cancelled': return 'bg-gray-500/10 text-gray-400 border-gray-500/30';
    case 'TimedOut': return 'bg-axle-red/10 text-axle-red border-axle-red/30';
    default: return 'bg-gray-500/10 text-gray-400 border-gray-500/30';
  }
}

function isEmptyHash(hash: number[]): boolean {
  return hash.every((b) => b === 0);
}

export default function TaskDetailPage() {
  const params = useParams();
  const wallet = useAnchorWallet();
  const [task, setTask] = useState<TaskInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [showDeliverModal, setShowDeliverModal] = useState(false);
  const [showApproveModal, setShowApproveModal] = useState(false);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [resultText, setResultText] = useState('');
  const [taskDescription, setTaskDescription] = useState<string | null>(null);
  const [taskResult, setTaskResult] = useState<string | null>(null);

  const taskId = params.id as string;

  const loadTask = useCallback(async () => {
    if (!wallet || !taskId) {
      setLoading(false);
      return;
    }
    try {
      const taskPDA = new PublicKey(taskId);
      const data = await fetchTaskByPDA(wallet, taskPDA);
      setTask(data);
    } catch {
      setTask(null);
    } finally {
      setLoading(false);
    }
  }, [wallet, taskId]);

  // Load off-chain data (description + result)
  const loadOffChainData = useCallback(async () => {
    if (!taskId) return;
    try {
      const res = await fetch(`/api/task-data?taskPda=${taskId}`);
      if (res.ok) {
        const data = await res.json();
        if (data.description) setTaskDescription(data.description);
        if (data.result) setTaskResult(data.result);
      }
    } catch {
      // ignore
    }
  }, [taskId]);

  useEffect(() => {
    loadTask();
    loadOffChainData();
  }, [loadTask, loadOffChainData]);

  const isRequester = wallet && task && wallet.publicKey.toBase58() === task.requester;
  const isProvider = wallet && task && task.provider && wallet.publicKey.toBase58() === task.provider;

  const handleAccept = async () => {
    if (!wallet || !task) return;
    setActionLoading(true);
    try {
      const tx = await acceptTask(wallet, new PublicKey(task.pda));
      showTxToast('success', 'Task accepted successfully!', tx);
      await loadTask();
    } catch (err) {
      const errMsg = String(err);
      const message = parseTransactionError(err);
      const needsRegister = errMsg.includes('AccountNotInitialized') || errMsg.includes('Account does not exist') || errMsg.includes('3012');
      showTxToast('error', message, undefined, needsRegister ? '/register' : undefined, needsRegister ? 'Register Now' : undefined);
    } finally {
      setActionLoading(false);
    }
  };

  const handleDeliver = async () => {
    if (!wallet || !task || !resultText.trim()) return;
    setActionLoading(true);
    try {
      const tx = await deliverTask(wallet, new PublicKey(task.pda), resultText.trim());
      // Save result text off-chain
      fetch('/api/task-data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskPda: task.pda, type: 'result', content: resultText.trim() }),
      }).catch(() => {});
      showTxToast('success', 'Result submitted successfully!', tx);
      setShowDeliverModal(false);
      setTaskResult(resultText.trim());
      setResultText('');
      await loadTask();
    } catch (err) {
      const message = parseTransactionError(err);
      showTxToast('error', message);
    } finally {
      setActionLoading(false);
    }
  };

  const handleApprove = async () => {
    if (!wallet || !task || !task.provider) return;
    setActionLoading(true);
    try {
      const tx = await completeTask(
        wallet,
        new PublicKey(task.pda),
        new PublicKey(task.provider),
        new Uint8Array(task.id)
      );
      showTxToast('success', 'Task approved! Payment released.', tx);
      setShowApproveModal(false);
      await loadTask();
    } catch (err) {
      const message = parseTransactionError(err);
      showTxToast('error', message);
    } finally {
      setActionLoading(false);
    }
  };

  const handleCancel = async () => {
    if (!wallet || !task) return;
    setActionLoading(true);
    try {
      const tx = await cancelTask(
        wallet,
        new PublicKey(task.pda),
        new Uint8Array(task.id)
      );
      showTxToast('success', 'Task cancelled. Escrow refunded.', tx);
      setShowCancelModal(false);
      await loadTask();
    } catch (err) {
      const message = parseTransactionError(err);
      showTxToast('error', message);
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-8">
        <div className="py-20 text-center text-gray-500">Loading task...</div>
      </main>
    );
  }

  if (!wallet) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-8">
        <div className="py-20 text-center text-gray-500">
          Connect your wallet to view task details
        </div>
      </main>
    );
  }

  if (!task) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-8">
        <div className="py-20 text-center text-gray-500">
          Task not found.{' '}
          <Link href="/tasks" className="text-axle-accent hover:underline">
            Back to tasks
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      {/* Header */}
      <div className="mb-6">
        <Link href="/tasks" className="mb-4 inline-flex items-center gap-1 text-sm text-gray-400 hover:text-white">
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back to Tasks
        </Link>
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">Task Details</h1>
            <p className="mt-1 font-mono text-xs text-gray-500">{task.pda}</p>
          </div>
          <div className={`rounded-lg border px-4 py-2 text-sm font-semibold ${statusColor(task.status)}`}>
            {task.status}
          </div>
        </div>
      </div>

      {/* Task Description */}
      {taskDescription && (
        <div className="mb-6 rounded-xl border border-axle-border bg-axle-card p-6">
          <h2 className="mb-3 text-sm font-semibold text-white">Task Description</h2>
          <p className="whitespace-pre-wrap text-sm text-gray-300">{taskDescription}</p>
        </div>
      )}

      {/* Task Info */}
      <div className="mb-6 rounded-xl border border-axle-border bg-axle-card p-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <p className="text-xs text-gray-500">Capability</p>
            <div className="mt-1">
              <CapabilityBadge capability={task.requiredCapability} />
            </div>
          </div>
          <div>
            <p className="text-xs text-gray-500">Reward</p>
            <p className="mt-1 text-lg font-bold text-axle-accent">{task.reward.toFixed(4)} SOL</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">Requester</p>
            <a
              href={solscanAccountUrl(task.requester)}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 block font-mono text-sm text-gray-300 hover:text-axle-accent"
            >
              {task.requester.slice(0, 16)}...
            </a>
          </div>
          <div>
            <p className="text-xs text-gray-500">Provider</p>
            {task.provider ? (
              <a
                href={solscanAccountUrl(task.provider)}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1 block font-mono text-sm text-gray-300 hover:text-axle-accent"
              >
                {task.provider.slice(0, 16)}...
              </a>
            ) : (
              <p className="mt-1 text-sm text-gray-500">Not assigned</p>
            )}
          </div>
          <div>
            <p className="text-xs text-gray-500">Deadline</p>
            <p className="mt-1 text-sm text-gray-300">
              {formatDate(task.deadline)}{' '}
              <span className={`text-xs ${timeLeft(task.deadline) === 'Expired' ? 'text-axle-red' : 'text-gray-500'}`}>
                ({timeLeft(task.deadline)})
              </span>
            </p>
          </div>
          <div>
            <p className="text-xs text-gray-500">Created</p>
            <p className="mt-1 text-sm text-gray-300">{formatDate(task.createdAt)}</p>
          </div>
        </div>

        {/* Result Hash */}
        {!isEmptyHash(task.resultHash) && (
          <div className="mt-4 border-t border-axle-border pt-4">
            <p className="text-xs text-gray-500">Result Hash</p>
            <p className="mt-1 break-all font-mono text-xs text-gray-400">
              {task.resultHash.map((b) => b.toString(16).padStart(2, '0')).join('')}
            </p>
          </div>
        )}
      </div>

      {/* Result Content */}
      {taskResult && (
        <div className="mb-6 rounded-xl border border-axle-purple/30 bg-axle-card p-6">
          <h2 className="mb-3 text-sm font-semibold text-white">Result</h2>
          <p className="whitespace-pre-wrap text-sm text-gray-300">{taskResult}</p>
        </div>
      )}

      {/* Timeline */}
      <div className="mb-6 rounded-xl border border-axle-border bg-axle-card p-6">
        <h2 className="mb-4 text-sm font-semibold text-white">Timeline</h2>
        <div className="space-y-3">
          <TimelineItem label="Created" date={task.createdAt} active />
          <TimelineItem label="Accepted" date={task.acceptedAt} active={!!task.acceptedAt} />
          <TimelineItem label="Delivered" date={task.deliveredAt} active={!!task.deliveredAt} />
          <TimelineItem label="Completed" date={task.completedAt} active={!!task.completedAt} />
        </div>
      </div>

      {/* Actions */}
      <div className="rounded-xl border border-axle-border bg-axle-card p-6">
        <h2 className="mb-4 text-sm font-semibold text-white">Actions</h2>

        {/* Created: anyone (non-requester) can accept */}
        {task.status === 'Created' && !isRequester && (
          <button
            onClick={handleAccept}
            disabled={actionLoading}
            className="axle-btn w-full"
          >
            {actionLoading ? 'Accepting...' : 'Accept Task'}
          </button>
        )}

        {/* Created: requester can cancel */}
        {task.status === 'Created' && isRequester && (
          <div className="space-y-3">
            <p className="text-center text-sm text-gray-500">Waiting for an agent to accept this task.</p>
            <button
              onClick={() => setShowCancelModal(true)}
              disabled={actionLoading}
              className="w-full rounded-lg border border-axle-red/30 px-4 py-2.5 text-sm font-medium text-axle-red transition hover:bg-axle-red/10"
            >
              Cancel Task
            </button>
          </div>
        )}

        {/* Accepted: provider can submit result */}
        {task.status === 'Accepted' && isProvider && (
          <button
            onClick={() => setShowDeliverModal(true)}
            disabled={actionLoading}
            className="axle-btn w-full"
          >
            Submit Result
          </button>
        )}

        {/* Accepted: requester sees waiting message */}
        {task.status === 'Accepted' && isRequester && (
          <p className="text-center text-sm text-gray-500">Agent is working on this task.</p>
        )}

        {/* Accepted: neither */}
        {task.status === 'Accepted' && !isProvider && !isRequester && (
          <p className="text-center text-sm text-gray-500">This task has been accepted by an agent.</p>
        )}

        {/* Delivered: requester can approve */}
        {task.status === 'Delivered' && isRequester && (
          <button
            onClick={() => setShowApproveModal(true)}
            disabled={actionLoading}
            className="axle-btn w-full"
          >
            Approve &amp; Release Payment
          </button>
        )}

        {/* Delivered: provider sees waiting message */}
        {task.status === 'Delivered' && isProvider && (
          <p className="text-center text-sm text-gray-500">Waiting for requester to approve your result.</p>
        )}

        {/* Delivered: neither */}
        {task.status === 'Delivered' && !isProvider && !isRequester && (
          <p className="text-center text-sm text-gray-500">Result submitted. Awaiting requester approval.</p>
        )}

        {/* Completed */}
        {task.status === 'Completed' && (
          <p className="text-center text-sm text-axle-green">Task completed. Payment has been released.</p>
        )}

        {/* Cancelled / TimedOut */}
        {(task.status === 'Cancelled' || task.status === 'TimedOut') && (
          <p className="text-center text-sm text-gray-500">This task is no longer active.</p>
        )}
      </div>

      {/* Deliver Modal */}
      {showDeliverModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl border border-axle-border bg-axle-dark p-6">
            <h3 className="mb-4 text-lg font-bold text-white">Submit Result</h3>
            <p className="mb-3 text-xs text-gray-500">
              Your result text will be hashed (SHA-256) and stored on-chain. The original text is saved off-chain for the requester to review.
            </p>
            <textarea
              value={resultText}
              onChange={(e) => setResultText(e.target.value)}
              rows={5}
              placeholder="Enter your result..."
              className="axle-input mb-4 resize-none"
            />
            <div className="flex gap-3">
              <button
                onClick={() => { setShowDeliverModal(false); setResultText(''); }}
                className="flex-1 rounded-lg border border-axle-border px-4 py-2.5 text-sm text-gray-400 hover:text-white"
              >
                Cancel
              </button>
              <button
                onClick={handleDeliver}
                disabled={actionLoading || !resultText.trim()}
                className="axle-btn flex-1"
              >
                {actionLoading ? 'Submitting...' : 'Submit'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Approve Modal */}
      {showApproveModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl border border-axle-border bg-axle-dark p-6">
            <h3 className="mb-4 text-lg font-bold text-white">Approve &amp; Release Payment</h3>
            <p className="mb-2 text-sm text-gray-300">
              Are you sure you want to approve this result and release{' '}
              <span className="font-bold text-axle-accent">{task.reward.toFixed(4)} SOL</span>{' '}
              to the provider?
            </p>
            <p className="mb-6 text-xs text-axle-yellow">This action cannot be undone.</p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowApproveModal(false)}
                className="flex-1 rounded-lg border border-axle-border px-4 py-2.5 text-sm text-gray-400 hover:text-white"
              >
                Cancel
              </button>
              <button
                onClick={handleApprove}
                disabled={actionLoading}
                className="axle-btn flex-1"
              >
                {actionLoading ? 'Approving...' : 'Approve'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Cancel Modal */}
      {showCancelModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl border border-axle-border bg-axle-dark p-6">
            <h3 className="mb-4 text-lg font-bold text-white">Cancel Task</h3>
            <p className="mb-2 text-sm text-gray-300">
              Are you sure you want to cancel this task? The escrowed{' '}
              <span className="font-bold text-axle-accent">{task.reward.toFixed(4)} SOL</span>{' '}
              will be refunded to your wallet.
            </p>
            <div className="mt-6 flex gap-3">
              <button
                onClick={() => setShowCancelModal(false)}
                className="flex-1 rounded-lg border border-axle-border px-4 py-2.5 text-sm text-gray-400 hover:text-white"
              >
                Keep Task
              </button>
              <button
                onClick={handleCancel}
                disabled={actionLoading}
                className="flex-1 rounded-lg bg-axle-red/20 px-4 py-2.5 text-sm font-semibold text-axle-red transition hover:bg-axle-red/30"
              >
                {actionLoading ? 'Cancelling...' : 'Cancel Task'}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

function TimelineItem({ label, date, active }: { label: string; date: Date | null; active: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <div className={`h-2.5 w-2.5 rounded-full ${active ? 'bg-axle-accent' : 'bg-gray-700'}`} />
      <span className={`text-sm ${active ? 'text-white' : 'text-gray-600'}`}>{label}</span>
      {date && (
        <span className="text-xs text-gray-500">
          {date.toLocaleString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          })}
        </span>
      )}
    </div>
  );
}
