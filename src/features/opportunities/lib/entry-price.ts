import type { assessCandidate, PositionSummary } from './candidates.ts'
import type { Quote } from './mainnet-read.ts'
import { decimal } from './opportunities.ts'

export const QUOTE_STALE_MS = 10_000

export function compareEntry(
  summary: PositionSummary,
  assessment: ReturnType<typeof assessCandidate>,
  quote: Quote | undefined,
  now: number,
  connected: boolean,
) {
  const unavailable = (reason: string) => ({
    available: false as const,
    reason,
  })
  if (!connected) return unavailable('盘口未连接或观察已暂停')
  if (assessment.status === '待核验')
    return unavailable('仓位数据待核验，暂停价格比较')
  if (decimal(summary.currentPosition).isZero())
    return unavailable('持仓已退出，不再比较入场价格')
  const reference = assessment.averageEntryPrice
  if (!reference) return unavailable('近 5 分钟没有新增仓位成交均价')
  if (!quote || quote.coin !== summary.coin)
    return unavailable('等待该币种有效盘口')
  if (
    now - quote.time > QUOTE_STALE_MS ||
    now - quote.receivedAt > QUOTE_STALE_MS ||
    quote.time > now + 10_000 ||
    quote.receivedAt > now + 10_000
  )
    return unavailable('盘口超过 10 秒未更新或时间异常')
  if (quote.time < summary.lastTime)
    return unavailable('盘口早于最近成交，等待更新')
  const side = summary.side === 'long' ? 'ask' : 'bid'
  const level = quote[side]
  if (!level)
    return unavailable(side === 'ask' ? '当前卖一无报价' : '当前买一无报价')
  const adversePercent = decimal(level.px)
    .minus(decimal(reference))
    .div(decimal(reference))
    .times(summary.side === 'long' ? 100 : -100)
  return {
    available: true as const,
    side,
    price: level.px,
    size: level.sz,
    reference,
    quoteTime: quote.time,
    adversePercent: adversePercent.toFixed(),
  }
}
