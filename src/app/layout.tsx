import type { Metadata } from 'next'
import './globals.css'
import { Providers } from '@/app/providers'

export const metadata: Metadata = {
  applicationName: 'Hyperliquid Terminal',
  metadataBase: new URL('https://app.fameex-testnet.xyz'),
  alternates: { canonical: '/' },
}

export default function Layout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN" className="dark">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
