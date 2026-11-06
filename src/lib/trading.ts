import { addressOf, assertSession, info } from './hyperliquid.ts'
import type { Ticket } from './order-ticket.ts'
import type { Market } from './orders.ts'
import { orderResult, type prepareOrder } from './orders.ts'
import {
  type ConversionKind,
  conversionKinds,
  prepareConversion,
} from './outcome-conversion.ts'
import { submitOrderTicket } from './submit-ticket.ts'
export type PreparedOrder = ReturnType<typeof prepareOrder>
export type Action = {
  account: `0x${string}`
  coin: string
  at: number
} & (
  | { kind: 'order'; order: PreparedOrder; orderKind: 'limit' | 'market' }
  | { kind: 'ticket'; ticket: Ticket }
  | {
      kind: 'outcome'
      market: Market
      conversion: ConversionKind
      amount: string
    }
  | { kind: 'twapCancel'; asset: number; twapId: number }
  | { kind: 'cancel'; asset: number; oid: number }
  | { kind: 'isolatedMargin'; asset: number; isBuy: boolean; ntli: number }
  | { kind: 'leverage'; asset: number; leverage: number; isCross: boolean }
)
export type ConfirmationAction = Extract<Action, { kind: 'order' | 'ticket' }>
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
  native?: 'twap' | 'trailing' | 'margin' | 'outcome'
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
        (value.native === 'twap' ||
          value.native === 'trailing' ||
          value.native === 'margin' ||
          value.native === 'outcome')
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
  next: Action,
  hasPending: boolean,
  onPending: (pending: PendingOrder | null) => void,
): Promise<Omit<JournalEntry, 'at'>> {
  if (!wallet.exchange || Date.now() >= wallet.expiresAt)
    throw new Error('请先完成钱包连接')
  const base = { account: next.account, coin: next.coin }
  if (next.kind === 'outcome') {
    if (hasPending || loadPending(wallet.address))
      throw new Error('请先查询上一笔未确认请求')
    if (Date.now() - next.at > 15000)
      throw new Error('转换预览已过期，请重新确认')
    const [spot, meta] = await Promise.all([
      info.spotClearinghouseState({ user: wallet.address }),
      info.outcomeMeta(),
    ])
    const current = meta.outcomes.find(
      (item) => item.outcome === next.market.outcome,
    )
    if (!current || current.quoteToken !== next.market.quote)
      throw new Error('预测市场已变化，请刷新市场后重试')
    const question = meta.questions.find(
      (item) => item.question === next.market.question,
    )
    const market = {
      ...next.market,
      question: question?.question,
      questionOutcomes: question
        ? [...question.namedOutcomes, question.fallbackOutcome]
        : undefined,
    }
    if (
      ['mergeQuestion', 'negateOutcome'].includes(next.conversion) &&
      JSON.stringify(
        [...(next.market.questionOutcomes ?? [])].sort((a, b) => a - b),
      ) !==
        JSON.stringify(
          [...(market.questionOutcomes ?? [])].sort((a, b) => a - b),
        )
    )
      throw new Error('预测问题已变化，请刷新市场后重新预览')
    const params = prepareConversion(
      next.conversion,
      market,
      next.amount,
      spot.balances,
    )
    await assertSession(wallet)
    const expiresAt = Math.min(Date.now() + 60000, wallet.expiresAt)
    onPending({
      ...base,
      cloid: `0x${crypto.randomUUID().replaceAll('-', '')}`,
      expiresAt,
      native: 'outcome',
    })
    const response = await wallet.exchange.userOutcome(params, {
      expiresAfter: expiresAt,
    })
    if (response?.status !== 'ok' || response.response?.type !== 'default')
      throw new Error('转换回报未确认，请核对余额后再操作')
    onPending(null)
    return {
      ...base,
      action: next.conversion,
      state: 'accepted',
      message: `${conversionKinds.find(([key]) => key === next.conversion)?.[1]}已完成：${next.amount} 份`,
    }
  }
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
  if (next.kind === 'isolatedMargin') {
    if (hasPending || loadPending(wallet.address))
      throw new Error('请先查询上一笔未确认请求')
    if (Date.now() - next.at > 15000)
      throw new Error('保证金快照已过期，请重新确认')
    if (!Number.isSafeInteger(next.ntli) || next.ntli === 0)
      throw new Error('保证金金额无效')
    const expiresAt = Math.min(Date.now() + 60000, wallet.expiresAt)
    onPending({
      account: next.account,
      coin: next.coin,
      expiresAt,
      cloid: `0x${crypto.randomUUID().replaceAll('-', '')}`,
      native: 'margin',
    })
    await wallet.exchange.updateIsolatedMargin(
      { asset: next.asset, isBuy: next.isBuy, ntli: next.ntli },
      { expiresAfter: expiresAt },
    )
    onPending(null)
    return {
      ...base,
      action: 'isolatedMargin',
      state: 'confirmed',
      message: '逐仓保证金已调整，正在刷新仓位。',
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
