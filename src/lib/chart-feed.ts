import type { DataLoader, KLineData, Period } from 'klinecharts'
import type {
  Bar,
  IBasicDataFeed,
  LibrarySymbolInfo,
  ResolutionString,
} from '../../public/lib/charting_library/charting_library'
import {
  type ChartInterval,
  candleHistoryStart,
  chartIntervals,
  chartPeriods,
  chartResolutions,
  historyPageSize,
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
export type ChartEngine = 'kline' | 'tradingview'
export type ChartRecoveryResult = {
  fromTime: number
  toTime: number
  count: number
  complete: boolean
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
  let visibleEngine: ChartEngine | null = null
  let lastHistoryTime = 0
  let historyEpoch = 0
  let recoveryBlocked = false
  let recoveryReady = false
  let recoveryFlight: Promise<ChartRecoveryResult> | null = null
  let recoveryUpdates = new Map<number, Bar>()
  let recoverySnapshot: (ChartRecoveryResult & { bars: Bar[] }) | null = null
  const dirtyEngines = new Set<ChartEngine>()
  const reloadWaiters = new Map<
    ChartEngine,
    {
      resolve: () => void
      reject: (error: Error) => void
      timer: ReturnType<typeof setTimeout>
    }
  >()
  const listeners = new Map<
    string,
    {
      engine: ChartEngine
      callback: (bar: Bar) => void
      last: number
      resetCache?: () => void
    }
  >()
  const bufferRecoveryBars = (bars: Bar[]) => {
    for (const bar of bars) recoveryUpdates.set(bar.time, bar)
    while (recoveryUpdates.size > 5000)
      recoveryUpdates.delete(recoveryUpdates.keys().next().value ?? 0)
  }
  const releaseRecovery = () => {
    recoveryBlocked = false
    recoveryReady = false
    recoveryUpdates.clear()
    if (recoverySnapshot) updates = recoverySnapshot.bars.slice(-2)
    frame.schedule()
  }
  const notifyLoaded = (engine: ChartEngine, error?: unknown) => {
    const waiter = reloadWaiters.get(engine)
    if (waiter) {
      clearTimeout(waiter.timer)
      reloadWaiters.delete(engine)
      if (error)
        waiter.reject(error instanceof Error ? error : new Error(String(error)))
      else waiter.resolve()
    }
    if (!error) dirtyEngines.delete(engine)
    if (!error && recoveryReady && recoveryBlocked && engine === visibleEngine)
      releaseRecovery()
  }
  const publish = () => {
    if (!active) return
    if (queuedCandles) {
      updates = chartBars(queuedCandles, coin, interval)
      queuedCandles = null
      if (recoverySnapshot) {
        const rows = new Map(
          recoverySnapshot.bars.map((bar) => [bar.time, bar]),
        )
        for (const bar of updates) rows.set(bar.time, bar)
        recoverySnapshot.bars = [...rows.values()]
          .sort((a, b) => a.time - b.time)
          .slice(-5000)
        recoverySnapshot.count = recoverySnapshot.bars.length
        recoverySnapshot.toTime = Math.max(
          recoverySnapshot.toTime,
          (recoverySnapshot.bars.at(-1)?.time ?? 0) + step,
        )
      }
    }
    if (recoveryBlocked) {
      bufferRecoveryBars(updates)
      return
    }
    for (const listener of listeners.values()) {
      if (visibleEngine && listener.engine !== visibleEngine) continue
      performanceMetrics.measure(listener.engine, () => {
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

  const pendingHistory = new Map<string, Promise<Candle[]>>()
  const fromRecoveryCache = (end: number, count: number, from?: number) => {
    const snapshot = recoverySnapshot
    const target = Math.min(Math.max(count, historyPageSize), 5000)
    const requestedFrom =
      from === undefined
        ? (snapshot?.fromTime ?? 0)
        : Math.min(from, candleHistoryStart(end, target, interval))
    if (
      !snapshot ||
      end < snapshot.fromTime ||
      end > snapshot.toTime + step ||
      (requestedFrom < snapshot.fromTime && snapshot.complete)
    )
      return null
    return snapshot.bars
      .filter(
        (bar) =>
          bar.time < end &&
          bar.time >= Math.max(requestedFrom, snapshot.fromTime),
      )
      .map((bar) => ({ ...bar }))
  }
  async function load(
    end: number,
    count: number,
    initial: boolean,
    from?: number,
    recovery = false,
  ) {
    const generation = epoch
    const loadedHistoryEpoch = historyEpoch
    const selectedCoin = coin
    const selectedInterval = interval
    const readHistory = history
    if (!recovery) {
      const cached = fromRecoveryCache(end, count, from)
      if (cached) {
        lastHistoryTime = Math.max(lastHistoryTime, cached.at(-1)?.time ?? 0)
        if (initial) onLoaded(cached.length)
        onError('')
        return cached
      }
    }
    const oldest = candleHistoryStart(Date.now(), 5000, selectedInterval)
    const target = Math.min(
      from === undefined ? 1 : Math.max(count, historyPageSize),
      5000,
    )
    let cursor = end
    const combined = new Map<number, Bar>()
    while (
      cursor > oldest &&
      (combined.size < target || cursor > (from ?? end))
    ) {
      const start = Math.max(
        candleHistoryStart(cursor, historyPageSize, selectedInterval),
        oldest,
      )
      const key = `${generation}:${loadedHistoryEpoch}:${start}:${cursor}`
      let request = pendingHistory.get(key)
      if (!request) {
        request = readHistory(start, cursor - 1)
        pendingHistory.set(key, request)
      }
      let candles: Candle[]
      try {
        candles = await request
      } finally {
        pendingHistory.delete(key)
      }
      if (!active || generation !== epoch) return null
      if (!recovery && loadedHistoryEpoch !== historyEpoch) {
        const cached = fromRecoveryCache(end, count, from)
        if (cached) return cached
      }
      for (const bar of chartBars(candles, selectedCoin, selectedInterval)) {
        if (bar.time >= start && bar.time < cursor) combined.set(bar.time, bar)
      }
      cursor = start
      // Sparse markets may have gaps: scan older windows only until countBack or retention is reached.
    }
    if (!recovery) {
      for (const bar of queuedCandles
        ? chartBars(queuedCandles, coin, interval)
        : updates) {
        if (bar.time >= cursor && bar.time < end) combined.set(bar.time, bar)
      }
    }
    const bars = [...combined.values()].sort((a, b) => a.time - b.time)
    lastHistoryTime = Math.max(lastHistoryTime, bars.at(-1)?.time ?? 0)
    if (initial) onLoaded(bars.length)
    onError('')
    return bars
  }
  function subscribe(
    id: string,
    engine: ChartEngine,
    callback: (bar: Bar) => void,
    resetCache?: () => void,
  ) {
    const listener = { engine, callback, last: lastHistoryTime, resetCache }
    listeners.set(id, listener)
    defer(() => {
      if (
        listeners.get(id) !== listener ||
        (visibleEngine && visibleEngine !== engine) ||
        recoveryBlocked
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
        params.countBack,
        params.firstDataRequest,
        params.from * 1000,
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
            if (params.firstDataRequest || reloadWaiters.has('tradingview'))
              notifyLoaded('tradingview')
          }, 0)
        })
        .catch((e) =>
          setTimeout(() => {
            if (!active) return
            if (generation === epoch) fail(e)
            notifyLoaded('tradingview', e)
            error(String(e))
          }, 0),
        )
    },
    subscribeBars: (symbol, selectedResolution, callback, id, resetCache) => {
      if (symbol.ticker === coin && selectedResolution === resolution)
        subscribe(id, 'tradingview', callback, resetCache)
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
        const bars = await load(end, historyPageSize, type === 'init')
        if (active && generation === epoch && bars)
          callback(bars.map(klineBar), {
            forward:
              bars.length > 0 &&
              (bars[0]?.time ?? 0) > Date.now() - 4999 * step,
            backward: false,
          })
        if (active && generation === epoch && type === 'init')
          notifyLoaded('kline')
      } catch (e) {
        if (active && generation === epoch) {
          fail(e)
          callback([], false)
          notifyLoaded('kline', e)
        }
      }
    },
    subscribeBar: ({ symbol, period: value, callback }) => {
      if (matches(symbol.ticker, value))
        subscribe('kline', 'kline', (bar) => callback(klineBar(bar)))
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
      historyEpoch++
      for (const waiter of reloadWaiters.values()) {
        clearTimeout(waiter.timer)
        waiter.reject(new Error('图表市场或周期已变更'))
      }
      reloadWaiters.clear()
      step = intervalMs(interval)
      resolution = chartResolutions[interval] as ResolutionString
      period = chartPeriods[interval]
      updates = []
      queuedCandles = null
      frame.cancel()
      frame = createFrameBatch('chartFeed', publish)
      lastHistoryTime = 0
      recoveryBlocked = false
      recoveryReady = false
      recoveryFlight = null
      recoveryUpdates.clear()
      recoverySnapshot = null
      dirtyEngines.clear()
      listeners.clear()
      return true
    },
    setVisibleEngine(engine: ChartEngine) {
      visibleEngine = engine
      frame.schedule()
    },
    recover(fromTime?: number, toTime = Date.now()) {
      if (recoveryFlight) return recoveryFlight
      const wasBlocked = recoveryBlocked
      recoveryBlocked = true
      recoveryReady = false
      historyEpoch++
      if (!wasBlocked) recoveryUpdates = new Map()
      dirtyEngines.add('kline')
      dirtyEngines.add('tradingview')
      const fallbackFrom = lastHistoryTime
        ? lastHistoryTime - step
        : candleHistoryStart(toTime, historyPageSize, interval)
      const viewFrom =
        fromTime === undefined
          ? fallbackFrom
          : candleHistoryStart(fromTime, historyPageSize, interval)
      const requestedFrom = Math.min(viewFrom, fallbackFrom)
      // shortcut: Hyperliquid retains 5000 candles, add an archive if deeper recovery is required.
      const oldest = candleHistoryStart(toTime, 5000, interval)
      const queryFrom = Math.max(requestedFrom, oldest)
      const flight = (async () => {
        const loaded = await load(
          toTime,
          historyPageSize,
          false,
          queryFrom,
          true,
        )
        if (!loaded) throw new Error('图表市场或周期已变更')
        const rows = new Map(
          loaded
            .filter((bar) => bar.time >= queryFrom && bar.time < toTime)
            .map((bar) => [bar.time, bar]),
        )
        for (const [time, bar] of recoveryUpdates) {
          if (time >= queryFrom && time < toTime) rows.set(time, { ...bar })
        }
        const bars = [...rows.values()].sort((a, b) => a.time - b.time)
        const result = {
          fromTime: queryFrom,
          toTime,
          count: bars.length,
          complete: requestedFrom >= oldest,
          bars,
        }
        recoverySnapshot = result
        recoveryReady = true
        lastHistoryTime = Math.max(lastHistoryTime, bars.at(-1)?.time ?? 0)
        updates = bars.slice(-2)
        dirtyEngines.add('kline')
        dirtyEngines.add('tradingview')
        onError('')
        return result
      })()
      recoveryFlight = flight
      void flight
        .finally(() => {
          if (recoveryFlight === flight) recoveryFlight = null
        })
        .catch(() => {})
      return flight
    },
    refreshEngine(engine: ChartEngine, reset: () => void) {
      visibleEngine = engine
      return new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          reloadWaiters.delete(engine)
          reject(new Error('图表重新加载超时'))
        }, 15000)
        reloadWaiters.set(engine, { resolve, reject, timer })
        try {
          if (engine === 'tradingview') {
            for (const listener of listeners.values()) {
              if (listener.engine === engine) listener.resetCache?.()
            }
          }
          reset()
        } catch (error) {
          clearTimeout(timer)
          reloadWaiters.delete(engine)
          reject(error instanceof Error ? error : new Error(String(error)))
        }
      })
    },
    isEngineDirty(engine: ChartEngine) {
      return dirtyEngines.has(engine)
    },
    update(candles: Candle[]) {
      if (!active) return
      performanceMetrics.input('chartFeed')
      performanceMetrics.queue(
        'chartFeed',
        candles.length,
        queuedCandles ? 1 : 0,
      )
      if (recoveryBlocked) {
        bufferRecoveryBars(chartBars(candles, coin, interval))
        if (recoverySnapshot) {
          const rows = new Map(
            recoverySnapshot.bars.map((bar) => [bar.time, bar]),
          )
          for (const [time, bar] of recoveryUpdates) rows.set(time, bar)
          recoverySnapshot.bars = [...rows.values()]
            .sort((a, b) => a.time - b.time)
            .slice(-5000)
          recoverySnapshot.count = recoverySnapshot.bars.length
        }
        return
      }
      queuedCandles = candles
      frame.schedule()
    },
    dispose() {
      pendingHistory.clear()
      historyEpoch++
      for (const waiter of reloadWaiters.values()) {
        clearTimeout(waiter.timer)
        waiter.reject(new Error('图表已销毁'))
      }
      reloadWaiters.clear()
      active = false
      frame.cancel()
      queuedCandles = null
      listeners.clear()
      updates = []
    },
  }
}
