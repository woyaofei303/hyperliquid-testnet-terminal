import type { Metadata } from 'next'
import { PhoneConnect } from '@/features/wallet/components/phone-connect'

export const metadata: Metadata = {
  title: '连接手机 App | fameex-testnet',
  description: '连接电脑钱包，用 fameex-testnet App 扫码并确认手机交易授权。',
  alternates: { canonical: '/connect' },
}

export default function Page() {
  return <PhoneConnect />
}
