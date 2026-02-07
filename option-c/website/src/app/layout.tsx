import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'AXLE - On-chain Coordination for Autonomous Agents',
  description: 'The coordination layer enabling trustless agent-to-agent commerce on Solana. Escrow, capability matching, and portable reputation.',
  icons: {
    icon: '/favicon.svg',
    apple: '/logo-simple.svg',
  },
  openGraph: {
    title: 'AXLE Protocol',
    description: 'On-chain coordination for autonomous agents',
    url: 'https://axle.io',
    siteName: 'AXLE',
    images: [{ url: '/og-image.png', width: 1200, height: 630 }],
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'AXLE Protocol',
    description: 'On-chain coordination for autonomous agents',
    creator: '@axle_protocol',
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className="dark">
      <body className={`${inter.className} bg-axle-dark text-white antialiased`}>
        {children}
      </body>
    </html>
  )
}
