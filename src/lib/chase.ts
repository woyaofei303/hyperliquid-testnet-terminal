import { ApiRequestError } from '@nktkas/hyperliquid/api/exchange'
import type { Book, WalletSession } from './hyperliquid.ts'
import { chasePrice } from './order-ticket.ts'
import { type Market, Money, type prepareOrder } from './orders.ts'
import {
  type PendingOrder,
  type PreparedOrder,
  submitTrade,
} from './trading.ts'

export function chaseQuote(
  book: Book | null,
  order: ReturnType<typeof prepareOrder>,
  market: Pick<Market, 'kind' | 'szDecimals'>,
  ownPrice?: string,
) {
  if (!book || Date.now() - book.time > 5000)
    throw new Error('盘口过期，停止追价')
  const bid = book.levels[0][0]?.px
  const ask = book.levels[1][0]?.px
  if (!bid || !ask) throw new Error('盘口为空，停止追价')
  // 已占据最优档时不追逐自己的报价。
  if (ownPrice && new Money(ownPrice).eq(order.b ? bid : ask)) return ownPrice
  return chasePrice(bid, ask, order.b, order.p, market)
}
export function chaseRemainder(
  previous: string,
  remaining: string,
  status: string,
) {
  if (status === 'filled') return '0'
  if (status !== 'canceled')
    throw new Error(`撤单后状态为 ${status}，停止追价并等待核对`)
  const size = new Money(remaining)
  if (!size.isFinite() || size.lt(0) || size.gt(previous))
    throw new Error('剩余数量异常，停止追价')
  return size.toFixed()
}

export async function placeChaseOrder(
  wallet: WalletSession,
  coin: string,
  order: PreparedOrder,
  onPending: (value: PendingOrder | null) => void,
) {
  let created = false
  try {
    return await submitTrade(
      wallet,
      {
        kind: 'order',
        orderKind: 'limit',
        account: wallet.address,
        coin,
        at: Date.now(),
        order,
      },
      false,
      (value) => {
        created = value !== null
        onPending(value)
      },
    )
  } catch (error) {
    if (created && error instanceof ApiRequestError) onPending(null)
    throw error
  }
}
