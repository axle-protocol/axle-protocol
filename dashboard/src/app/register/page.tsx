'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAnchorWallet } from '@solana/wallet-adapter-react';
import WalletGuard from '../../components/WalletGuard';
import { registerAgent, mintAgentBadge, fetchAgents, parseTransactionError } from '../../lib/protocol';
import { CAPABILITIES } from '../../lib/constants';
import { showTxToast } from '../../components/TxToast';

function RegisterForm() {
  const wallet = useAnchorWallet();
  const router = useRouter();
  const [nodeId, setNodeId] = useState('');
  const [selectedCaps, setSelectedCaps] = useState<string[]>([]);
  const [feeSol, setFeeSol] = useState('0.01');
  const [loading, setLoading] = useState(false);
  const [isRegistered, setIsRegistered] = useState(false);
  const [mintingBadge, setMintingBadge] = useState(false);
  const [checkingStatus, setCheckingStatus] = useState(true);

  const checkRegistration = useCallback(async () => {
    if (!wallet) {
      setCheckingStatus(false);
      return;
    }
    try {
      const agents = await fetchAgents(wallet);
      const myAgent = agents.find((a) => a.authority === wallet.publicKey.toBase58());
      if (myAgent) {
        setIsRegistered(true);
        setNodeId(myAgent.nodeId);
      }
    } catch {
      // ignore
    } finally {
      setCheckingStatus(false);
    }
  }, [wallet]);

  useEffect(() => {
    checkRegistration();
  }, [checkRegistration]);

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
      showTxToast('success', 'Agent registered successfully!', tx);
      setIsRegistered(true);
    } catch (err) {
      const message = parseTransactionError(err);
      showTxToast('error', message);
    } finally {
      setLoading(false);
    }
  };

  const handleMintBadge = async () => {
    if (!wallet || !nodeId) return;
    setMintingBadge(true);
    try {
      const tx = await mintAgentBadge(
        wallet,
        `AXLE Agent: ${nodeId}`,
        'AXLE',
        ''
      );
      showTxToast('success', 'Badge minted! Check your Phantom wallet.', tx);
    } catch (err) {
      const message = parseTransactionError(err);
      showTxToast('error', message);
    } finally {
      setMintingBadge(false);
    }
  };

  if (checkingStatus) {
    return <div className="py-20 text-center text-gray-500">Checking registration status...</div>;
  }

  if (isRegistered) {
    return (
      <div className="mx-auto max-w-lg space-y-6">
        <div className="rounded-xl border border-axle-green/30 bg-axle-green/5 p-6 text-center">
          <div className="mb-2 text-2xl">&#x2713;</div>
          <h2 className="text-lg font-bold text-white">Agent Registered</h2>
          <p className="mt-1 text-sm text-gray-400">
            Your agent <span className="font-mono text-axle-accent">{nodeId}</span> is active on the network.
          </p>
        </div>

        <div className="rounded-xl border border-axle-border bg-axle-card p-6">
          <h3 className="mb-2 text-lg font-bold text-white">Mint Agent Badge</h3>
          <p className="mb-4 text-sm text-gray-400">
            Mint a Token-2022 NFT badge as on-chain proof of your agent identity. The badge will appear in your Phantom wallet.
          </p>
          <button
            onClick={handleMintBadge}
            disabled={mintingBadge}
            className="axle-btn w-full"
          >
            {mintingBadge ? 'Minting...' : 'Mint Badge NFT'}
          </button>
        </div>

        <button
          onClick={() => router.push('/tasks')}
          className="w-full rounded-lg border border-axle-border px-6 py-2.5 text-sm font-medium text-gray-300 hover:border-gray-500 hover:text-white transition"
        >
          Browse Tasks
        </button>
      </div>
    );
  }

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
