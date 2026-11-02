import type { Metadata } from 'next'
import './globals.css'
import { Providers } from '@/components/providers'

export const metadata: Metadata = {
  metadataBase: new URL('https://hyperliquid.sunshinedairy.net'),
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
