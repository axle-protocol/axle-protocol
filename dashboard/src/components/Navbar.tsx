'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import dynamic from 'next/dynamic';

const WalletMultiButton = dynamic(
  () =>
    import('@solana/wallet-adapter-react-ui').then(
      (m) => m.WalletMultiButton
    ),
  { ssr: false }
);

const NAV_LINKS = [
  { href: '/', label: 'Dashboard' },
  { href: '/tasks', label: 'Tasks' },
  { href: '/register', label: 'Register' },
];

const EXTERNAL_LINK = { href: 'https://axleprotocol.com', label: '← Website' };

export default function Navbar() {
  const pathname = usePathname();

  return (
    <nav className="fixed top-0 z-50 w-full border-b border-axle-border bg-axle-dark/80 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4">
        <div className="flex items-center gap-8">
          <a 
            href="https://axleprotocol.com" 
            className="flex items-center gap-3 hover:opacity-80 transition"
            title="Back to Website"
          >
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-[#4F7BFF] via-[#7B68EE] to-[#9B6DFF] flex items-center justify-center shadow-lg shadow-purple-500/20">
              <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round">
                <circle cx="12" cy="12" r="3" />
                <line x1="12" y1="3" x2="12" y2="7" />
                <line x1="12" y1="17" x2="12" y2="21" />
                <line x1="3" y1="12" x2="7" y2="12" />
                <line x1="17" y1="12" x2="21" y2="12" />
                <circle cx="12" cy="3" r="1.5" fill="white" stroke="none" />
                <circle cx="12" cy="21" r="1.5" fill="white" stroke="none" />
                <circle cx="3" cy="12" r="1.5" fill="white" stroke="none" />
                <circle cx="21" cy="12" r="1.5" fill="white" stroke="none" />
              </svg>
            </div>
            <span className="text-lg font-bold bg-gradient-to-r from-[#4F7BFF] to-[#9B6DFF] bg-clip-text text-transparent">AXLE</span>
          </a>
          <div className="flex items-center gap-1">
            {NAV_LINKS.map((link) => {
              const active = pathname === link.href;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`rounded-lg px-3 py-1.5 text-sm transition ${
                    active
                      ? 'bg-axle-accent/10 text-axle-accent'
                      : 'text-gray-400 hover:text-white'
                  }`}
                >
                  {link.label}
                </Link>
              );
            })}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <a
            href="/api/auth/twitter"
            className="flex items-center gap-1.5 rounded-lg border border-axle-border bg-axle-card px-3 py-1.5 text-sm text-gray-400 transition hover:border-axle-accent hover:text-white"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
              <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
            </svg>
            Agent Auth
          </a>
          <WalletMultiButton />
        </div>
      </div>
    </nav>
  );
}
