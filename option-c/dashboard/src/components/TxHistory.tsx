'use client';

import { useEffect, useState, useCallback } from 'react';
import { Connection, type ConfirmedSignatureInfo } from '@solana/web3.js';
import { PROGRAM_ID, RPC_URL, solscanTxUrl, solscanAccountUrl } from '../lib/constants';

function relativeTime(timestamp: number | null | undefined): string {
  if (!timestamp) return '—';
  const diff = Date.now() - timestamp * 1000;
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

function StatusBadge({ status }: { status: string | null }) {
  const colors: Record<string, string> = {
    finalized: 'bg-axle-green/20 text-axle-green',
    confirmed: 'bg-axle-yellow/20 text-axle-yellow',
    failed: 'bg-axle-red/20 text-axle-red',
  };
  const label = status || 'confirmed';
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${colors[label] || colors.confirmed}`}
    >
      {label}
    </span>
  );
}

export default function TxHistory() {
  const [signatures, setSignatures] = useState<ConfirmedSignatureInfo[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchSignatures = useCallback(async () => {
    try {
      const connection = new Connection(RPC_URL, 'confirmed');
      const sigs = await connection.getSignaturesForAddress(PROGRAM_ID, {
        limit: 20,
      });
      setSignatures(sigs);
    } catch {
      // Silently fail, keep stale data
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSignatures();
    const iv = setInterval(fetchSignatures, 5000);
    return () => clearInterval(iv);
  }, [fetchSignatures]);

  return (
    <div>
      <div className="mb-3 flex items-center gap-2 text-xs text-gray-500">
        <span>Program:</span>
        <a
          href={solscanAccountUrl(PROGRAM_ID.toBase58())}
          target="_blank"
          rel="noopener noreferrer"
          className="font-mono text-axle-accent hover:underline"
        >
          {PROGRAM_ID.toBase58().slice(0, 12)}...
        </a>
      </div>

      {loading ? (
        <p className="py-8 text-center text-gray-600">Loading transactions...</p>
      ) : signatures.length === 0 ? (
        <p className="py-8 text-center text-gray-600">No transactions found</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-axle-border text-left text-xs uppercase tracking-wider text-gray-500">
                <th className="pb-3 pr-4">Signature</th>
                <th className="pb-3 pr-4">Status</th>
                <th className="pb-3 text-right">Time</th>
              </tr>
            </thead>
            <tbody>
              {signatures.map((sig) => (
                <tr
                  key={sig.signature}
                  className="border-b border-axle-border/50 hover:bg-white/[0.02]"
                >
                  <td className="py-3 pr-4">
                    <a
                      href={solscanTxUrl(sig.signature)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-mono text-xs text-axle-accent hover:underline"
                    >
                      {sig.signature.slice(0, 8)}...{sig.signature.slice(-4)}
                    </a>
                  </td>
                  <td className="py-3 pr-4">
                    <StatusBadge
                      status={sig.err ? 'failed' : sig.confirmationStatus || null}
                    />
                  </td>
                  <td className="py-3 text-right text-xs text-gray-400">
                    {relativeTime(sig.blockTime)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
