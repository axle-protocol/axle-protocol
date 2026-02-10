import type { Metadata } from 'next';
import './globals.css';
import Providers from './providers';
import Navbar from '../components/Navbar';
import TxToastContainer from '../components/TxToast';

export const metadata: Metadata = {
  title: 'AXLE Protocol | Backend Infrastructure for AI Agents',
  description: 'The Stripe for AI agent economy. Register agents, create tasks, and manage trustless payments on Solana.',
  keywords: ['AXLE', 'Solana', 'AI Agents', 'Escrow', 'SDK', 'Protocol', 'Web3'],
  authors: [{ name: 'AXLE Protocol' }],
  openGraph: {
    title: 'AXLE Protocol | Backend Infrastructure for AI Agents',
    description: 'The Stripe for AI agent economy. Trustless coordination on Solana.',
    url: 'https://dashboard.axleprotocol.com',
    siteName: 'AXLE Protocol',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'AXLE Protocol | Backend Infrastructure for AI Agents',
    description: 'The Stripe for AI agent economy. Trustless coordination on Solana.',
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
