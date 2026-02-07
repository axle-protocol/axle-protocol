'use client';

import { useCallback, useEffect, useState } from 'react';
import { solscanTxUrl } from '../lib/constants';

interface Toast {
  id: number;
  type: 'success' | 'error';
  ko: string;
  en: string;
  txSignature?: string;
  actionUrl?: string;
  actionLabel?: string;
}

let toastId = 0;
const listeners: Set<(toast: Toast) => void> = new Set();

export function showTxToast(
  type: 'success' | 'error',
  ko: string,
  en: string,
  txSignature?: string,
  actionUrl?: string,
  actionLabel?: string
) {
  const toast: Toast = { id: ++toastId, type, ko, en, txSignature, actionUrl, actionLabel };
  listeners.forEach((fn) => fn(toast));
}

export default function TxToastContainer() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = useCallback((toast: Toast) => {
    setToasts((prev) => [...prev, toast]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== toast.id));
    }, 8000);
  }, []);

  useEffect(() => {
    listeners.add(addToast);
    return () => {
      listeners.delete(addToast);
    };
  }, [addToast]);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`w-80 rounded-lg border p-4 shadow-lg backdrop-blur ${
            toast.type === 'success'
              ? 'border-axle-green/30 bg-axle-green/10'
              : 'border-axle-red/30 bg-axle-red/10'
          }`}
        >
          <p className="text-sm font-medium text-white">{toast.ko}</p>
          {toast.ko !== toast.en && (
            <p className="mt-0.5 text-xs text-gray-400">{toast.en}</p>
          )}
          {toast.txSignature && (
            <a
              href={solscanTxUrl(toast.txSignature)}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-block text-xs text-axle-accent hover:underline"
            >
              View on Solscan &rarr;
            </a>
          )}
          {toast.actionUrl && (
            <a
              href={toast.actionUrl}
              className="mt-2 inline-block rounded bg-axle-accent/20 px-3 py-1 text-xs font-medium text-axle-accent hover:bg-axle-accent/30 transition"
            >
              {toast.actionLabel || 'Go'} &rarr;
            </a>
          )}
        </div>
      ))}
    </div>
  );
}
