import type { UserFundingResponse } from '@nktkas/hyperliquid/api/info'
import { Money } from './orders.ts'

export async function fundingPages(
  request: (start: number) => Promise<UserFundingResponse>,
  start: number,
) {
  const result = new Map<string, UserFundingResponse[number]>()
  let cursor = start
  for (let page = 0; page < 20; page++) {
    const rows = await request(cursor)
    for (const row of rows)
      result.set(`${row.hash}:${row.time}:${row.delta.coin}`, row)
    const last = Math.max(...rows.map((row) => row.time))
    if (rows.length < 500) return [...result.values()]
    // 包含边界区块，再按流水去重，避免跳过同一时间的其他市场。
    if (last <= cursor) break
    cursor = last
  }
  throw new Error('记录超过单次加载上限，请缩短时间范围')
}

export function balanceValues(
  balance: { total: string; hold: string; entryNtl: string },
  mark: string,
) {
  const total = new Money(balance.total),
    hold = new Money(balance.hold),
    entry = new Money(balance.entryNtl)
  if (
    ![total, hold, entry].every((n) => n.isFinite()) ||
    total.lt(0) ||
    hold.lt(0)
  )
    throw new Error('余额数据无效')
  const price = mark ? new Money(mark) : null
  const value = price?.isFinite() && price.gte(0) ? total.times(price) : null
  const pnl = value && entry.gt(0) ? value.minus(entry) : null
  return {
    available: Money.max(0, total.minus(hold)).toFixed(),
    value: value?.toFixed() ?? null,
    entryPrice: total.gt(0) && entry.gt(0) ? entry.div(total).toFixed() : null,
    pnl: pnl?.toFixed() ?? null,
    roe: pnl ? pnl.div(entry).times(100).toFixed() : null,
  }
}
export const historyKey = (oid: number, status: string, time: number) =>
  `${oid}:${status}:${time}`
export function orderStatusLabel(status: string) {
  const labels: Record<string, string> = {
    open: '未成交',
    filled: '已成交',
    canceled: '已取消',
    triggered: '已触发',
    rejected: '已拒绝',
    outcomeSettledCanceled: '预测已结算，订单取消',
    marginCanceled: '保证金不足，订单取消',
    reduceOnlyCanceled: '只减仓条件不满足',
    siblingFilledCanceled: '关联订单已成交',
    liquidatedCanceled: '已清算，订单取消',
    scheduledCancel: '定时取消',
    iocCancelRejected: '未立即成交',
    badAloPxRejected: '挂单将立即成交',
    insufficientSpotBalanceRejected: '现货余额不足',
  }
  return labels[status] ?? status
}
export function recordsCsv(headers: string[], rows: (string | number)[][]) {
  const cell = (value: string | number) => {
    const text = String(value)
    const safe =
      /^[\s]*[=+@\t\r]/.test(text) ||
      (/^-/.test(text) && !/^-\d+(\.\d+)?$/.test(text))
        ? `'${text}`
        : text
    return `"${safe.replaceAll('"', '""')}"`
  }
  return `\uFEFF${[headers, ...rows].map((row) => row.map(cell).join(',')).join('\r\n')}`
}
