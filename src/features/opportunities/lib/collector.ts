import { createHash } from 'node:crypto'
import { mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { buildSummaries, type PositionSummary } from './candidates.ts'
import {
  loadObservation,
  MAINNET_WS,
  MainnetRateLimit,
  type PublicTrade,
  parseQuote,
  parseTrades,
  type Quote,
  rankAccounts,
} from './mainnet-read.ts'
import {
  COINS,
  type Coin,
  MIN_NOTIONAL,
  type Observation,
} from './opportunities.ts'
import {
  createStudy,
  STUDY_COST_BPS,
  STUDY_METHOD,
  summarizeStudy,
  updateStudy,
} from './study.ts'

export async function collectStudy(
  directory: string,
  minutes: number,
  signal: AbortSignal,
) {
  signal.throwIfAborted()
  let study = createStudy(Date.now(), minutes)
  const output = resolve(directory)
  mkdirSync(dirname(output), { recursive: true })
  // 新批次只写新目录；拒绝覆盖或续写旧批次，保留原始时间和缺测。
  mkdirSync(output)
  mkdirSync(join(output, 'evidence'))
  writeFileSync(
    join(output, 'protocol.json'),
    JSON.stringify(
      {
        version: study.version,
        method: STUDY_METHOD,
        network: 'hyperliquid-mainnet',
        readOnly: true,
        startedAt: study.startedAt,
        enrollmentEndsAt: study.enrollmentEndsAt,
        endsAt: study.endsAt,
        coins: COINS,
        maxAccounts: 6,
        uniqueSignal: 'account+coin',
        controls: study.controls.map(({ coin, side, scheduledAt }) => ({
          coin,
          side,
          scheduledAt,
        })),
        horizonsMinutes: [1, 5, 15],
        extraRoundTripCostBps: STUDY_COST_BPS,
        rule: '同网页候选规则；固定预设时点对照，不按后续价格挑选；费用为按起点名义金额扣减的假设，不是实际费率',
      },
      null,
      2,
    ),
    { flag: 'wx' },
  )
  const abort = new AbortController()
  const trades = new Map<string, PublicTrade>()
  const accounts = new Map<string, Observation | undefined>()
  let quotes: Partial<Record<Coin, Quote>> = {}
  let socket: WebSocket | undefined
  let connected = false,
    stopped = false,
    polling = false
  let cursor = 0,
    nextPoll = 0,
    cooldownUntil = 0,
    readBackoff = 60000,
    reconnectBackoff = 1000
  let lastMessageAt = Date.now(),
    lastPingAt = 0,
    lastSaveAt = 0
  let reconnect: ReturnType<typeof setTimeout> | undefined
  let timer: ReturnType<typeof setInterval> | undefined
  const diagnostics = {
    verified: 0,
    readErrors: 0,
    rateLimits: 0,
    droppedTrades: 0,
    errors: [] as { at: number; message: string; address?: string }[],
  }
  const error = (message: string, address?: string) => {
    diagnostics.errors.push({ at: Date.now(), message, address })
    if (diagnostics.errors.length > 20) diagnostics.errors.shift()
  }
  const atomic = (name: string, data: string) => {
    writeFileSync(join(output, `${name}.tmp`), data)
    renameSync(join(output, `${name}.tmp`), join(output, name))
  }
  const save = (
    status: 'collecting' | 'following' | 'complete' | 'interrupted' | 'failed',
  ) => {
    const summary = summarizeStudy(study)
    const capturedAt = Date.now()
    atomic(
      'checkpoint.json',
      JSON.stringify(
        {
          status,
          capturedAt,
          study,
          summary,
          diagnostics: {
            ...diagnostics,
            connected,
            lastMessageAt,
            cooldownUntil,
            accounts: [...accounts.keys()],
          },
        },
        null,
        2,
      ),
    )
    const fmt = (value: string | null) =>
      value === null ? '—' : `${Number(value).toFixed(4)}%`
    const lines = summary
      .filter((row) => row.signal.total || row.control.total)
      .flatMap((row) =>
        row.costs.map(
          (cost) =>
            `| ${row.coin} ${row.side === 'long' ? '多' : '空'} | ${row.minutes} | ${cost.roundTripBps} | ${row.signal.measured}/${row.signal.total} | ${row.signal.missing}/${row.signal.pending} | ${row.control.measured}/${row.control.total} | ${row.control.missing}/${row.control.pending} | ${fmt(cost.signalNetPercent)} | ${fmt(cost.controlNetPercent)} | ${fmt(cost.difference)} |`,
        ),
      )
    const label = {
      collecting: '入组中',
      following: '入组结束，等待后续采样',
      complete: '完整观察窗口已结束',
      interrupted: '手动停止，批次未完成',
      failed: '运行失败，批次未完成',
    }[status]
    atomic(
      'report.md',
      `# 主网只读固定批次对照\n\n状态：${label}。更新：${new Date(capturedAt).toISOString()}。候选 ${study.signals.length} 条，预设对照 ${study.controls.length} 条。\n\n入组截止：${new Date(study.enrollmentEndsAt).toISOString()}；最晚结束：${new Date(study.endsAt).toISOString()}。时间为 UTC。\n\n每 5 分钟预设一次 BTC／ETH／SOL 的多、空对照，首次在启动后 5 秒；每个时点最多等待 10 秒获得起点报价，缺测不补。仅比较相同币种和方向，不输出全局胜率或盈利结论。每个账户币种只保留第一次入选，限本批固定发现的前 6 个账户。\n\n成本为双边合计额外成本，1 bps = 0.01%；按起点名义金额从价差中扣减，不是账户实际费率。原始价差已含买卖价差，未模拟成交、深度、杠杆、资金费或真实滑点。差值为信号均值减对照均值，单位为百分点；无有效对照时显示 —。\n\n| 币种方向 | 分钟 | 成本 bps | 信号有效/总计 | 信号缺测/待采 | 对照有效/总计 | 对照缺测/待采 | 信号净价差 | 对照净价差 | 差值 |\n|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|\n${lines.join('\n')}\n\n固定时点不是随机实验；相近时点、同一账户的不同币种也未必独立。样本少、覆盖窄或缺测不均衡时不能推断交易优势。不同期限有效样本可能不同，不能把各列拼成同一组合收益。\n\n已核验账户快照 ${diagnostics.verified} 次，读取错误 ${diagnostics.readErrors} 次，其中限流 ${diagnostics.rateLimits} 次；公共成交缓存丢弃 ${diagnostics.droppedTrades} 条。原始起点成交证据见 evidence/，报价和全部采样见 checkpoint.json，预先固定的规则与时点见 protocol.json。失败或中断时只保留已保存结果，不续写旧批次。\n`,
    )
    lastSaveAt = capturedAt
  }
  const advance = (
    summaries: PositionSummary[] = [],
    observation?: Observation,
  ) => {
    const next = updateStudy(study, summaries, quotes, Date.now(), connected)
    for (const row of next.signals.slice(study.signals.length)) {
      const source = summaries.find((summary) => summary.id === row.id)
      if (!source || !observation)
        throw new Error('新候选缺少原始成交证据，停止采集')
      const name = createHash('sha256').update(row.id).digest('hex')
      writeFileSync(
        join(output, 'evidence', `${name}.json`),
        JSON.stringify({ signal: row, source, observation }, null, 2),
        { flag: 'wx' },
      )
    }
    const changed = next !== study
    study = next
    if (changed || Date.now() - lastSaveAt >= 30000)
      save(Date.now() < study.enrollmentEndsAt ? 'collecting' : 'following')
  }
  return await new Promise<{
    directory: string
    status: 'complete' | 'interrupted'
  }>((resolveRun, reject) => {
    const finish = (
      status: 'complete' | 'interrupted' | 'failed',
      cause?: unknown,
    ) => {
      if (stopped) return
      stopped = true
      abort.abort()
      clearInterval(timer)
      clearTimeout(reconnect)
      signal.removeEventListener('abort', interrupted)
      connected = false
      socket?.close()
      try {
        study = updateStudy(study, [], {}, Date.now(), false)
        save(status)
      } catch (storageError) {
        reject(storageError)
        return
      }
      if (status === 'failed') reject(cause)
      else resolveRun({ directory: output, status })
    }
    const interrupted = () => finish('interrupted')
    const poll = async () => {
      polling = true
      let limited = false
      const rows = [...accounts.keys()]
      for (let i = 0; i < rows.length; i++) {
        if (stopped || Date.now() >= study.enrollmentEndsAt) break
        const address = rows[cursor % rows.length]
        cursor = (cursor + 1) % rows.length
        let observation: Observation
        let summaries: PositionSummary[]
        try {
          observation = await loadObservation(
            address,
            abort.signal,
            accounts.get(address),
          )
          summaries = buildSummaries(observation)
        } catch (cause) {
          if (stopped) return
          diagnostics.readErrors++
          error(
            cause instanceof Error ? cause.message : '账户读取失败',
            address,
          )
          if (cause instanceof MainnetRateLimit) {
            diagnostics.rateLimits++
            cooldownUntil = Math.max(cause.retryAt, Date.now() + readBackoff)
            readBackoff = Math.min(readBackoff * 2, 300000)
            limited = true
            break
          }
          continue
        }
        if (stopped) return
        accounts.set(address, observation)
        diagnostics.verified++
        advance(summaries, observation)
      }
      if (!limited) readBackoff = 60000
      nextPoll = Math.max(Date.now() + 30000, cooldownUntil)
      polling = false
      if (!stopped)
        save(Date.now() < study.enrollmentEndsAt ? 'collecting' : 'following')
    }
    const connect = () => {
      if (stopped) return
      lastMessageAt = Date.now()
      socket = new WebSocket(MAINNET_WS)
      socket.onopen = () => {
        if (stopped) return
        connected = true
        reconnectBackoff = 1000
        for (const coin of COINS)
          for (const type of ['trades', 'l2Book'])
            socket?.send(
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
        if (stopped) return
        lastMessageAt = Date.now()
        try {
          const message = JSON.parse(String(event.data))
          if (message.channel === 'l2Book') {
            const quote = parseQuote(message.data, Date.now())
            if (quote.time >= (quotes[quote.coin]?.time ?? 0))
              quotes[quote.coin] = quote
          } else if (
            message.channel === 'trades' &&
            Date.now() < study.enrollmentEndsAt
          ) {
            for (const trade of parseTrades(message.data)) {
              if (
                trade.time < Date.now() - 300000 ||
                trade.time > Date.now() + 10000
              )
                continue
              trades.set(`${trade.coin}:${trade.time}:${trade.tid}`, trade)
            }
            while (trades.size > 5000) {
              trades.delete(trades.keys().next().value as string)
              diagnostics.droppedTrades++
            }
          }
        } catch {
          quotes = {}
          error('公开行情格式异常，已清除报价，等待下一次有效数据')
        }
      }
      socket.onerror = () => {
        connected = false
      }
      socket.onclose = () => {
        if (stopped) return
        connected = false
        quotes = {}
        reconnect = setTimeout(connect, reconnectBackoff)
        reconnectBackoff = Math.min(reconnectBackoff * 2, 30000)
      }
    }
    signal.addEventListener('abort', interrupted, { once: true })
    try {
      save('collecting')
      connect()
      timer = setInterval(() => {
        try {
          const now = Date.now()
          advance()
          if (now >= study.endsAt) {
            finish('complete')
            return
          }
          if (
            socket?.readyState === WebSocket.OPEN &&
            now - lastPingAt >= 20000
          ) {
            socket.send(JSON.stringify({ method: 'ping' }))
            lastPingAt = now
          }
          if (
            now - lastMessageAt > 45000 &&
            socket &&
            socket.readyState < WebSocket.CLOSING
          )
            socket.close()
          for (const [key, trade] of trades)
            if (trade.time < now - 300000) trades.delete(key)
          if (now >= study.enrollmentEndsAt) return
          for (const row of rankAccounts([...trades.values()], now)) {
            if (accounts.size >= 6 || row.notional < MIN_NOTIONAL) break
            if (!accounts.has(row.address)) accounts.set(row.address, undefined)
          }
          if (!polling && accounts.size && now >= nextPoll)
            void poll().catch((cause) => finish('failed', cause))
        } catch (cause) {
          finish('failed', cause)
        }
      }, 1000)
    } catch (cause) {
      finish('failed', cause)
    }
  })
}
