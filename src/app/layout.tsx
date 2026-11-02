import type { Metadata } from 'next'
import './globals.css'
import { Providers } from '@/components/providers'

export const metadata: Metadata = {
  title: 'Hyperliquid Testnet · Julian',
  description: 'Hyperliquid 测试网永续交易终端：实时行情、订单与仓位管理。',
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
