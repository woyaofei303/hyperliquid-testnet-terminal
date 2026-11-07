import type {
  CandleSnapshotResponse,
  RecentTradesResponse,
} from '@nktkas/hyperliquid/api/info'

export type Candle = CandleSnapshotResponse[number]
export type MarketTrade = RecentTradesResponse[number]

export function mergeTrades(
  coin: string,
  history: MarketTrade[],
  updates: MarketTrade[],
) {
  const trades = new Map<number, MarketTrade>()
  for (const trade of [
    ...history,
    ...(Array.isArray(updates) ? updates : []),
  ]) {
    if (
      !trade ||
      trade.coin !== coin ||
      !['A', 'B'].includes(trade.side) ||
      !Number.isSafeInteger(trade.tid) ||
      trade.tid < 0 ||
      !Number.isSafeInteger(trade.time) ||
      trade.time < 0 ||
      trade.time > 8640000000000000 ||
      !Number.isFinite(Number(trade.px)) ||
      Number(trade.px) <= 0 ||
      !Number.isFinite(Number(trade.sz)) ||
      Number(trade.sz) <= 0
    )
      continue
    trades.set(trade.tid, trade)
  }
  return [...trades.values()]
    .sort((a, b) => b.time - a.time || b.tid - a.tid)
    .slice(0, 100)
}

export function mergeCandles(history: Candle[], updates: Candle[]) {
  const candles = new Map(history.map((c) => [c.t, c]))
  for (const candle of updates) candles.set(candle.t, candle)
  return [...candles.values()].sort((a, b) => a.t - b.t).slice(-5000)
}
