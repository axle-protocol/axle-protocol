'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import Link from 'next/link';

function SuccessContent() {
  const params = useSearchParams();
  const apiKey = params.get('apiKey') || '';
  const handle = params.get('handle') || '';
  const name = params.get('name') || '';
  const avatar = params.get('avatar') || '';
  const [copied, setCopied] = useState(false);

  const copyKey = async () => {
    await navigator.clipboard.writeText(apiKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <main className="mx-auto max-w-lg px-4 py-16">
      <div className="rounded-xl border border-axle-green/30 bg-axle-card p-8 text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-axle-green/20">
          <svg className="h-8 w-8 text-axle-green" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>

        <h1 className="mb-2 text-2xl font-bold text-white">Authenticated!</h1>

        {(handle || name) && (
          <div className="mb-6 flex items-center justify-center gap-3">
            {avatar && (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={avatar} alt="" className="h-10 w-10 rounded-full" />
            )}
            <div className="text-left">
              {name && <p className="text-sm font-medium text-white">{name}</p>}
              {handle && <p className="text-xs text-gray-400">@{handle}</p>}
            </div>
          </div>
        )}

        <div className="mb-6">
          <p className="mb-2 text-xs uppercase tracking-wider text-gray-500">Your API Key</p>
          <div className="flex items-center gap-2 rounded-lg border border-axle-border bg-axle-dark p-3">
            <code className="flex-1 break-all text-xs text-axle-accent">
              {apiKey}
            </code>
            <button
              onClick={copyKey}
              className="shrink-0 rounded border border-axle-border px-2 py-1 text-xs text-gray-400 transition hover:text-white"
            >
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>
          <p className="mt-2 text-xs text-axle-yellow">
            Save this key — it won&apos;t be shown again
          </p>
        </div>

        <div className="rounded-lg border border-axle-border bg-axle-dark p-4 text-left">
          <p className="mb-2 text-xs font-medium text-gray-300">Usage:</p>
          <code className="block whitespace-pre-wrap text-xs text-gray-400">
{`curl -X POST /api/agents/register \\
  -H "Authorization: Bearer ${apiKey.slice(0, 16)}..." \\
  -H "Content-Type: application/json" \\
  -d '{"nodeId": "my-agent", ...}'`}
          </code>
        </div>

        <Link
          href="/"
          className="mt-6 inline-block rounded-lg bg-axle-accent px-6 py-2 text-sm font-semibold text-black transition hover:bg-axle-accent/80"
        >
          Go to Dashboard
        </Link>
      </div>
    </main>
  );
}

export default function AuthSuccessPage() {
  return (
    <Suspense fallback={<div className="py-16 text-center text-gray-500">Loading...</div>}>
      <SuccessContent />
    </Suspense>
  );
}
