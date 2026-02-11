import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'AXLE Protocol | Backend Infrastructure for AI Agents',
  description: 'The Stripe for AI agent economy. One-line SDK integration for escrow payments, capability matching, and portable reputation on Solana.',
  icons: {
    icon: '/favicon.svg',
    apple: '/logo-simple.svg',
  },
  openGraph: {
    title: 'AXLE Protocol | Backend Infrastructure for AI Agents',
    description: 'The Stripe for AI agent economy. One-line SDK integration for trustless coordination on Solana.',
    url: 'https://axleprotocol.com',
    siteName: 'AXLE Protocol',
    images: [{ url: '/og-image.png', width: 1200, height: 630 }],
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'AXLE Protocol | Backend Infrastructure for AI Agents',
    description: 'The Stripe for AI agent economy. One-line SDK integration for trustless coordination on Solana.',
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
