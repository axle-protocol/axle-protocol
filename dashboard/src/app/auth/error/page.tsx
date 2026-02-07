'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import Link from 'next/link';

const ERROR_MESSAGES: Record<string, { ko: string; en: string }> = {
  access_denied: { ko: 'X 인증이 거부되었습니다', en: 'X authentication was denied' },
  invalid_state: { ko: '인증 세션이 만료되었습니다', en: 'Auth session expired' },
  missing_params: { ko: '필수 파라미터가 누락되었습니다', en: 'Missing required parameters' },
  token_exchange_failed: { ko: '토큰 교환에 실패했습니다', en: 'Token exchange failed' },
  profile_fetch_failed: { ko: '프로필 조회에 실패했습니다', en: 'Profile fetch failed' },
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
          <a
            href="/api/auth/twitter"
            className="rounded-lg bg-axle-accent px-6 py-2 text-sm font-semibold text-black transition hover:bg-axle-accent/80"
          >
            Try Again
          </a>
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
