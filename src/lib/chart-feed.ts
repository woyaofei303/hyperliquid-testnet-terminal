import type { DataLoader, KLineData, Period } from 'klinecharts'
import type {
  Bar,
  IBasicDataFeed,
  LibrarySymbolInfo,
  ResolutionString,
} from '../../public/lib/charting_library/charting_library'
import {
  type ChartInterval,
  chartIntervals,
  chartPeriods,
  chartResolutions,
  intervalMs,
} from './chart-periods.ts'
import { createFrameBatch } from './frame-batch.ts'
import type { Candle } from './market-data.ts'
import { performanceMetrics } from './performance.ts'

export {
  type ChartInterval,
  chartPeriods,
  chartResolutions,
} from './chart-periods.ts'

export function chartBars(
  candles: Candle[],
  coin: string,
  interval: ChartInterval,
): Bar[] {
  const rows = new Map<number, Bar>()
  for (const c of candles) {
    if (c.s !== coin || c.i !== interval) continue
    const bar = {
      time: c.t,
      open: Number(c.o),
      high: Number(c.h),
      low: Number(c.l),
      close: Number(c.c),
      volume: Number(c.v),
    }
    if (
      !Object.values(bar).every(Number.isFinite) ||
      bar.time <= 0 ||
      Math.min(bar.open, bar.high, bar.low, bar.close) <= 0 ||
      bar.volume < 0 ||
      bar.high < Math.max(bar.open, bar.close, bar.low) ||
      bar.low > Math.min(bar.open, bar.close)
    )
      continue
    rows.set(bar.time, bar)
  }
  return [...rows.values()].sort((a, b) => a.time - b.time)
}

const klineBar = ({ time, ...bar }: Bar): KLineData => ({
  timestamp: time,
  ...bar,
})

/** 两个图表共用 Hyperliquid 历史查询和 useMarket 的实时推送；不连接 FameEX 行情。 */
export interface ChartFeedContext {
  coin: string
  interval: ChartInterval
  szDecimals: number
  label?: string
  priceDecimals?: number
  history: (startTime: number, endTime: number) => Promise<Candle[]>
  onError: (message: string) => void
  onLoaded: (count: number) => void
}
export function createChartFeed(initial: ChartFeedContext) {
  let {
    coin,
    interval,
    szDecimals,
    label,
    priceDecimals,
    history,
    onError,
    onLoaded,
  } = initial
  let epoch = 0
  let active = true
  let updates: Bar[] = []
  let queuedCandles: Candle[] | null = null
  let visibleEngine: 'kline' | 'tradingview' | null = null
  let lastHistoryTime = 0
  const listeners = new Map<
    string,
    { callback: (bar: Bar) => void; last: number }
  >()
  const publish = () => {
    if (!active) return
    if (queuedCandles) {
      updates = chartBars(queuedCandles, coin, interval)
      queuedCandles = null
    }
    for (const [id, listener] of listeners) {
      const engine = id === 'kline' ? 'kline' : 'tradingview'
      if (visibleEngine && engine !== visibleEngine) continue
      performanceMetrics.measure(engine, () => {
        for (const bar of updates) {
          if (bar.time < listener.last) continue
          listener.callback({ ...bar })
          listener.last = bar.time
        }
      })
    }
  }
  let frame = createFrameBatch('chartFeed', publish)
  const defer = (fn: () => void, generation = epoch) =>
    setTimeout(() => {
      if (active && generation === epoch) fn()
    }, 0)
  let step = intervalMs(interval)
  let resolution = chartResolutions[interval] as ResolutionString
  let period = chartPeriods[interval]
  const matches = (symbol: string, value: Period) =>
    symbol === coin && value.span === period.span && value.type === period.type
  const fail = (error: unknown) =>
    onError(error instanceof Error ? error.message : String(error))

  async function load(end: number, count: number, initial: boolean) {
    const generation = epoch
    // Hyperliquid 仅提供最近 5000 根；to 不包含边界蜡烛，避免翻页重复。
    const start = Math.max(
      end - Math.min(count, 5000) * step,
      Date.now() - 5000 * step,
    )
    if (start >= end) return []
    const candles = await history(start, end - 1)
    if (!active || generation !== epoch) return null
    const combined = new Map(
      chartBars(candles, coin, interval).map((bar) => [bar.time, bar]),
    )
    for (const bar of queuedCandles
      ? chartBars(queuedCandles, coin, interval)
      : updates)
      combined.set(bar.time, bar)
    const bars = [...combined.values()]
      .filter((bar) => bar.time >= start && bar.time < end)
      .sort((a, b) => a.time - b.time)
    lastHistoryTime = Math.max(lastHistoryTime, bars.at(-1)?.time ?? 0)
    if (initial) onLoaded(bars.length)
    onError('')
    return bars
  }
  function subscribe(id: string, callback: (bar: Bar) => void) {
    const listener = { callback, last: lastHistoryTime }
    listeners.set(id, listener)
    defer(() => {
      if (
        listeners.get(id) !== listener ||
        (visibleEngine &&
          visibleEngine !== (id === 'kline' ? 'kline' : 'tradingview'))
      )
        return
      for (const bar of updates) {
        if (bar.time < listener.last) continue
        callback({ ...bar })
        listener.last = bar.time
      }
    })
  }
  const getSymbolInfo = (): LibrarySymbolInfo => ({
    name: coin,
    ticker: coin,
    description: label ?? `${coin} / USDC 永续`,
    type: 'crypto',
    session: '24x7',
    timezone: 'Etc/UTC',
    exchange: 'Hyperliquid Testnet',
    listed_exchange: 'Hyperliquid Testnet',
    pricescale: 10 ** (priceDecimals ?? Math.max(0, 6 - szDecimals)),
    minmov: 1,
    volume_precision: szDecimals,
    has_intraday: true,
    supported_resolutions: chartIntervals.map(
      (key) => chartResolutions[key] as ResolutionString,
    ),
    has_daily: true,
    has_weekly_and_monthly: true,
    format: 'price',
    data_status: 'streaming',
  })
  const tradingView: IBasicDataFeed = {
    onReady: (callback) =>
      setTimeout(() => {
        if (active)
          callback({
            supported_resolutions: chartIntervals.map(
              (key) => chartResolutions[key] as ResolutionString,
            ),
          })
      }, 0),
    searchSymbols: (_input, _exchange, _type, callback) =>
      defer(() => callback([])),
    resolveSymbol: (name, callback, error) => {
      const symbol = getSymbolInfo()
      setTimeout(() => {
        if (!active) return
        if (name === symbol.ticker) callback(symbol)
        else error('未知 Hyperliquid 市场')
      }, 0)
    },
    getBars: (symbol, selectedResolution, params, callback, error) => {
      if (symbol.ticker !== coin || selectedResolution !== resolution) {
        setTimeout(() => {
          if (active) error('图表市场或周期已变更')
        }, 0)
        return
      }
      const generation = epoch
      void load(
        params.to * 1000,
        Math.max(
          params.countBack,
          Math.ceil(((params.to - params.from) * 1000) / step),
        ),
        params.firstDataRequest,
      )
        .then((bars) => {
          setTimeout(() => {
            if (!active) return
            // 旧请求也必须结束回调，否则 TradingView 快速切币会一直等待。
            if (!bars || generation !== epoch) {
              error('图表市场或周期已变更')
              return
            }
            callback(
              bars.map((bar) => ({ ...bar })),
              { noData: bars.length === 0 },
            )
          }, 0)
        })
        .catch((e) =>
          setTimeout(() => {
            if (!active) return
            if (generation === epoch) fail(e)
            error(String(e))
          }, 0),
        )
    },
    subscribeBars: (symbol, selectedResolution, callback, id) => {
      if (symbol.ticker === coin && selectedResolution === resolution)
        subscribe(id, callback)
    },
    unsubscribeBars: (id) => {
      listeners.delete(id)
    },
  }
  const kline: DataLoader = {
    getBars: async ({ type, timestamp, symbol, period: value, callback }) => {
      if (!matches(symbol.ticker, value) || type === 'backward') {
        callback([], false)
        return
      }
      const generation = epoch
      try {
        const end = timestamp ?? Date.now()
        const bars = await load(end, 300, type === 'init')
        if (active && generation === epoch && bars)
          callback(bars.map(klineBar), {
            forward:
              bars.length > 0 &&
              (bars[0]?.time ?? 0) > Date.now() - 4999 * step,
            backward: false,
          })
      } catch (e) {
        if (active && generation === epoch) {
          fail(e)
          callback([], false)
        }
      }
    },
    subscribeBar: ({ symbol, period: value, callback }) => {
      if (matches(symbol.ticker, value))
        subscribe('kline', (bar) => callback(klineBar(bar)))
    },
    unsubscribeBar: () => {
      listeners.delete('kline')
    },
  }
  return {
    tradingView,
    kline,
    get symbolInfo() {
      return getSymbolInfo()
    },
    select(next: ChartFeedContext) {
      const changed =
        !active ||
        coin !== next.coin ||
        interval !== next.interval ||
        szDecimals !== next.szDecimals ||
        priceDecimals !== next.priceDecimals
      active = true
      ;({
        coin,
        interval,
        szDecimals,
        label,
        priceDecimals,
        history,
        onError,
        onLoaded,
      } = next)
      if (!changed) return false
      epoch++
      step = intervalMs(interval)
      resolution = chartResolutions[interval] as ResolutionString
      period = chartPeriods[interval]
      updates = []
      queuedCandles = null
      frame.cancel()
      frame = createFrameBatch('chartFeed', publish)
      lastHistoryTime = 0
      listeners.clear()
      return true
    },
    setVisibleEngine(engine: 'kline' | 'tradingview') {
      visibleEngine = engine
      frame.schedule()
    },
    update(candles: Candle[]) {
      if (!active) return
      performanceMetrics.input('chartFeed')
      performanceMetrics.queue(
        'chartFeed',
        candles.length,
        queuedCandles ? 1 : 0,
      )
      queuedCandles = candles
      frame.schedule()
    },
    dispose() {
      active = false
      frame.cancel()
      queuedCandles = null
      listeners.clear()
      updates = []
    },
  }
}
