import { assessCandidate, type PositionSummary } from './candidates.ts'
import { compareEntry, QUOTE_STALE_MS } from './entry-price.ts'
import type { Quote } from './mainnet-read.ts'
import { type Coin, decimal } from './opportunities.ts'

export const HORIZONS = [1, 5, 15] as const
export const MAX_FOLLOWUPS = 100
type Point = { minutes: number; dueAt: number } & (
  | { status: 'pending' }
  | { status: 'missing'; reason: string }
  | { status: 'measured'; sampledAt: number; quote: Quote; percent: string }
)
export interface Followup {
  id: string
  address: string
  coin: Coin
  side: PositionSummary['side']
  detectedAt: number
  checkedAt: number
  lastTime: number
  signal: ReturnType<typeof assessCandidate>
  entry: ReturnType<typeof compareEntry>
  entryQuote: Quote | undefined
  points: Point[]
}

export interface PriceSample {
  coin: Coin
  side: 'long' | 'short'
  entry: { available: true; price: string } | { available: false }
  points: Point[]
}

export function samplePoints(
  record: PriceSample,
  quotes: Partial<Record<Coin, Quote>>,
  now: number,
  connected: boolean,
): Point[] {
  const points = record.points.map((point): Point => {
    if (point.status !== 'pending' || now < point.dueAt) return point
    if (now > point.dueAt + QUOTE_STALE_MS)
      return {
        ...point,
        status: 'missing',
        reason: '目标时间后 10 秒内未采集到有效盘口',
      }
    const quote = quotes[record.coin]
    const exit = record.side === 'long' ? quote?.bid : quote?.ask
    if (
      !record.entry.available ||
      !connected ||
      !quote ||
      !exit ||
      quote.coin !== record.coin ||
      quote.time < point.dueAt ||
      quote.time > point.dueAt + QUOTE_STALE_MS ||
      quote.receivedAt < point.dueAt ||
      quote.receivedAt > now
    )
      return point
    return {
      ...point,
      status: 'measured',
      sampledAt: now,
      quote,
      percent: decimal(exit.px)
        .minus(decimal(record.entry.price))
        .div(decimal(record.entry.price))
        .times(record.side === 'long' ? 100 : -100)
        .toFixed(),
    }
  })
  return points.every((point, index) => point === record.points[index])
    ? record.points
    : points
}

export function updateFollowups(
  previous: Followup[],
  summaries: PositionSummary[],
  quotes: Partial<Record<Coin, Quote>>,
  now: number,
  connected: boolean,
): Followup[] {
  const records = previous.map((record) => {
    const points = samplePoints(record, quotes, now, connected)
    return points === record.points ? record : { ...record, points }
  })
  for (const summary of summaries) {
    // shortcut: 本机仅保留前 100 条且不淘汰失败样本；扩大样本时改用后台采集存储。
    if (records.length >= MAX_FOLLOWUPS) break
    if (records.some((record) => record.id === summary.id)) continue
    const signal = assessCandidate(summary, now)
    if (!signal.eligible) continue
    const entryQuote = quotes[summary.coin]
    const entry = compareEntry(summary, signal, entryQuote, now, connected)
    records.push({
      id: summary.id,
      address: summary.address,
      coin: summary.coin,
      side: summary.side,
      detectedAt: now,
      checkedAt: summary.checkedAt,
      lastTime: summary.lastTime,
      signal,
      entry,
      entryQuote,
      points: HORIZONS.map(
        (minutes): Point => ({
          minutes,
          dueAt: now + minutes * 60_000,
          ...(entry.available
            ? { status: 'pending' }
            : { status: 'missing', reason: `起点报价不可用：${entry.reason}` }),
        }),
      ),
    })
  }
  return records.length === previous.length &&
    records.every((record, index) => record === previous[index])
    ? previous
    : records
}

export function summarizeFollowups(records: Pick<Followup, 'points'>[]) {
  return HORIZONS.map((minutes) => {
    const points = records.flatMap((record) =>
      record.points.filter((point) => point.minutes === minutes),
    )
    const measured = points.filter((point) => point.status === 'measured')
    return {
      minutes,
      total: records.length,
      measured: measured.length,
      missing: points.filter((point) => point.status === 'missing').length,
      pending: points.filter((point) => point.status === 'pending').length,
      positive: measured.filter((point) => decimal(point.percent).gt(0)).length,
      averagePercent: measured.length
        ? measured
            .reduce(
              (sum, point) => sum.plus(decimal(point.percent)),
              decimal('0'),
            )
            .div(measured.length)
            .toFixed()
        : null,
    }
  })
}
