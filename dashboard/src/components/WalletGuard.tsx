'use client';

import { useWallet } from '@solana/wallet-adapter-react';
import dynamic from 'next/dynamic';

const WalletMultiButton = dynamic(
  () =>
    import('@solana/wallet-adapter-react-ui').then(
      (m) => m.WalletMultiButton
    ),
  { ssr: false }
);

export default function WalletGuard({ children }: { children: React.ReactNode }) {
  const { connected } = useWallet();

  if (!connected) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-6">
        <div className="text-center">
          <h2 className="text-xl font-semibold text-white">
            Connect Your Wallet
          </h2>
          <p className="mt-2 text-sm text-gray-400">
            Connect a Solana wallet to interact with the AXLE Protocol
          </p>
        </div>
        <WalletMultiButton />
      </div>
    );
  }

  return <>{children}</>;
}
