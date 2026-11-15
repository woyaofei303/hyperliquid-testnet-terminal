import type Decimal from 'decimal.js'
import {
  COINS,
  type Coin,
  decimal,
  type Fill,
  fillKey,
  HISTORY_MS,
  type Observation,
  STALE_MS,
} from './opportunities.ts'

export const MAINNET_INFO = 'https://api.hyperliquid.xyz/info'
export const MAINNET_WS = 'wss://api.hyperliquid.xyz/ws'
export const isAddress = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^0x[0-9a-fA-F]{40}$/.test(value) &&
  !/^0x0{40}$/.test(value)
const types = [
  'clearinghouseState',
  'userFillsByTime',
  'userTwapSliceFillsByTime',
] as const
type ReadType = (typeof types)[number]

export class MainnetRateLimit extends Error {
  retryAt: number
  constructor(retryAfter: string | null) {
    super('主网读取限流（HTTP 429），账户查询暂时冷却')
    const now = Date.now()
    const parsed =
      retryAfter && /^\d+(\.\d+)?$/.test(retryAfter)
        ? now + Math.ceil(Number(retryAfter) * 1000)
        : Date.parse(retryAfter ?? '')
    this.retryAt =
      Number.isSafeInteger(parsed) &&
      Number.isFinite(new Date(parsed).getTime())
        ? Math.max(now + 60000, parsed)
        : now + 60000
  }
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('主网响应格式无效')
  return value as Record<string, unknown>
}
function integer(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    throw new Error('成交时间或标识无效')
  return value
}
function parseFill(value: unknown): Fill {
  const row = object(value)
  if (
    typeof row.coin !== 'string' ||
    !['A', 'B'].includes(String(row.side)) ||
    typeof row.dir !== 'string' ||
    typeof row.hash !== 'string'
  )
    throw new Error('成交字段无效')
  const px = decimal(row.px),
    sz = decimal(row.sz),
    startPosition = decimal(row.startPosition)
  if (px.lte(0) || sz.lte(0)) throw new Error('成交价格或数量无效')
  return {
    coin: row.coin,
    side: row.side as 'A' | 'B',
    dir: row.dir,
    hash: row.hash,
    px: px.toFixed(),
    sz: sz.toFixed(),
    startPosition: startPosition.toFixed(),
    time: integer(row.time),
    tid: integer(row.tid),
    oid: integer(row.oid),
    liquidation: row.liquidation,
  }
}

async function read(
  type: ReadType,
  parameters: Record<string, unknown>,
  signal: AbortSignal,
): Promise<unknown> {
  if (!types.includes(type)) throw new Error('只允许主网公开只读查询')
  const response = await fetch(MAINNET_INFO, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...parameters, type }),
    signal: AbortSignal.any([signal, AbortSignal.timeout(12_000)]),
    cache: 'no-store',
  })
  if (response.status === 429)
    throw new MainnetRateLimit(response.headers.get('retry-after'))
  if (!response.ok)
    throw new Error(`主网读取失败（HTTP ${response.status}），稍后重试`)
  return response.json()
}

async function history(
  type: 'userFillsByTime' | 'userTwapSliceFillsByTime',
  user: string,
  startTime: number,
  endTime: number,
  signal: AbortSignal,
) {
  const fills = new Map<string, Fill>()
  let cursor = startTime
  for (let page = 0; page < 6; page++) {
    const data = await read(
      type,
      {
        user,
        startTime: cursor,
        endTime,
        ...(type === 'userFillsByTime' ? { aggregateByTime: false } : {}),
      },
      signal,
    )
    if (!Array.isArray(data)) throw new Error('成交列表格式无效')
    let latest = cursor
    for (const value of data) {
      const wrapper = type === 'userTwapSliceFillsByTime' ? object(value) : null
      const fill = parseFill(wrapper ? wrapper.fill : value)
      if (wrapper) fill.twapId = integer(wrapper.twapId)
      if (fill.time < cursor || fill.time > endTime)
        throw new Error('成交超出查询窗口')
      latest = Math.max(latest, fill.time)
      const key = fillKey(fill),
        previous = fills.get(key)
      if (previous && JSON.stringify(previous) !== JSON.stringify(fill))
        throw new Error('重复成交字段冲突')
      fills.set(key, fill)
    }
    // shortcut: API 仅保留近期成交；达到留存/分页上限时拒绝出卡，不猜测缺失记录。
    if (fills.size >= 10_000)
      throw new Error('成交达到历史留存上限，无法完整核验')
    if (data.length < 2000) return [...fills.values()]
    if (latest <= cursor)
      throw new Error('同毫秒成交超过分页上限，无法完整核验')
    cursor = latest
  }
  throw new Error('成交超过分页预算，无法完整核验')
}

export async function loadObservation(
  address: string,
  signal: AbortSignal,
  previous?: Observation,
): Promise<Observation> {
  if (!isAddress(address)) throw new Error('账户地址无效')
  const snapshot = object(
    await read('clearinghouseState', { user: address }, signal),
  )
  const checkedAt = integer(snapshot.time)
  if (Date.now() - checkedAt > STALE_MS || checkedAt > Date.now() + 10_000)
    throw new Error('主网仓位快照已过期或时间异常')
  if (previous?.address === address && checkedAt < previous.checkedAt)
    throw new Error('主网仓位快照时间倒退，等待重新核验')
  if (!Array.isArray(snapshot.assetPositions))
    throw new Error('仓位列表格式无效')
  const positions: Observation['positions'] = { BTC: '0', ETH: '0', SOL: '0' }
  for (const row of snapshot.assetPositions) {
    const position = object(object(row).position)
    for (const coin of COINS)
      if (position.coin === coin)
        positions[coin] = decimal(position.szi).toFixed()
  }
  const startTime = checkedAt - HISTORY_MS
  const cached =
    previous?.address === address &&
    previous.checkedAt >= startTime &&
    previous.startTime <= startTime
      ? previous
      : undefined
  const since = cached?.checkedAt ?? startTime
  const regular = await history(
    'userFillsByTime',
    address,
    since,
    checkedAt,
    signal,
  )
  const twaps = await history(
    'userTwapSliceFillsByTime',
    address,
    since,
    checkedAt,
    signal,
  )
  const fills = new Map(
    cached?.fills
      .filter((fill) => fill.time >= startTime)
      .map((fill) => [fillKey(fill), fill]),
  )
  for (const fill of [...regular, ...twaps]) {
    if (!COINS.some((coin) => coin === fill.coin)) continue
    const previous = fills.get(fillKey(fill))
    if (
      previous &&
      ['px', 'sz', 'startPosition', 'dir', 'oid', 'hash'].some(
        (key) => previous[key as keyof Fill] !== fill[key as keyof Fill],
      )
    )
      throw new Error('缓存、普通成交或 TWAP 成交冲突')
    if (
      previous?.twapId !== undefined &&
      fill.twapId !== undefined &&
      previous.twapId !== fill.twapId
    )
      throw new Error('TWAP 归属冲突')
    fills.set(fillKey(fill), {
      ...fill,
      twapId: fill.twapId ?? previous?.twapId,
      liquidation: fill.liquidation || previous?.liquidation,
    })
  }
  if (fills.size > 10_000)
    throw new Error('窗口成交超过本机核验上限，等待缩小窗口')
  return {
    address,
    startTime,
    checkedAt,
    positions,
    fills: [...fills.values()].filter((fill) =>
      COINS.some((coin) => coin === fill.coin),
    ),
  }
}

export interface PublicTrade {
  coin: string
  time: number
  tid: number
  px: string
  sz: string
  users: string[]
}
export function parseTrades(value: unknown): PublicTrade[] {
  if (!Array.isArray(value)) throw new Error('公开成交流格式无效')
  return value.map((value) => {
    const row = object(value)
    if (
      !COINS.some((coin) => coin === row.coin) ||
      !Array.isArray(row.users) ||
      row.users.length !== 2 ||
      !row.users.every(isAddress)
    )
      throw new Error('公开成交账户或币种无效')
    const px = decimal(row.px),
      sz = decimal(row.sz)
    if (px.lte(0) || sz.lte(0)) throw new Error('公开成交金额无效')
    return {
      coin: row.coin as string,
      time: integer(row.time),
      tid: integer(row.tid),
      px: px.toFixed(),
      sz: sz.toFixed(),
      users: row.users.map((address) => address.toLowerCase()),
    }
  })
}

export interface Quote {
  coin: Coin
  time: number
  receivedAt: number
  bid: { px: string; sz: string } | null
  ask: { px: string; sz: string } | null
}

export function parseQuote(value: unknown, receivedAt: number): Quote {
  const row = object(value)
  const coin = COINS.find((coin) => coin === row.coin)
  if (!coin) throw new Error('盘口币种无效')
  const time = integer(row.time)
  if (time > integer(receivedAt) + 10_000) throw new Error('盘口时间异常')
  if (!Array.isArray(row.levels) || row.levels.length !== 2)
    throw new Error('盘口档位格式无效')
  const sides = row.levels.map((side) => {
    if (!Array.isArray(side)) throw new Error('盘口档位格式无效')
    if (!side.length) return null
    const top = object(side[0])
    const px = decimal(top.px),
      sz = decimal(top.sz)
    if (px.lte(0) || sz.lte(0)) throw new Error('盘口价格或数量无效')
    return { px: px.toFixed(), sz: sz.toFixed() }
  })
  if (sides[0] && sides[1] && decimal(sides[0].px).gte(decimal(sides[1].px)))
    throw new Error('盘口买卖价格交叉')
  return { coin, time, receivedAt, bid: sides[0], ask: sides[1] }
}

export function rankAccounts(trades: PublicTrade[], now: number) {
  const totals = new Map<string, Decimal>()
  const seen = new Set<string>()
  for (const trade of trades) {
    if (trade.time < now - 5 * 60_000 || trade.time > now + 10_000) continue
    const key = `${trade.coin}:${trade.time}:${trade.tid}`
    if (seen.has(key)) continue
    seen.add(key)
    const amount = decimal(trade.px).times(decimal(trade.sz))
    for (const user of new Set(trade.users))
      totals.set(user, (totals.get(user) ?? decimal('0')).plus(amount))
  }
  return [...totals]
    .map(([address, total]) => ({ address, notional: total.toNumber() }))
    .sort((a, b) => b.notional - a.notional)
}
