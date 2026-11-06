'use client'

import { SubscriptionClient, WebSocketTransport } from '@nktkas/hyperliquid'
import type {
  ActiveAssetCtxEvent,
  ActiveSpotAssetCtxEvent,
} from '@nktkas/hyperliquid/api/subscription'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { type ChartInterval, intervalMs } from './chart-periods.ts'
import { createFrameBatch } from './frame-batch.ts'
import {
  type AccountSnapshot,
  type Book,
  errorText,
  info,
  loadAccount,
  loadMarketCatalog,
  loadMarkets,
  type MarketContext,
  WS_URL,
} from './hyperliquid.ts'
import { createLiveBook } from './live-book.ts'
import {
  type Candle,
  type MarketTrade,
  mergeCandles,
  mergeTrades,
} from './market-data.ts'
import { performanceMetrics } from './performance.ts'
export type Interval = ChartInterval

export function useMarkets() {
  const [catalog, setCatalog] = useState<MarketContext[]>([])
  const [catalogError, setCatalogError] = useState('')
  const [quotesError, setQuotesError] = useState('')
  const [catalogLoading, setCatalogLoading] = useState(true)
  useEffect(() => {
    let active = true
    const refresh = () =>
      loadMarketCatalog()
        .then((data) => {
          if (active) {
            setCatalog(data)
            setCatalogError('')
          }
        })
        .catch((e) => {
          if (active) setCatalogError(errorText(e))
        })
        .finally(() => {
          if (active) setCatalogLoading(false)
        })
    void refresh()
    const timer = setInterval(refresh, 300000)
    const refreshQuotes = () => {
      if (document.hidden) return
      void info
        .spotMetaAndAssetCtxs()
        .then(([, contexts]) => {
          if (!active) return
          const quotes = new Map(
            contexts.map((context) => [context.coin, context]),
          )
          setCatalog((previous) =>
            previous.map((market) => {
              const context = quotes.get(market.name)
              return context ? { ...market, context } : market
            }),
          )
          setQuotesError('')
        })
        .catch((error) => {
          if (active) setQuotesError(errorText(error))
        })
    }
    const quoteTimer = setInterval(refreshQuotes, 30000)
    document.addEventListener('visibilitychange', refreshQuotes)
    window.addEventListener('online', refreshQuotes)
    return () => {
      active = false
      clearInterval(timer)
      clearInterval(quoteTimer)
      document.removeEventListener('visibilitychange', refreshQuotes)
      window.removeEventListener('online', refreshQuotes)
    }
  }, [])
  const [markets, setMarkets] = useState<MarketContext[]>([])
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    async function refresh() {
      try {
        const data = await loadMarkets()
        if (active) {
          setMarkets(data)
          setError('')
        }
      } catch (e) {
        if (active) setError(errorText(e))
      }
    }
    void refresh()
    const timer = setInterval(refresh, 30000)
    return () => {
      active = false
      clearInterval(timer)
    }
  }, [])
  return {
    markets: useMemo(() => [...markets, ...catalog], [markets, catalog]),
    error,
    catalogError: catalogError || quotesError,
    catalogLoading,
  }
}

export function useMarket(coin: string, interval: Interval) {
  const [book, setBook] = useState<Book | null>(null)
  const [candles, setCandles] = useState<Candle[]>([])
  const [assetContext, setAssetContext] = useState<
    ActiveAssetCtxEvent | ActiveSpotAssetCtxEvent | null
  >(null)
  const [trades, setTrades] = useState<MarketTrade[]>([])
  const [tradesError, setTradesError] = useState('')
  const [tradesLoading, setTradesLoading] = useState(true)
  const [status, setStatus] = useState('连接中')
  const [error, setError] = useState('')
  const [receivedAt, setReceivedAt] = useState(0)
  const [now, setNow] = useState(0)
  const [candleReconnectVersion, setCandleReconnectVersion] = useState(0)
  const [connection, setConnection] = useState<{
    transport: WebSocketTransport
    sub: SubscriptionClient
    fastTransport: WebSocketTransport
    fastSub: SubscriptionClient
  } | null>(null)
  useEffect(() => {
    const transport = new WebSocketTransport({ isTestnet: true, url: WS_URL })
    // SDK 按频道和币对分发，快慢深度用独立连接，避免同一回调混收两种快照。
    const fastTransport = new WebSocketTransport({
      isTestnet: true,
      url: WS_URL,
    })
    setConnection({
      transport,
      sub: new SubscriptionClient({ transport }),
      fastTransport,
      fastSub: new SubscriptionClient({ transport: fastTransport }),
    })
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => {
      clearInterval(timer)
      fastTransport.close()
      transport.close()
    }
  }, [])
  useEffect(() => {
    if (!connection) return
    const { transport, sub, fastSub } = connection
    let active = true
    let generation = 0
    const buffer = new Map<number, Candle>()
    let didOpen = false
    const pendingCandles = new Map<number, Candle>()
    let pendingBook: Book | null = null
    const bookFrame = createFrameBatch('book', () => {
      if (!active || !pendingBook) return
      setBook(pendingBook)
      performanceMetrics.retain(
        'book',
        pendingBook.levels[0].length + pendingBook.levels[1].length,
      )
      setReceivedAt(transport.socket.readyState === 1 ? Date.now() : 0)
      pendingBook = null
    })
    const candleFrame = createFrameBatch('candles', () => {
      if (!active) return
      const updates = [...pendingCandles.values()]
      pendingCandles.clear()
      setCandles((previous) => {
        const next = mergeCandles(previous, updates)
        performanceMetrics.retain('candles', next.length)
        return next
      })
    })
    const liveBook = createLiveBook(coin)

    setBook((old) => (old?.coin === coin ? old : null))
    setCandles([])
    setError('')
    function acceptBook(snapshot: Book | null, quick = false) {
      if (!active) return
      const data = liveBook.accept(snapshot, quick)
      if (!data) return
      performanceMetrics.input('book', 1, data.time)
      performanceMetrics.queue('book', 1, pendingBook ? 1 : 0)
      pendingBook = data
      bookFrame.schedule()
    }
    async function snapshots() {
      const epoch = ++generation
      buffer.clear()
      try {
        const [history, latestBook] = await Promise.all([
          info.candleSnapshot({
            coin,
            interval,
            startTime: Date.now() - intervalMs(interval) * 2,
          }),
          info.l2Book({ coin }),
        ])
        if (!active || generation !== epoch) return
        setCandles(mergeCandles(history, [...buffer.values()]))
        buffer.clear()
        acceptBook(latestBook)
        setError('')
      } catch (e) {
        if (active && generation === epoch) setError(errorText(e))
      }
    }
    const opened = () => {
      if (active) {
        if (didOpen) setCandleReconnectVersion((version) => version + 1)
        didOpen = true
        setStatus('实时连接')
        void snapshots()
      }
    }
    const closed = () => {
      if (active) {
        setStatus('正在重连')
        setReceivedAt(0)
      }
    }
    const subscriptionError = (e: unknown) => {
      if (active) {
        setError(errorText(e))
        setReceivedAt(0)
        setStatus('订阅失败')
      }
    }
    transport.socket.addEventListener('open', opened)
    transport.socket.addEventListener('close', closed)
    if (transport.socket.readyState === 1) opened()
    const subscriptions = [
      fastSub
        .l2Book({ coin, fast: true }, (data) => acceptBook(data, true), {
          onError: () => {},
        })
        .catch(() => {}),
      sub
        .l2Book({ coin, fast: false }, (data) => acceptBook(data), {
          onError: subscriptionError,
        })
        .catch(subscriptionError),
      sub
        .candle(
          { coin, interval },
          (candle) => {
            if (!active || candle.s !== coin || candle.i !== interval) return
            performanceMetrics.input('candles')
            const combined = pendingCandles.has(candle.t)
            pendingCandles.set(candle.t, candle)
            buffer.set(candle.t, candle)
            let dropped = 0
            if (pendingCandles.size > 500) {
              pendingCandles.delete(pendingCandles.keys().next().value ?? 0)
              dropped++
            }
            if (buffer.size > 500)
              buffer.delete(buffer.keys().next().value ?? 0)
            performanceMetrics.queue(
              'candles',
              pendingCandles.size,
              combined ? 1 : 0,
              dropped,
            )
            candleFrame.schedule()
          },
          { onError: subscriptionError },
        )
        .catch(subscriptionError),
    ]
    return () => {
      active = false
      generation++
      bookFrame.cancel()
      candleFrame.cancel()
      pendingCandles.clear()
      buffer.clear()
      transport.socket.removeEventListener('open', opened)
      transport.socket.removeEventListener('close', closed)
      for (const subscription of subscriptions)
        void subscription.then((value) => value?.unsubscribe()).catch(() => {})
    }
  }, [connection, coin, interval])
  useEffect(() => {
    if (!connection) return
    const { transport, sub } = connection
    let active = true
    let generation = 0
    const pendingTrades = new Map<number, MarketTrade>()
    let pendingContext: ActiveAssetCtxEvent | ActiveSpotAssetCtxEvent | null =
      null
    const tradeFrame = createFrameBatch('trades', () => {
      if (!active) return
      const updates = [...pendingTrades.values()]
      pendingTrades.clear()
      setTrades((current) => {
        const next = mergeTrades(coin, current, updates)
        performanceMetrics.retain('trades', next.length)
        return next
      })
    })
    const contextFrame = createFrameBatch('context', () => {
      if (active && pendingContext) {
        setAssetContext(pendingContext)
        pendingContext = null
      }
    })
    setAssetContext(null)
    setTrades([])
    setTradesError('')
    setTradesLoading(true)
    const failed = (error: unknown) => {
      if (active) setTradesError(errorText(error))
    }
    const snapshot = async () => {
      const epoch = ++generation
      try {
        const history = await info.recentTrades({ coin })
        if (!active || epoch !== generation) return
        setTrades((current) => mergeTrades(coin, history, current))
        performanceMetrics.retain('trades', Math.min(100, history.length))
        setTradesError('')
      } catch (error) {
        if (epoch === generation) failed(error)
      } finally {
        if (active && epoch === generation) setTradesLoading(false)
      }
    }
    transport.socket.addEventListener('open', snapshot)
    if (transport.socket.readyState === 1) void snapshot()
    const subscription = sub
      .trades(
        { coin },
        (data) => {
          if (!active) return
          if (!Array.isArray(data)) return
          performanceMetrics.input('trades', data.length)
          let combined = 0
          let dropped = 0
          for (const trade of data) {
            if (trade.coin !== coin) continue
            if (pendingTrades.has(trade.tid)) combined++
            pendingTrades.set(trade.tid, trade)
            if (pendingTrades.size > 100) {
              pendingTrades.delete(pendingTrades.keys().next().value ?? 0)
              dropped++
            }
          }
          performanceMetrics.queue(
            'trades',
            pendingTrades.size,
            combined,
            dropped,
          )
          tradeFrame.schedule()
        },
        { onError: failed },
      )
      .catch(failed)
    const subscribeContext =
      coin.startsWith('@') || coin.startsWith('#') || coin.includes('/')
        ? sub.activeSpotAssetCtx.bind(sub)
        : sub.activeAssetCtx.bind(sub)
    const contextSubscription = subscribeContext(
      { coin },
      (data) => {
        if (!active || data.coin !== coin) return
        performanceMetrics.input('context')
        performanceMetrics.queue('context', 1, pendingContext ? 1 : 0)
        pendingContext = data
        contextFrame.schedule()
      },
      { onError: failed },
    ).catch(failed)
    return () => {
      active = false
      tradeFrame.cancel()
      contextFrame.cancel()
      pendingTrades.clear()
      void contextSubscription
        .then((value) => value?.unsubscribe())
        .catch(() => {})
      transport.socket.removeEventListener('open', snapshot)
      void subscription.then((value) => value?.unsubscribe()).catch(() => {})
    }
  }, [connection, coin])
  const selectedCandles = useMemo(
    () => candles.filter((c) => c.s === coin && c.i === interval),
    [candles, coin, interval],
  )
  const stale =
    !receivedAt ||
    now - receivedAt > 15000 ||
    !book ||
    book.coin !== coin ||
    now - book.time > 15000
  return {
    book: book?.coin === coin ? book : null,
    candles: selectedCandles,
    trades: trades.filter((trade) => trade.coin === coin),
    tradesError,
    tradesLoading,
    context: assetContext?.coin === coin ? assetContext.ctx : null,
    status,
    error,
    stale,
    receivedAt,
    candleReconnectVersion,
  }
}

export function useAccount(address: `0x${string}` | null, dex = '') {
  const [snapshot, setSnapshot] = useState<AccountSnapshot | null>(null)
  const [error, setError] = useState('')
  const reload = useRef<() => Promise<void>>(async () => {})
  const refresh = useCallback(() => reload.current(), [])
  useEffect(() => {
    if (!address) {
      setSnapshot(null)
      setError('')
      return
    }
    const owner = address
    let active = true
    let inFlight: Promise<void> | null = null
    let refreshAgain = false
    let latestState: AccountSnapshot['state'] | null = null
    const stateFrame = createFrameBatch('account', () => {
      if (!active || !latestState) return
      const state = latestState
      setSnapshot((previous) =>
        previous?.address === owner &&
        previous.dex === dex &&
        state.time >= previous.state.time
          ? { ...previous, state }
          : previous,
      )
    })
    const transport = new WebSocketTransport({ isTestnet: true, url: WS_URL })
    const sub = new SubscriptionClient({ transport })
    function query(): Promise<void> {
      if (inFlight) {
        refreshAgain = true
        return inFlight
      }
      inFlight = (async () => {
        do {
          refreshAgain = false
          try {
            const data = await loadAccount(owner, dex)
            if (active) {
              setSnapshot({
                ...data,
                state:
                  latestState && latestState.time > data.state.time
                    ? latestState
                    : data.state,
              })
              setError('')
            }
          } catch (e) {
            if (active) setError(errorText(e))
          }
        } while (active && refreshAgain)
      })().finally(() => {
        inFlight = null
      })
      return inFlight
    }
    reload.current = query
    void query()
    const onError = (e: unknown) => {
      if (active) setError(errorText(e))
    }
    transport.socket.addEventListener('open', () => {
      void query()
    })
    void sub
      .clearinghouseState(
        { user: address, dex },
        (event) => {
          if (
            !active ||
            event.user.toLowerCase() !== owner.toLowerCase() ||
            event.dex !== dex ||
            event.clearinghouseState.time < (latestState?.time ?? 0)
          )
            return
          latestState = event.clearinghouseState
          performanceMetrics.input('account', 1, latestState.time)
          stateFrame.schedule()
        },
        { onError },
      )
      .catch(onError)
    void sub.orderUpdates({ user: address }, query, { onError }).catch(onError)
    void sub.userFills({ user: address }, query, { onError }).catch(onError)
    const timer = setInterval(query, 15000)
    return () => {
      active = false
      stateFrame.cancel()
      reload.current = async () => {}
      clearInterval(timer)
      transport.close()
    }
  }, [address, dex])
  return {
    snapshot:
      snapshot?.address.toLowerCase() === address?.toLowerCase() &&
      snapshot?.dex === dex
        ? snapshot
        : null,
    error,
    refresh,
  }
}
