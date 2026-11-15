'use client'

import { useEffect, useRef, useState } from 'react'
import { performanceMetrics } from '@/shared/lib/performance'
import { buildSummaries, type PositionSummary } from '../lib/candidates'
import { updateFollowups } from '../lib/followups'
import {
  loadObservation,
  MAINNET_WS,
  MainnetRateLimit,
  type PublicTrade,
  parseQuote,
  parseTrades,
  type Quote,
  rankAccounts,
} from '../lib/mainnet-read'
import {
  buildCards,
  COINS,
  type Coin,
  MIN_NOTIONAL,
  type Observation,
  type OpportunityCard,
} from '../lib/opportunities'
import { useFollowupArchive } from './use-followup-archive'

export interface AccountReport {
  address: string
  cards: OpportunityCard[]
  summaries: PositionSummary[]
  checkedAt: number | null
  error: string | null
}

export function useOpportunities(enabled: boolean, session: number) {
  const [reports, setReports] = useState<AccountReport[]>([])
  const [connection, setConnection] = useState('连接中')
  const [streamError, setStreamError] = useState<string | null>(null)
  const [tradeCount, setTradeCount] = useState(0)
  const [now, setNow] = useState(0)
  const [quotes, setQuotes] = useState<Partial<Record<Coin, Quote>>>({})
  const archive = useFollowupArchive()
  const {
    followups,
    setFollowups,
    cooldownUntil,
    setCooldownUntil,
    canCollect,
  } = archive
  const cooldown = useRef(0)
  const readBackoff = useRef(60000)
  useEffect(() => {
    cooldown.current = cooldownUntil
  }, [cooldownUntil])

  // biome-ignore lint/correctness/useExhaustiveDependencies: session 是用户主动重新扫描的重置标识。
  useEffect(() => {
    if (!enabled || !canCollect) {
      if (!canCollect) setConnection('只读存档')
      const timer = setInterval(() => {
        const time = Date.now()
        setNow(time)
        setFollowups((previous) =>
          updateFollowups(previous, [], {}, time, false),
        )
      }, 1000)
      return () => clearInterval(timer)
    }
    const abort = new AbortController()
    const accounts = new Map<string, AccountReport>()
    const observations = new Map<string, Observation>()
    const trades = new Map<string, PublicTrade>()
    const quotesByCoin = new Map<Coin, Quote>()
    let socket: WebSocket
    let reconnect: ReturnType<typeof setTimeout> | undefined
    let lastMessage = Date.now(),
      lastPing = 0,
      nextPoll = 0,
      polling = false
    let backoff = 1000
    let connected = false
    let pendingMessages = 0
    let accountCursor = 0
    setReports([])
    setQuotes({})
    setTradeCount(0)
    setStreamError(null)
    setConnection('连接中')
    const publish = () => {
      if (abort.signal.aborted) return
      const current = [...accounts.values()]
      const currentQuotes = Object.fromEntries(quotesByCoin)
      const time = Date.now()
      const isConnected = connected
      setReports(current)
      setFollowups((previous) =>
        updateFollowups(
          previous,
          current.flatMap((report) => (report.error ? [] : report.summaries)),
          currentQuotes,
          time,
          isConnected,
        ),
      )
    }

    const poll = async () => {
      polling = true
      let limited = false
      const rows = [...accounts]
      for (let i = 0; i < rows.length; i++) {
        const [address, previous] = rows[accountCursor % rows.length]
        accountCursor = (accountCursor + 1) % rows.length
        if (abort.signal.aborted) break
        try {
          performanceMetrics.queue('opportunityScan', 1)
          const observation = await loadObservation(
            address,
            abort.signal,
            observations.get(address),
          )
          if (abort.signal.aborted) break
          performanceMetrics.input('opportunityScan', 1, observation.checkedAt)
          const { cards, summaries } = performanceMetrics.measure(
            'opportunityScan',
            () => ({
              cards: buildCards(observation),
              summaries: buildSummaries(observation),
            }),
          )
          observations.set(address, observation)
          accounts.set(address, {
            address,
            cards,
            summaries,
            checkedAt: observation.checkedAt,
            error: null,
          })
        } catch (error) {
          if (abort.signal.aborted) break
          accounts.set(address, {
            ...previous,
            error:
              error instanceof Error ? error.message : '主网读取失败，稍后重试',
          })
          if (error instanceof MainnetRateLimit) {
            cooldown.current = Math.max(
              error.retryAt,
              Date.now() + readBackoff.current,
            )
            readBackoff.current = Math.min(readBackoff.current * 2, 300000)
            setCooldownUntil(cooldown.current)
            limited = true
          }
        } finally {
          if (!abort.signal.aborted)
            performanceMetrics.queue('opportunityScan', 0)
        }
        performanceMetrics.retain(
          'opportunityScan',
          [...accounts.values()].reduce(
            (total, report) => total + report.summaries.length,
            0,
          ),
        )
        publish()
        if (limited) break
      }
      if (!limited) readBackoff.current = 60000
      nextPoll = Math.max(Date.now() + 30_000, cooldown.current)
      polling = false
    }
    const connect = () => {
      if (abort.signal.aborted) return
      setConnection('连接中')
      lastMessage = Date.now()
      socket = new WebSocket(MAINNET_WS)
      socket.onopen = () => {
        if (abort.signal.aborted) {
          socket.close()
          return
        }
        backoff = 1000
        connected = true
        setConnection('已连接')
        for (const coin of COINS)
          for (const type of ['trades', 'l2Book'])
            socket.send(
              JSON.stringify({
                method: 'subscribe',
                subscription: {
                  type,
                  coin,
                  ...(type === 'l2Book' ? { fast: true } : {}),
                },
              }),
            )
      }
      socket.onmessage = (event) => {
        if (abort.signal.aborted) return
        lastMessage = Date.now()
        try {
          const message = JSON.parse(event.data)
          if (message.channel !== 'l2Book' && message.channel !== 'trades')
            return
          pendingMessages++
          performanceMetrics.queue(
            'opportunityStream',
            1,
            pendingMessages > 1 ? 1 : 0,
          )
          if (message.channel === 'l2Book') {
            const quote = parseQuote(message.data, Date.now())
            performanceMetrics.input('opportunityStream', 1, quote.time)
            if (quote.time >= (quotesByCoin.get(quote.coin)?.time ?? 0))
              quotesByCoin.set(quote.coin, quote)
            setStreamError(null)
            return
          }
          const incoming = parseTrades(message.data)
          performanceMetrics.input(
            'opportunityStream',
            1,
            incoming.at(-1)?.time,
          )
          for (const trade of incoming) {
            if (
              trade.time < Date.now() - 5 * 60_000 ||
              trade.time > Date.now() + 10_000
            )
              continue
            trades.set(`${trade.coin}:${trade.time}:${trade.tid}`, trade)
          }
          // shortcut: 仅在当前标签页保留最近 5000 条；扩大覆盖率时再接入共享采集服务。
          while (trades.size > 5000) {
            trades.delete(trades.keys().next().value as string)
            performanceMetrics.queue('opportunityStream', 1, 0, 1)
          }
          setStreamError(null)
        } catch {
          quotesByCoin.clear()
          setQuotes({})
          setStreamError('公开行情格式异常，已暂停价格参考；等待下一次有效数据')
        }
      }
      socket.onerror = () => {
        connected = false
        if (!abort.signal.aborted) setConnection('重连中')
      }
      socket.onclose = () => {
        if (abort.signal.aborted) return
        connected = false
        quotesByCoin.clear()
        setQuotes({})
        setConnection('重连中')
        reconnect = setTimeout(connect, backoff)
        backoff = Math.min(backoff * 2, 30_000)
      }
    }
    connect()
    const timer = setInterval(() => {
      const started = performance.now()
      const time = Date.now()
      setNow(time)
      const currentQuotes = Object.fromEntries(quotesByCoin)
      setQuotes(currentQuotes)
      const isConnected = connected
      setFollowups((previous) =>
        updateFollowups(previous, [], currentQuotes, time, isConnected),
      )
      for (const [key, trade] of trades)
        if (trade.time < time - 5 * 60_000) trades.delete(key)
      setTradeCount(trades.size)
      if (socket.readyState === WebSocket.OPEN && time - lastPing > 20_000) {
        socket.send(JSON.stringify({ method: 'ping' }))
        lastPing = time
      }
      if (time - lastMessage > 45_000 && socket.readyState < WebSocket.CLOSING)
        socket.close()
      let added = false
      for (const candidate of rankAccounts([...trades.values()], time)) {
        if (accounts.size >= 6 || candidate.notional < MIN_NOTIONAL) break
        if (accounts.has(candidate.address)) continue
        accounts.set(candidate.address, {
          address: candidate.address,
          cards: [],
          summaries: [],
          checkedAt: null,
          error: null,
        })
        added = true
      }
      if (added) publish()
      if (
        !polling &&
        accounts.size &&
        time >= nextPoll &&
        time >= cooldown.current
      )
        void poll()
      performanceMetrics.queue('opportunityStream', 0)
      performanceMetrics.retain(
        'opportunityStream',
        trades.size + quotesByCoin.size,
      )
      performanceMetrics.record(
        'opportunityStream',
        performance.now() - started,
      )
      pendingMessages = 0
    }, 1000)
    return () => {
      abort.abort()
      clearInterval(timer)
      clearTimeout(reconnect)
      socket.close()
      performanceMetrics.queue('opportunityStream', 0)
      performanceMetrics.retain('opportunityStream', 0)
      performanceMetrics.queue('opportunityScan', 0)
      performanceMetrics.retain('opportunityScan', 0)
    }
  }, [enabled, session, canCollect, setFollowups, setCooldownUntil])

  return {
    reports,
    connection: enabled ? connection : '已暂停',
    streamError,
    tradeCount,
    now,
    quotes,
    followups,
    cooldownUntil,
    canCollect,
    archiveMessage: archive.archiveMessage,
    archiveOwned: archive.owned,
    saveFailed: archive.saveFailed,
    retrySave: archive.save,
    clearArchive: archive.clearArchive,
  }
}
