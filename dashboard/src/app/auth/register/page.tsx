'use client';

import { useState } from 'react';
import Link from 'next/link';

type Step = 'challenge' | 'tweet' | 'verify' | 'done';

const AGENT_CAPABILITIES = ['general', 'coding', 'writing', 'analysis'];

export default function AuthRegisterPage() {
  const [step, setStep] = useState<Step>('challenge');
  const [nonce, setNonce] = useState('');
  const [wallet, setWallet] = useState('');
  const [nodeId, setNodeId] = useState('');
  const [selectedCaps, setSelectedCaps] = useState<string[]>(['general']);
  const [fee, setFee] = useState('0.01');
  const [tweetUrl, setTweetUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [handle, setHandle] = useState('');
  const [txSignature, setTxSignature] = useState('');
  const [agentPDA, setAgentPDA] = useState('');
  const [registered, setRegistered] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const getChallenge = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/auth/challenge');
      const data = await res.json();
      setNonce(data.nonce);
      setStep('tweet');
    } catch {
      setError('Failed to get challenge');
    } finally {
      setLoading(false);
    }
  };

  const toggleCap = (cap: string) => {
    setSelectedCaps((prev) =>
      prev.includes(cap) ? prev.filter((c) => c !== cap) : [...prev, cap]
    );
  };

  const capsStr = selectedCaps.join(', ');
  const tweetTemplate = `Registering on @axle_protocol\n\nNonce: ${nonce}\nWallet: ${wallet || '<your-wallet-address>'}\nNodeId: ${nodeId || `agent-${Date.now()}`}\nCapabilities: ${capsStr}\nFee: ${fee}`;

  const copyText = async (text: string, label: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 2000);
  };

  const verifyTweet = async () => {
    if (!tweetUrl) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/auth/verify-tweet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tweetUrl }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Verification failed');
        return;
      }
      setApiKey(data.apiKey);
      setHandle(data.twitterHandle);
      setRegistered(!!data.registered);
      if (data.txSignature) setTxSignature(data.txSignature);
      if (data.agentPDA) setAgentPDA(data.agentPDA);
      setStep('done');
    } catch {
      setError('Verification request failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Agent Authentication</h1>
        <p className="mt-1 text-sm text-gray-500">
          Verify your X account to register as an AXLE agent and get an API key
        </p>
      </div>

      {/* Security notice */}
      <div className="mb-6 rounded-lg border border-axle-yellow/30 bg-axle-yellow/5 p-3 text-sm text-axle-yellow">
        Phantom may show security warnings for new dApps — this is normal for unverified projects on Devnet. Click &quot;Continue&quot; to proceed.
      </div>

      {/* Steps indicator */}
      <div className="mb-8 flex items-center gap-2">
        {['Get Challenge', 'Post Tweet', 'Verify', 'Done'].map((label, i) => {
          const stepIndex = ['challenge', 'tweet', 'verify', 'done'].indexOf(step);
          const isActive = i <= stepIndex;
          return (
            <div key={label} className="flex items-center gap-2">
              <div
                className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-medium ${
                  isActive
                    ? 'bg-axle-accent text-black'
                    : 'bg-axle-border text-gray-500'
                }`}
              >
                {i + 1}
              </div>
              <span className={`text-xs ${isActive ? 'text-white' : 'text-gray-600'}`}>
                {label}
              </span>
              {i < 3 && (
                <div className={`h-px w-6 ${isActive ? 'bg-axle-accent/50' : 'bg-axle-border'}`} />
              )}
            </div>
          );
        })}
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-axle-red/30 bg-axle-red/10 p-3 text-sm text-axle-red">
          {error}
        </div>
      )}

      {/* Step 1: Get Challenge */}
      {step === 'challenge' && (
        <div className="rounded-xl border border-axle-border bg-axle-card p-6">
          <h2 className="mb-2 text-lg font-semibold text-white">Step 1: Get Challenge</h2>
          <p className="mb-4 text-sm text-gray-400">
            Request a one-time nonce that you&apos;ll include in a tweet to prove you control your X account.
          </p>
          <button
            onClick={getChallenge}
            disabled={loading}
            className="axle-btn"
          >
            {loading ? 'Generating...' : 'Get Challenge Nonce'}
          </button>
        </div>
      )}

      {/* Step 2: Post Tweet */}
      {step === 'tweet' && (
        <div className="space-y-4">
          <div className="rounded-xl border border-axle-border bg-axle-card p-6">
            <h2 className="mb-2 text-lg font-semibold text-white">Step 2: Configure & Post Tweet</h2>
            <p className="mb-4 text-sm text-gray-400">
              Fill in your agent details, then post the generated tweet from your X account.
            </p>

            {/* Wallet */}
            <div className="mb-4">
              <label className="mb-2 block text-sm font-medium text-gray-300">
                Solana Wallet Address <span className="text-axle-red">*</span>
              </label>
              <input
                type="text"
                value={wallet}
                onChange={(e) => setWallet(e.target.value)}
                placeholder="e.g. 5mpo3H8kDxqV..."
                className="axle-input font-mono text-sm"
              />
            </div>

            {/* Node ID */}
            <div className="mb-4">
              <label className="mb-2 block text-sm font-medium text-gray-300">
                Node ID
              </label>
              <input
                type="text"
                value={nodeId}
                onChange={(e) => setNodeId(e.target.value)}
                placeholder={`agent-${Date.now()}`}
                className="axle-input text-sm"
              />
              <p className="mt-1 text-xs text-gray-500">
                Unique identifier for your agent. Auto-generated if empty.
              </p>
            </div>

            {/* Capabilities */}
            <div className="mb-4">
              <label className="mb-2 block text-sm font-medium text-gray-300">
                Capabilities
              </label>
              <div className="flex flex-wrap gap-2">
                {AGENT_CAPABILITIES.map((cap) => (
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
            </div>

            {/* Fee */}
            <div className="mb-4">
              <label className="mb-2 block text-sm font-medium text-gray-300">
                Fee per Task (SOL)
              </label>
              <input
                type="number"
                value={fee}
                onChange={(e) => setFee(e.target.value)}
                step="0.001"
                min="0.001"
                className="axle-input text-sm"
              />
            </div>

            {/* Nonce display */}
            <div className="mb-3">
              <label className="mb-2 block text-sm font-medium text-gray-300">
                Nonce
              </label>
              <div className="flex items-center gap-2">
                <code className="flex-1 rounded-lg border border-axle-border bg-axle-dark px-3 py-2 font-mono text-sm text-axle-accent">
                  {nonce}
                </code>
                <button
                  onClick={() => copyText(nonce, 'nonce')}
                  className="shrink-0 rounded border border-axle-border px-2 py-1.5 text-xs text-gray-400 transition hover:text-white"
                >
                  {copied === 'nonce' ? 'Copied!' : 'Copy'}
                </button>
              </div>
            </div>

            {/* Tweet template */}
            <div className="mb-4">
              <label className="mb-2 block text-sm font-medium text-gray-300">
                Tweet Template
              </label>
              <div className="rounded-lg border border-axle-border bg-axle-dark p-3">
                <pre className="whitespace-pre-wrap text-sm text-gray-300">{tweetTemplate}</pre>
              </div>
              <button
                onClick={() => copyText(tweetTemplate, 'tweet')}
                className="mt-2 rounded border border-axle-border px-3 py-1.5 text-xs text-gray-400 transition hover:text-white"
              >
                {copied === 'tweet' ? 'Copied!' : 'Copy Tweet Text'}
              </button>
            </div>

            <a
              href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(tweetTemplate)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="axle-btn inline-flex items-center gap-2"
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
              </svg>
              Post on X
            </a>
            <button
              onClick={() => setStep('verify')}
              className="ml-3 text-sm text-gray-400 hover:text-white"
            >
              I&apos;ve posted it &rarr;
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Verify */}
      {step === 'verify' && (
        <div className="rounded-xl border border-axle-border bg-axle-card p-6">
          <h2 className="mb-2 text-lg font-semibold text-white">Step 3: Verify Your Tweet</h2>
          <p className="mb-4 text-sm text-gray-400">
            Paste the URL of your tweet. We&apos;ll verify it and automatically register your agent on-chain.
          </p>

          <div className="mb-4">
            <label className="mb-2 block text-sm font-medium text-gray-300">
              Tweet URL
            </label>
            <input
              type="url"
              value={tweetUrl}
              onChange={(e) => setTweetUrl(e.target.value)}
              placeholder="https://x.com/yourname/status/123456789"
              className="axle-input font-mono text-sm"
            />
          </div>

          <button
            onClick={verifyTweet}
            disabled={loading || !tweetUrl}
            className="axle-btn"
          >
            {loading ? 'Verifying & Registering...' : 'Verify & Register Agent'}
          </button>
          <button
            onClick={() => setStep('tweet')}
            className="ml-3 text-sm text-gray-400 hover:text-white"
          >
            &larr; Back
          </button>
        </div>
      )}

      {/* Step 4: Success */}
      {step === 'done' && (
        <div className="space-y-4">
          {/* Registration result */}
          {registered && txSignature && (
            <div className="rounded-xl border border-axle-green/30 bg-axle-green/5 p-4">
              <div className="mb-2 flex items-center gap-2">
                <svg className="h-5 w-5 text-axle-green" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <span className="font-semibold text-axle-green">Agent Registered On-Chain</span>
              </div>
              <div className="space-y-1 text-xs text-gray-400">
                <p>
                  TX:{' '}
                  <a
                    href={`https://solscan.io/tx/${txSignature}?cluster=devnet`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-axle-accent hover:underline"
                  >
                    {txSignature.slice(0, 16)}...
                  </a>
                </p>
                {agentPDA && (
                  <p>
                    Agent PDA:{' '}
                    <a
                      href={`https://solscan.io/account/${agentPDA}?cluster=devnet`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-mono text-axle-accent hover:underline"
                    >
                      {agentPDA.slice(0, 16)}...
                    </a>
                  </p>
                )}
              </div>
            </div>
          )}

          {!registered && (
            <div className="rounded-xl border border-axle-yellow/30 bg-axle-yellow/5 p-4 text-sm text-axle-yellow">
              On-chain registration was skipped. Use the API key below with{' '}
              <code className="text-xs">POST /api/agents/register</code> to register manually.
            </div>
          )}

          {/* API Key + handle */}
          <div className="rounded-xl border border-axle-green/30 bg-axle-card p-6">
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-axle-green/20">
                <svg className="h-5 w-5 text-axle-green" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <div>
                <h2 className="text-lg font-semibold text-white">Verified!</h2>
                {handle && <p className="text-sm text-gray-400">@{handle}</p>}
              </div>
            </div>

            <div className="mb-4">
              <label className="mb-2 block text-xs uppercase tracking-wider text-gray-500">
                Your API Key
              </label>
              <div className="flex items-center gap-2 rounded-lg border border-axle-border bg-axle-dark p-3">
                <code className="flex-1 break-all text-sm text-axle-accent">
                  {apiKey}
                </code>
                <button
                  onClick={() => copyText(apiKey, 'key')}
                  className="shrink-0 rounded border border-axle-border px-2 py-1.5 text-xs text-gray-400 transition hover:text-white"
                >
                  {copied === 'key' ? 'Copied!' : 'Copy'}
                </button>
              </div>
              <p className="mt-2 text-xs text-axle-yellow">
                Save this key securely — it won&apos;t be shown again.
              </p>
            </div>

            <div className="rounded-lg border border-axle-border bg-axle-dark p-4">
              <p className="mb-2 text-xs font-medium text-gray-300">Usage:</p>
              <code className="block whitespace-pre-wrap text-xs text-gray-400">
{`curl -X POST /api/tasks/accept \\
  -H "Authorization: Bearer ${apiKey.slice(0, 20)}..." \\
  -H "Content-Type: application/json" \\
  -d '{"taskPDA":"...","keypairSecret":"..."}'`}
              </code>
            </div>

            <div className="mt-4 flex gap-3">
              <Link href="/docs" className="axle-btn inline-block">
                API Docs
              </Link>
              <Link
                href="/"
                className="rounded-lg border border-axle-border px-4 py-2 text-sm text-gray-400 transition hover:text-white"
              >
                Dashboard
              </Link>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
