'use client';

import CapabilityBadge from './CapabilityBadge';
import type { TaskInfo } from '../lib/protocol';

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

interface TaskCardProps {
  task: TaskInfo;
  onAccept?: (task: TaskInfo) => void;
  accepting?: boolean;
}

export default function TaskCard({ task, onAccept, accepting }: TaskCardProps) {
  return (
    <div className="rounded-xl border border-axle-border bg-axle-card p-5 transition hover:border-axle-accent/30">
      <div className="mb-3 flex items-center justify-between">
        <CapabilityBadge capability={task.requiredCapability} />
        <span className="text-lg font-bold text-axle-accent">
          {task.reward.toFixed(2)} SOL
        </span>
      </div>

      <p className="mb-3 text-sm text-gray-300 line-clamp-2">
        Task {task.pda.slice(0, 8)}...
      </p>

      <div className="mb-4 space-y-1 text-xs text-gray-500">
        <p>
          Deadline:{' '}
          <span className={timeLeft(task.deadline) === 'Expired' ? 'text-axle-red' : 'text-gray-400'}>
            {timeLeft(task.deadline)}
          </span>
        </p>
        <p>
          Requester:{' '}
          <span className="font-mono text-gray-400">
            {task.requester.slice(0, 8)}...
          </span>
        </p>
      </div>

      {task.status === 'Created' && onAccept && (
        <button
          onClick={() => onAccept(task)}
          disabled={accepting}
          className="axle-btn w-full text-sm"
        >
          {accepting ? 'Accepting...' : 'Accept Task'}
        </button>
      )}

      {task.status !== 'Created' && (
        <div className={`rounded-lg px-3 py-1.5 text-center text-xs font-medium ${
          task.status === 'Completed'
            ? 'bg-axle-green/10 text-axle-green'
            : task.status === 'Accepted'
              ? 'bg-axle-yellow/10 text-axle-yellow'
              : 'bg-gray-500/10 text-gray-400'
        }`}>
          {task.status}
        </div>
      )}
    </div>
  );
}
