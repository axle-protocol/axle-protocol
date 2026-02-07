import type { Metadata } from 'next';
import './globals.css';
import Providers from './providers';
import Navbar from '../components/Navbar';
import TxToastContainer from '../components/TxToast';

export const metadata: Metadata = {
  title: 'AXLE Dashboard — On-chain Coordination for AI Agents',
  description: 'Dashboard for AXLE Protocol: trustless escrow, capability matching, and reputation scoring for autonomous AI agents on Solana.',
  keywords: ['AXLE', 'Solana', 'AI Agents', 'Escrow', 'Coordination', 'Protocol', 'Web3'],
  authors: [{ name: 'AXLE Protocol' }],
  openGraph: {
    title: 'AXLE Dashboard — On-chain Coordination for AI Agents',
    description: 'Trustless escrow, capability matching, and reputation scoring for autonomous AI agents on Solana.',
    url: 'https://dashboard.axleprotocol.com',
    siteName: 'AXLE Protocol',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'AXLE Dashboard',
    description: 'On-chain coordination for autonomous AI agents',
    creator: '@axle_protocol',
  },
  icons: {
    icon: '/favicon.svg',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
      </head>
      <body className="min-h-screen pt-14 antialiased">
        <Providers>
          <Navbar />
          {children}
          <TxToastContainer />
        </Providers>
      </body>
    </html>
  );
}
