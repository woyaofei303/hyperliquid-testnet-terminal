import { QUOTE_STALE_MS } from './entry-price.ts'
import {
  type Followup,
  HORIZONS,
  MAX_FOLLOWUPS,
  updateFollowups,
} from './followups.ts'
import { isAddress, parseQuote } from './mainnet-read.ts'
import { COINS, decimal, MIN_NOTIONAL, STALE_MS } from './opportunities.ts'

export const ARCHIVE_KEY = 'hl-mainnet-observations-v1'

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('对象无效')
  return value as Record<string, unknown>
}
function text(value: unknown): string {
  if (typeof value !== 'string' || !value.length || value.length > 300)
    throw new Error('文字无效')
  return value
}
function time(value: unknown): number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    !Number.isFinite(new Date(value).getTime())
  )
    throw new Error('时间无效')
  return value
}
function positive(value: unknown): string {
  const result = text(value)
  if (!decimal(result).gt(0)) throw new Error('金额无效')
  return result
}

export function readArchive(raw: string | null, now: number) {
  if (raw === null) return { followups: [] as Followup[], cooldownUntil: 0 }
  try {
    if (raw.length > 2_000_000) throw new Error('存档过大')
    const root = object(JSON.parse(raw))
    if (
      root.version !== 1 ||
      !Array.isArray(root.followups) ||
      root.followups.length > MAX_FOLLOWUPS
    )
      throw new Error('版本或记录数量无效')
    const readQuote = (value: unknown) => {
      const row = object(value)
      const receivedAt = time(row.receivedAt)
      if (receivedAt > now + QUOTE_STALE_MS) throw new Error('未来报价')
      return parseQuote(
        {
          coin: row.coin,
          time: row.time,
          levels: [
            row.bid === null ? [] : [row.bid],
            row.ask === null ? [] : [row.ask],
          ],
        },
        receivedAt,
      )
    }
    const followups = root.followups.map((value): Followup => {
      const row = object(value),
        signal = object(row.signal),
        storedEntry = object(row.entry)
      const coin = COINS.find((coin) => coin === row.coin)
      if (
        !coin ||
        !isAddress(row.address) ||
        (row.side !== 'long' && row.side !== 'short')
      )
        throw new Error('持仓标识无效')
      const detectedAt = time(row.detectedAt),
        checkedAt = time(row.checkedAt),
        lastTime = time(row.lastTime)
      if (
        detectedAt > now + QUOTE_STALE_MS ||
        checkedAt > detectedAt + QUOTE_STALE_MS ||
        detectedAt - checkedAt > STALE_MS ||
        lastTime > checkedAt
      )
        throw new Error('起点时间无效')
      const recentNotional = positive(signal.recentNotional),
        recentSize = positive(signal.recentSize)
      const averageEntryPrice = decimal(recentNotional)
        .div(decimal(recentSize))
        .toFixed()
      if (
        signal.eligible !== true ||
        signal.status !== '候选' ||
        !Array.isArray(signal.reasons) ||
        signal.reasons.length ||
        decimal(recentNotional).lt(MIN_NOTIONAL) ||
        signal.averageEntryPrice !== averageEntryPrice
      )
        throw new Error('候选依据无效')
      const entryQuote =
        row.entryQuote === undefined ? undefined : readQuote(row.entryQuote)
      if (entryQuote && entryQuote.coin !== coin)
        throw new Error('起点币种无效')
      let entry: Followup['entry']
      if (storedEntry.available === true) {
        const side = row.side === 'long' ? 'ask' : 'bid'
        const level = entryQuote?.[side]
        if (
          !entryQuote ||
          !level ||
          detectedAt - entryQuote.time > QUOTE_STALE_MS ||
          detectedAt - entryQuote.receivedAt > QUOTE_STALE_MS ||
          entryQuote.receivedAt > detectedAt ||
          entryQuote.time < lastTime
        )
          throw new Error('起点盘口无效')
        entry = {
          available: true,
          side,
          price: level.px,
          size: level.sz,
          reference: averageEntryPrice,
          quoteTime: entryQuote.time,
          adversePercent: decimal(level.px)
            .minus(decimal(averageEntryPrice))
            .div(decimal(averageEntryPrice))
            .times(row.side === 'long' ? 100 : -100)
            .toFixed(),
        }
        if (
          Object.entries(entry).some(
            ([key, value]) => storedEntry[key] !== value,
          )
        )
          throw new Error('起点价格不一致')
      } else if (storedEntry.available === false)
        entry = { available: false, reason: text(storedEntry.reason) }
      else throw new Error('起点状态无效')
      const record: Followup = {
        id: text(row.id),
        address: row.address,
        coin,
        side: row.side,
        detectedAt,
        checkedAt,
        lastTime,
        signal: {
          eligible: true,
          status: '候选',
          reasons: [],
          recentNotional,
          recentSize,
          averageEntryPrice,
        },
        entry,
        entryQuote,
        points: [],
      }
      if (!Array.isArray(row.points) || row.points.length !== HORIZONS.length)
        throw new Error('采样点数量无效')
      record.points = row.points.map((value, index) => {
        const point = object(value),
          minutes = HORIZONS[index],
          dueAt = detectedAt + minutes * 60000
        if (point.minutes !== minutes || point.dueAt !== dueAt)
          throw new Error('采样目标无效')
        if (point.status === 'missing')
          return {
            minutes,
            dueAt,
            status: 'missing',
            reason: text(point.reason),
          }
        if (!entry.available) throw new Error('无起点不能采样')
        if (point.status === 'pending')
          return { minutes, dueAt, status: 'pending' }
        if (
          point.status !== 'measured' ||
          time(point.sampledAt) > now + QUOTE_STALE_MS
        )
          throw new Error('采样状态无效')
        const quote = readQuote(point.quote)
        const measured = updateFollowups(
          [{ ...record, points: [{ minutes, dueAt, status: 'pending' }] }],
          [],
          { [coin]: quote },
          time(point.sampledAt),
          true,
        )[0].points[0]
        if (
          measured.status !== 'measured' ||
          measured.percent !== point.percent
        )
          throw new Error('采样价格或时间不一致')
        return measured
      })
      return record
    })
    if (new Set(followups.map((record) => record.id)).size !== followups.length)
      throw new Error('重复记录')
    return {
      followups: updateFollowups(followups, [], {}, now, false),
      cooldownUntil: time(root.cooldownUntil),
    }
  } catch {
    throw new Error(
      '本机存档无效或版本不支持，原数据未覆盖；请先备份后再清空记录',
    )
  }
}
