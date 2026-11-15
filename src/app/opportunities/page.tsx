import type { Metadata } from 'next'
import { OpportunityBoard } from '@/features/opportunities/components/opportunity-board'

export const metadata: Metadata = {
  title: '主网只读机会观察 | FameEX',
  alternates: { canonical: '/opportunities' },
}

export default function Page() {
  return <OpportunityBoard />
}
