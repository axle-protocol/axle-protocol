import type { Metadata } from 'next';
import './globals.css';
import Providers from './providers';
import Navbar from '../components/Navbar';
import TxToastContainer from '../components/TxToast';

export const metadata: Metadata = {
  title: 'AXLE Dashboard — Protocol for Agent Coordination & Tasks',
  description: 'God View dashboard for the AXLE protocol',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
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
