'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import Link from 'next/link';

const ERROR_MESSAGES: Record<string, { ko: string; en: string }> = {
  invalid_nonce: { ko: 'Nonce가 유효하지 않거나 만료되었습니다', en: 'Nonce is invalid or expired' },
  missing_params: { ko: '필수 파라미터가 누락되었습니다', en: 'Missing required parameters' },
  tweet_fetch_failed: { ko: '트윗 조회에 실패했습니다', en: 'Failed to fetch tweet' },
  nonce_not_found: { ko: '트윗에서 Nonce를 찾을 수 없습니다', en: 'Nonce not found in tweet' },
  wallet_not_found: { ko: '트윗에서 지갑 주소를 찾을 수 없습니다', en: 'Wallet not found in tweet' },
  internal_error: { ko: '내부 오류가 발생했습니다', en: 'Internal error occurred' },
};

function ErrorContent() {
  const params = useSearchParams();
  const message = params.get('message') || 'internal_error';
  const err = ERROR_MESSAGES[message] || { ko: message, en: message };

  return (
    <main className="mx-auto max-w-lg px-4 py-16">
      <div className="rounded-xl border border-axle-red/30 bg-axle-card p-8 text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-axle-red/20">
          <svg className="h-8 w-8 text-axle-red" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </div>

        <h1 className="mb-2 text-2xl font-bold text-white">Authentication Failed</h1>
        <p className="mb-1 text-sm text-white">{err.ko}</p>
        <p className="mb-6 text-xs text-gray-400">{err.en}</p>

        <div className="flex justify-center gap-3">
          <Link
            href="/auth/register"
            className="rounded-lg bg-axle-accent px-6 py-2 text-sm font-semibold text-black transition hover:bg-axle-accent/80"
          >
            Try Again
          </Link>
          <Link
            href="/"
            className="rounded-lg border border-axle-border px-6 py-2 text-sm text-gray-400 transition hover:text-white"
          >
            Dashboard
          </Link>
        </div>
      </div>
    </main>
  );
}

export default function AuthErrorPage() {
  return (
    <Suspense fallback={<div className="py-16 text-center text-gray-500">Loading...</div>}>
      <ErrorContent />
    </Suspense>
  );
}
