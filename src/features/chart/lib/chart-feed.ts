import type { DataLoader, KLineData, Period } from 'klinecharts'
import type {
  Bar,
  IBasicDataFeed,
  LibrarySymbolInfo,
  ResolutionString,
} from '../../../../public/lib/charting_library/charting_library'
import { createFrameBatch } from '../../../shared/lib/frame-batch.ts'
import { performanceMetrics } from '../../../shared/lib/performance.ts'
import type { Candle } from '../../market/lib/market-data.ts'
import {
  type ChartInterval,
  candleHistoryStart,
  chartIntervals,
  chartPeriods,
  chartResolutions,
  historyPageSize,
  intervalMs,
} from './chart-periods.ts'

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
  const seenCandles = new Map<number, Candle>()
  const cachedBars = new Map<number, Bar>()
  let coveredRanges: [number, number][] = []
  let gapFrom: number | null = null
  let gapVersion = 0
  let hasHistory = false
  let visibleEngine: ChartEngine | null = null
  let lastHistoryTime = 0
  let historyEpoch = 0
  let recoveryBlocked = false
  let recoveryReady = false
  let recoveryFlight: Promise<ChartRecoveryResult> | null = null
  let recoveryUpdates = new Map<number, Bar>()
  let klineRequest = 0
  let tradingViewRequest = 0
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
      delivered?: Bar
      resetCache?: () => void
    }
  >()
  const sortedCache = () =>
    [...cachedBars.values()].sort((a, b) => a.time - b.time)
  const storeBars = (bars: Bar[], from: number, to: number) => {
    const first = sortedCache()[0]?.time ?? Infinity
    for (const bar of bars) {
      const previous = cachedBars.get(bar.time)
      const changed =
        !previous ||
        ['open', 'high', 'low', 'close', 'volume'].some(
          (key) => previous[key as keyof Bar] !== bar[key as keyof Bar],
        )
      if (changed) {
        for (const listener of listeners.values()) {
          if (bar.time >= first && bar.time < listener.last)
            dirtyEngines.add(listener.engine)
        }
        cachedBars.set(bar.time, bar)
      }
    }
    const oldest = Math.max(
      candleHistoryStart(Date.now(), 5000, interval),
      sortedCache().at(-5000)?.time ?? 0,
    )
    for (const time of cachedBars.keys()) {
      if (time < oldest) {
        cachedBars.delete(time)
        seenCandles.delete(time)
      }
    }
    const ranges = [...coveredRanges, [from, to] as [number, number]]
      .filter(([, end]) => end > oldest)
      .sort((a, b) => a[0] - b[0])
    coveredRanges = []
    for (const [start, end] of ranges) {
      const last = coveredRanges.at(-1)
      if (last && start <= last[1]) last[1] = Math.max(last[1], end)
      else coveredRanges.push([Math.max(start, oldest), end])
    }
  }
  const releaseRecovery = () => {
    if (gapFrom !== null) return
    recoveryBlocked = false
    recoveryReady = false
    recoveryUpdates.clear()
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
    if (!active || recoveryBlocked) return
    const bars = sortedCache()
    for (const listener of listeners.values()) {
      if (visibleEngine && listener.engine !== visibleEngine) continue
      if (dirtyEngines.has(listener.engine)) continue
      performanceMetrics.measure(listener.engine, () => {
        for (const bar of bars) {
          if (bar.time < listener.last || bar === listener.delivered) continue
          listener.callback({ ...bar })
          listener.last = bar.time
          listener.delivered = bar
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
  const fromCache = (
    end: number,
    count: number,
    initial: boolean,
    from?: number,
    restore = false,
  ) => {
    if (!hasHistory) return null
    const bars = sortedCache()
    const requestedFrom =
      initial && (from === undefined || restore)
        ? (bars[0]?.time ?? end)
        : Math.min(from ?? end, candleHistoryStart(end, count, interval))
    if (
      !coveredRanges.some(([start, to]) => start <= requestedFrom && to >= end)
    )
      return null
    return bars
      .filter((bar) => bar.time < end && (initial || bar.time >= requestedFrom))
      .map((bar) => ({ ...bar }))
  }

  async function load(
    end: number,
    count: number,
    initial: boolean,
    from?: number,
    recovery = false,
    restore = false,
  ) {
    const generation = epoch
    const loadedHistoryEpoch = historyEpoch
    const selectedCoin = coin
    const selectedInterval = interval
    const readHistory = history
    if (!recovery) {
      const cached = fromCache(end, count, initial, from, restore)
      if (cached) {
        lastHistoryTime = Math.max(lastHistoryTime, cached.at(-1)?.time ?? 0)
        if (initial) onLoaded(cached.length)
        onError('')
        return cached
      }
    }
    const oldest = candleHistoryStart(Date.now(), 5000, selectedInterval)
    const target = recovery
      ? 0
      : Math.min(
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
        recovery ? (from ?? oldest) : oldest,
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
        const cached = fromCache(end, count, initial, from, restore)
        return cached
      }
      for (const bar of chartBars(candles, selectedCoin, selectedInterval)) {
        if (bar.time >= start && bar.time < cursor) combined.set(bar.time, bar)
      }
      cursor = start
      // Sparse markets may have gaps: scan older windows only until countBack or retention is reached.
    }
    if (!recovery) {
      for (const bar of updates) {
        if (bar.time >= cursor && bar.time < end) combined.set(bar.time, bar)
      }
    }
    const bars = [...combined.values()].sort((a, b) => a.time - b.time)
    if (!recovery) {
      storeBars(bars, cursor, end)
      hasHistory = true
    }
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
    const listener = {
      engine,
      callback,
      last: lastHistoryTime,
      resetCache,
      delivered: undefined as Bar | undefined,
    }
    listeners.set(id, listener)
    defer(() => {
      if (
        listeners.get(id) !== listener ||
        (visibleEngine && visibleEngine !== engine) ||
        recoveryBlocked
      )
        return
      for (const bar of sortedCache()) {
        if (bar.time < listener.last || bar === listener.delivered) continue
        callback({ ...bar })
        listener.last = bar.time
        listener.delivered = bar
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
    exchange: 'Hyperliquid',
    listed_exchange: 'Hyperliquid',
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
      const request = tradingViewRequest
      void load(
        params.to * 1000,
        params.countBack,
        params.firstDataRequest,
        params.from * 1000,
        false,
        dirtyEngines.has('tradingview') || reloadWaiters.has('tradingview'),
      )
        .then((bars) => {
          setTimeout(() => {
            if (!active) return
            // 旧请求也必须结束回调，否则 TradingView 快速切币会一直等待。
            if (
              !bars ||
              generation !== epoch ||
              request !== tradingViewRequest
            ) {
              error('图表市场或周期已变更')
              return
            }
            const reloaded =
              params.firstDataRequest || reloadWaiters.has('tradingview')
            if (reloaded) {
              for (const listener of listeners.values()) {
                if (listener.engine !== 'tradingview') continue
                listener.last = bars.at(-1)?.time ?? 0
                listener.delivered = undefined
              }
            }
            callback(
              bars.map((bar) => ({ ...bar })),
              { noData: bars.length === 0 },
            )
            if (reloaded) notifyLoaded('tradingview')
          }, 0)
        })
        .catch((e) =>
          setTimeout(() => {
            if (!active) return
            if (generation === epoch && request === tradingViewRequest) {
              fail(e)
              notifyLoaded('tradingview', e)
            }
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
      // resetData 会释放引擎的加载锁；旧回调不能再清空新数据或结束新 init。
      const request = type === 'init' ? ++klineRequest : klineRequest
      try {
        const end = timestamp ?? Date.now()
        const bars = await load(end, historyPageSize, type === 'init')
        if (!active || generation !== epoch || request !== klineRequest) return
        if (bars)
          callback(bars.map(klineBar), {
            forward:
              bars.length > 0 &&
              (bars[0]?.time ?? 0) > Date.now() - 4999 * step,
            backward: false,
          })
        if (type === 'init') notifyLoaded('kline')
      } catch (e) {
        if (active && generation === epoch && request === klineRequest) {
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
      seenCandles.clear()
      cachedBars.clear()
      coveredRanges = []
      gapFrom = null
      gapVersion = 0
      hasHistory = false
      frame.cancel()
      frame = createFrameBatch('chartFeed', publish)
      lastHistoryTime = 0
      recoveryBlocked = false
      recoveryReady = false
      recoveryFlight = null
      recoveryUpdates.clear()
      dirtyEngines.clear()
      listeners.clear()
      return true
    },
    setVisibleEngine(engine: ChartEngine) {
      visibleEngine = engine
      frame.schedule()
    },
    lastBarTime(engine: ChartEngine) {
      return Math.max(
        0,
        ...[...listeners.values()]
          .filter((listener) => listener.engine === engine)
          .map((listener) => listener.last),
      )
    },
    needsRecovery() {
      return gapFrom !== null
    },
    markGap(fromTime?: number) {
      gapVersion++
      const from = fromTime || lastHistoryTime || Date.now()
      gapFrom = Math.min(gapFrom ?? from, from)
      recoveryBlocked = true
    },
    recover(fromTime?: number, toTime = Date.now()) {
      if (recoveryFlight) return recoveryFlight
      const wasBlocked = recoveryBlocked
      recoveryBlocked = true
      // 挂起前尚未绘制的旧快照不能在恢复后覆盖 REST 校准结果。
      updates = []
      recoveryReady = false
      historyEpoch++
      klineRequest++
      tradingViewRequest++
      if (!wasBlocked) recoveryUpdates = new Map()
      const fallbackFrom =
        hasHistory && lastHistoryTime
          ? candleHistoryStart(lastHistoryTime + 1, 2, interval)
          : candleHistoryStart(toTime, historyPageSize, interval)
      const requestedFrom =
        fromTime ??
        (gapFrom === null
          ? fallbackFrom
          : candleHistoryStart(gapFrom + 1, 2, interval))
      const hadHistory = hasHistory
      const recoveringGapVersion = gapVersion
      const generation = epoch
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
        if (!loaded || !active || generation !== epoch)
          throw new Error('图表市场或周期已变更')
        const rows = new Map(
          loaded
            .filter((bar) => bar.time >= queryFrom && bar.time < toTime)
            .map((bar) => [bar.time, bar]),
        )
        for (const [time, bar] of recoveryUpdates) {
          const historical = rows.get(time)
          if (
            time >= queryFrom &&
            (!historical || (bar.volume ?? 0) >= (historical.volume ?? 0))
          )
            rows.set(time, { ...bar })
        }
        const bars = [...rows.values()].sort((a, b) => a.time - b.time)
        const result = {
          fromTime: queryFrom,
          toTime: Math.max(toTime, (bars.at(-1)?.time ?? 0) + step),
          count: bars.length,
          complete: requestedFrom >= oldest,
          bars,
        }
        storeBars(bars, queryFrom, result.toTime)
        hasHistory = true
        if (gapVersion === recoveringGapVersion) gapFrom = null
        recoveryReady = true
        lastHistoryTime = Math.max(lastHistoryTime, bars.at(-1)?.time ?? 0)
        updates = bars.slice(-2)
        for (const engine of ['kline', 'tradingview'] as const) {
          if (
            !hadHistory ||
            ![...listeners.values()].some(
              (listener) => listener.engine === engine,
            )
          )
            dirtyEngines.add(engine)
        }
        if (!visibleEngine || !dirtyEngines.has(visibleEngine))
          releaseRecovery()
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
      if (engine === 'kline') klineRequest++
      else tradingViewRequest++
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
      const oldest = sortedCache()[0]?.time
      for (const listener of listeners.values()) {
        if (
          listener.engine === engine &&
          listener.last > 0 &&
          oldest &&
          listener.last < oldest
        )
          dirtyEngines.add(engine)
      }
      return dirtyEngines.has(engine)
    },
    update(candles: Candle[]) {
      if (!active) return
      performanceMetrics.input('chartFeed')
      const changed = candles.filter(
        (candle) => seenCandles.get(candle.t) !== candle,
      )
      const bars = chartBars(changed, coin, interval)
      for (const candle of changed) seenCandles.set(candle.t, candle)
      while (seenCandles.size > 5000)
        seenCandles.delete(seenCandles.keys().next().value ?? 0)
      if (!bars.length) return
      performanceMetrics.queue('chartFeed', bars.length)
      if (recoveryBlocked) {
        for (const bar of bars) recoveryUpdates.set(bar.time, bar)
        while (recoveryUpdates.size > 5000)
          recoveryUpdates.delete(recoveryUpdates.keys().next().value ?? 0)
        if (recoveryReady) {
          storeBars(bars, bars[0].time, (bars.at(-1)?.time ?? 0) + step)
        }
        return
      }
      updates = bars
      const previousLast = lastHistoryTime
      lastHistoryTime = Math.max(lastHistoryTime, bars.at(-1)?.time ?? 0)
      storeBars(bars, previousLast || bars[0].time, lastHistoryTime + step)
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
      cachedBars.clear()
      seenCandles.clear()
      coveredRanges = []
      listeners.clear()
      updates = []
    },
  }
}
