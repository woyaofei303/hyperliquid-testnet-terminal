'use client'

import { SubscriptionClient, WebSocketTransport } from '@nktkas/hyperliquid'
import type {
  ActiveAssetCtxEvent,
  ActiveSpotAssetCtxEvent,
} from '@nktkas/hyperliquid/api/subscription'
import { useEffect, useMemo, useState } from 'react'
import {
  type Book,
  errorText,
  info,
  loadMarketCatalog,
  loadMarkets,
  type MarketContext,
  WS_URL,
} from '../../../shared/lib/fameex-testnet.ts'
import { createFrameBatch } from '../../../shared/lib/frame-batch.ts'
import { performanceMetrics } from '../../../shared/lib/performance.ts'
import type { ChartInterval } from '../../chart/lib/chart-periods.ts'
import { createLiveBook } from '../lib/live-book.ts'
import {
  type Candle,
  type MarketTrade,
  mergeCandles,
  mergeTrades,
} from '../lib/market-data.ts'
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
  const [candleRecovery, setCandleRecovery] = useState({
    coin,
    interval,
    version: 0,
    fromTime: 0,
  })
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
    let didOpen = false
    let lastMessage = Date.now()
    let lastCandleTime = 0
    let disconnectedFrom: number | null = null
    const reportGap = (fromTime: number) => {
      setCandleRecovery((previous) => ({
        coin,
        interval,
        version: previous.version + 1,
        fromTime,
      }))
    }
    const receivedMessage = () => {
      const now = Date.now()
      // 心跳也算连接活动；冷清市场没有新蜡烛不等于连接中断。
      if (didOpen && now - lastMessage > 45000 && disconnectedFrom === null)
        reportGap(lastCandleTime || lastMessage)
      lastMessage = now
    }
    const checkConnection = () => {
      if (document.visibilityState !== 'visible' || !navigator.onLine) return
      if (
        transport.socket.readyState === 3 ||
        (transport.socket.readyState === 1 && Date.now() - lastMessage > 45000)
      ) {
        disconnectedFrom ??= lastCandleTime || lastMessage
        transport.socket.reconnect()
      }
      const fast = connection.fastTransport.socket
      if (fast.readyState === 3) fast.reconnect()
    }
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
      try {
        const latestBook = await info.l2Book({ coin })
        if (!active || generation !== epoch) return
        acceptBook(latestBook)
        setError('')
      } catch (e) {
        if (active && generation === epoch) setError(errorText(e))
      }
    }
    const opened = () => {
      if (active) {
        if (didOpen)
          reportGap(disconnectedFrom ?? (lastCandleTime || lastMessage))
        disconnectedFrom = null
        lastMessage = Date.now()
        didOpen = true
        setStatus('实时连接')
        void snapshots()
      }
    }
    const closed = () => {
      if (active) {
        disconnectedFrom ??= lastCandleTime || lastMessage
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
    transport.socket.addEventListener('message', receivedMessage)
    document.addEventListener('visibilitychange', checkConnection)
    window.addEventListener('online', checkConnection)
    window.addEventListener('pageshow', checkConnection)
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
            receivedMessage()
            lastCandleTime = candle.t
            performanceMetrics.input('candles')
            const combined = pendingCandles.has(candle.t)
            pendingCandles.set(candle.t, candle)
            let dropped = 0
            if (pendingCandles.size > 5000) {
              pendingCandles.delete(pendingCandles.keys().next().value ?? 0)
              dropped++
            }
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
      transport.socket.removeEventListener('message', receivedMessage)
      document.removeEventListener('visibilitychange', checkConnection)
      window.removeEventListener('online', checkConnection)
      window.removeEventListener('pageshow', checkConnection)
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
    candleRecovery:
      candleRecovery.coin === coin && candleRecovery.interval === interval
        ? candleRecovery
        : undefined,
  }
}
