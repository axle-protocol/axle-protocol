import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'AXLE Earn | Work-to-Earn Dashboard',
  description: 'Earn $AXLE tokens by contributing to the AXLE Protocol ecosystem',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
