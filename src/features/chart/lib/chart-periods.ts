import type { Period } from 'klinecharts'
export const chartIntervals = [
  '1m',
  '3m',
  '5m',
  '15m',
  '30m',
  '1h',
  '2h',
  '4h',
  '8h',
  '12h',
  '1d',
  '3d',
  '1w',
  '1M',
] as const
export type ChartInterval = (typeof chartIntervals)[number]
export const chartResolutions: Record<ChartInterval, string> = {
  '1m': '1',
  '3m': '3',
  '5m': '5',
  '15m': '15',
  '30m': '30',
  '1h': '60',
  '2h': '120',
  '4h': '240',
  '8h': '480',
  '12h': '720',
  '1d': '1D',
  '3d': '3D',
  '1w': '1W',
  '1M': '1M',
}
export const chartPeriods: Record<ChartInterval, Period> = Object.fromEntries(
  chartIntervals.map((value) => [
    value,
    {
      span: Number.parseInt(value, 10),
      type: (
        { m: 'minute', h: 'hour', d: 'day', w: 'week', M: 'month' } as const
      )[value.slice(-1) as 'm' | 'h' | 'd' | 'w' | 'M'],
    },
  ]),
) as Record<ChartInterval, Period>
// 月周期的 30 天只用于查询窗口；K 线时间戳始终采用交易所返回值。
export const intervalMs = (value: ChartInterval) =>
  Number.parseInt(value, 10) *
  ({ m: 60000, h: 3600000, d: 86400000, w: 604800000, M: 2592000000 }[
    value.slice(-1)
  ] ?? 0)

export const historyPageSize = 300
export function candleHistoryStart(
  end: number,
  count: number,
  interval: ChartInterval,
) {
  if (interval === '1M') {
    const date = new Date(end - 1)
    return Math.max(
      0,
      Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - count + 1, 1),
    )
  }
  const step = intervalMs(interval)
  const anchor = interval === '1w' ? 4 * 86400000 : 0
  return Math.max(
    0,
    Math.ceil((end - anchor) / step) * step + anchor - count * step,
  )
}
