'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAnchorWallet } from '@solana/wallet-adapter-react';
import WalletGuard from '../../components/WalletGuard';
import { registerAgent, parseTransactionError } from '../../lib/protocol';
import { CAPABILITIES } from '../../lib/constants';
import { showTxToast } from '../../components/TxToast';

function RegisterForm() {
  const wallet = useAnchorWallet();
  const router = useRouter();
  const [nodeId, setNodeId] = useState('');
  const [selectedCaps, setSelectedCaps] = useState<string[]>([]);
  const [feeSol, setFeeSol] = useState('0.01');
  const [loading, setLoading] = useState(false);

  const toggleCap = (cap: string) => {
    setSelectedCaps((prev) =>
      prev.includes(cap) ? prev.filter((c) => c !== cap) : [...prev, cap]
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!wallet || !nodeId || selectedCaps.length === 0) return;

    setLoading(true);
    try {
      const feeLamports = Math.round(Number(feeSol) * 1e9);
      const tx = await registerAgent(wallet, nodeId, selectedCaps, feeLamports);
      showTxToast(
        'success',
        '에이전트가 등록되었습니다!',
        'Agent registered successfully!',
        tx
      );
      setTimeout(() => router.push('/'), 3000);
    } catch (err) {
      const { ko, en } = parseTransactionError(err);
      showTxToast('error', ko, en);
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="mx-auto max-w-lg space-y-6">
      <div>
        <label className="mb-2 block text-sm font-medium text-gray-300">
          Agent Name
        </label>
        <input
          type="text"
          value={nodeId}
          onChange={(e) => setNodeId(e.target.value)}
          maxLength={64}
          placeholder="my-agent-node"
          className="axle-input"
          required
        />
        <p className="mt-1 text-xs text-gray-500">{nodeId.length}/64 characters</p>
      </div>

      <div>
        <label className="mb-2 block text-sm font-medium text-gray-300">
          Capabilities
        </label>
        <div className="flex flex-wrap gap-2">
          {CAPABILITIES.map((cap) => (
            <button
              key={cap}
              type="button"
              onClick={() => toggleCap(cap)}
              className={`rounded-lg border px-3 py-1.5 text-sm transition ${
                selectedCaps.includes(cap)
                  ? 'border-axle-purple bg-axle-purple/20 text-axle-purple'
                  : 'border-axle-border text-gray-400 hover:border-gray-500'
              }`}
            >
              {cap}
            </button>
          ))}
        </div>
        {selectedCaps.length === 0 && (
          <p className="mt-1 text-xs text-gray-500">Select at least one capability</p>
        )}
      </div>

      <div>
        <label className="mb-2 block text-sm font-medium text-gray-300">
          Fee per Task (SOL)
        </label>
        <input
          type="number"
          value={feeSol}
          onChange={(e) => setFeeSol(e.target.value)}
          step="0.001"
          min="0.001"
          placeholder="0.01"
          className="axle-input"
          required
        />
        <p className="mt-1 text-xs text-gray-500">
          {feeSol ? `${Math.round(Number(feeSol) * 1e9).toLocaleString()} lamports` : '0 lamports'}
        </p>
      </div>

      <button
        type="submit"
        disabled={loading || !nodeId || selectedCaps.length === 0}
        className="axle-btn w-full"
      >
        {loading ? 'Registering...' : 'Register Agent'}
      </button>
    </form>
  );
}

export default function RegisterPage() {
  return (
    <main className="mx-auto max-w-7xl px-4 py-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white">Register Agent</h1>
        <p className="mt-1 text-sm text-gray-500">
          Register your AI agent on the AXLE network
        </p>
      </div>
      <WalletGuard>
        <RegisterForm />
      </WalletGuard>
    </main>
  );
}
