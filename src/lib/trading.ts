import { addressOf } from './hyperliquid.ts'
import type { Ticket } from './order-ticket.ts'
import { orderResult, type prepareOrder } from './orders.ts'
import { submitOrderTicket } from './submit-ticket.ts'
export type PreparedOrder = ReturnType<typeof prepareOrder>
export type Action = {
  account: `0x${string}`
  coin: string
  at: number
} & (
  | { kind: 'approve' }
  | { kind: 'order'; order: PreparedOrder; orderKind: 'limit' | 'market' }
  | { kind: 'ticket'; ticket: Ticket }
  | { kind: 'twapCancel'; asset: number; twapId: number }
  | { kind: 'cancel'; asset: number; oid: number }
  | { kind: 'leverage'; asset: number; leverage: number; isCross: boolean }
)
export type ConfirmationAction = Extract<
  Action,
  { kind: 'approve' | 'order' | 'ticket' }
>
export interface JournalEntry {
  at: string
  account: string
  action: string
  coin: string
  message: string
  state: string
  oid?: number
  cloid?: string
}
export interface PendingOrder {
  account: `0x${string}`
  cloid: `0x${string}`
  coin: string
  expiresAt: number
  cloids?: `0x${string}`[]
  native?: 'twap' | 'trailing'
}
export const pendingKey = 'hl-testnet-pending-order'

export function loadPending(account: string): PendingOrder | null {
  try {
    const value: unknown = JSON.parse(
      localStorage.getItem(`${pendingKey}:${account.toLowerCase()}`) ?? 'null',
    )
    if (
      value &&
      typeof value === 'object' &&
      'account' in value &&
      typeof value.account === 'string' &&
      'cloid' in value &&
      typeof value.cloid === 'string' &&
      /^0x[0-9a-f]{32}$/.test(value.cloid) &&
      'coin' in value &&
      typeof value.coin === 'string' &&
      'expiresAt' in value &&
      typeof value.expiresAt === 'number'
    ) {
      return {
        account: addressOf(value.account),
        cloid: `0x${value.cloid.slice(2)}`,
        coin: value.coin,
        expiresAt: value.expiresAt,
        ...('cloids' in value &&
        Array.isArray(value.cloids) &&
        value.cloids.length > 0 &&
        value.cloids.length <= 50 &&
        value.cloids.every(
          (id) => typeof id === 'string' && /^0x[0-9a-f]{32}$/.test(id),
        )
          ? { cloids: value.cloids }
          : {}),
        ...('native' in value &&
        (value.native === 'twap' || value.native === 'trailing')
          ? { native: value.native }
          : {}),
      }
    }
  } catch {
    /* 损坏的本地记录不能成为账户或签名来源。 */
  }
  return null
}

export function validateLeverage(
  value: string,
  isCross: boolean,
  market: { maxLeverage: number; onlyIsolated?: boolean; marginMode?: string },
) {
  const n = Number(value)
  if (!Number.isInteger(n) || n < 1 || n > market.maxLeverage)
    throw new Error(`杠杆需为 1 至 ${market.maxLeverage} 的整数`)
  if (isCross && (market.onlyIsolated || market.marginMode))
    throw new Error('该市场仅支持逐仓')
  return n
}

export async function submitTrade(
  wallet: import('./hyperliquid').WalletSession,
  next: Exclude<Action, { kind: 'approve' }>,
  hasPending: boolean,
  onPending: (pending: PendingOrder | null) => void,
): Promise<Omit<JournalEntry, 'at'>> {
  if (!wallet.exchange || Date.now() >= wallet.expiresAt)
    throw new Error('请先启用交易')
  const base = { account: next.account, coin: next.coin }
  if (next.kind === 'ticket') {
    if (hasPending || loadPending(wallet.address))
      throw new Error('请先查询上一笔未确认请求')
    if (Date.now() - next.at > 15000)
      throw new Error('订单预览已超过 15 秒，请重新预览')
    return submitOrderTicket(wallet, next.coin, next.ticket, onPending)
  }
  if (next.kind === 'twapCancel') {
    await wallet.exchange.twapCancel({ a: next.asset, t: next.twapId })
    return {
      ...base,
      action: 'twapCancel',
      state: 'canceled',
      oid: next.twapId,
      message: `TWAP #${next.twapId} 已停止，已成交部分不回滚`,
    }
  }
  if (next.kind === 'order') {
    if (hasPending || loadPending(wallet.address))
      throw new Error('请先查询上一笔未确认订单')
    if (next.order.t.limit.tif === 'Ioc' && Date.now() - next.at > 15000)
      throw new Error('市价预览已超过 15 秒，请重新获取报价')
    const cloid: `0x${string}` = `0x${crypto.randomUUID().replaceAll('-', '')}`
    const expiresAt = Math.min(Date.now() + 60000, wallet.expiresAt)
    onPending({ account: next.account, cloid, coin: next.coin, expiresAt })
    const response = await wallet.exchange.order(
      { orders: [{ ...next.order, c: cloid }], grouping: 'na' },
      { expiresAfter: expiresAt },
    )
    const result = orderResult(
      response,
      next.order.s,
      next.order.t.limit.tif === 'Ioc',
    )
    if (result.state !== 'pending') onPending(null)
    return {
      ...base,
      action: next.order.r ? 'reduce' : 'order',
      ...result,
      cloid,
    }
  }
  if (next.kind === 'cancel') {
    const response = await wallet.exchange.cancel({
      cancels: [{ a: next.asset, o: next.oid }],
    })
    if (response.response.data.statuses[0] !== 'success')
      throw new Error('撤单回报未确认，请查询当前委托')
    return {
      ...base,
      action: 'cancel',
      state: 'canceled',
      oid: next.oid,
      message: `已撤销订单 #${next.oid}`,
    }
  }
  await wallet.exchange.updateLeverage({
    asset: next.asset,
    isCross: next.isCross,
    leverage: next.leverage,
  })
  return {
    ...base,
    action: 'leverage',
    state: 'confirmed',
    message: `已设置 ${next.coin} ${next.isCross ? '全仓' : '逐仓'} ${next.leverage} 倍杠杆`,
  }
}
