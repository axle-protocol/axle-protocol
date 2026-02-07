import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'PACT Dashboard — Protocol for Agent Coordination & Tasks',
  description: 'God View dashboard for the PACT protocol',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
