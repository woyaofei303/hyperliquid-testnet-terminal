import Decimal from 'decimal.js'

const D = Decimal.clone({ precision: 50 })
export const COINS = ['BTC', 'ETH', 'SOL'] as const
export const MIN_NOTIONAL = 100_000
export const HISTORY_MS = 20 * 60_000
export const STALE_MS = 90_000
export type Coin = (typeof COINS)[number]
export type Action = 'open' | 'add' | 'reduce' | 'close' | 'reverse'
export interface Fill {
  coin: string
  side: 'B' | 'A'
  px: string
  sz: string
  startPosition: string
  dir: string
  time: number
  oid: number
  tid: number
  hash: string
  twapId?: number
  liquidation?: unknown
}
export interface Observation {
  address: string
  startTime: number
  checkedAt: number
  positions: Record<Coin, string>
  fills: Fill[]
}
export interface OpportunityCard {
  id: string
  address: string
  coin: Coin
  orderKey: string
  action: Action
  side: 'long' | 'short'
  before: string
  after: string
  currentPosition: string
  notional: string
  size: string
  fillCount: number
  firstTime: number
  lastTime: number
  checkedAt: number
  status: 'holding' | 'reduced' | 'exited' | 'reversed' | 'activity'
  interleaved: boolean
  liquidation: boolean
  fills: Fill[]
}

export function decimal(value: unknown): Decimal {
  if (typeof value !== 'string' || !/^-?\d+(\.\d+)?$/.test(value)) {
    throw new Error('成交数值格式无效')
  }
  return new D(value)
}

export function classify(fill: Fill) {
  const before = decimal(fill.startPosition)
  const size = decimal(fill.sz)
  const price = decimal(fill.px)
  if (!['B', 'A'].includes(fill.side) || size.lte(0) || price.lte(0)) {
    throw new Error('成交方向或数量无效')
  }
  const delta = size.times(fill.side === 'B' ? 1 : -1)
  const after = before.plus(delta)
  const action: Action = before.isZero()
    ? 'open'
    : before.isPositive() === delta.isPositive()
      ? 'add'
      : after.isZero()
        ? 'close'
        : before.isPositive() === after.isPositive()
          ? 'reduce'
          : 'reverse'
  const side: 'long' | 'short' = (action === 'close' || action === 'reduce'
    ? before
    : after
  ).gt(0)
    ? 'long'
    : 'short'
  const expected =
    action === 'reverse'
      ? before.gt(0)
        ? 'Long > Short'
        : 'Short > Long'
      : `${action === 'open' || action === 'add' ? 'Open' : 'Close'} ${side === 'long' ? 'Long' : 'Short'}`
  if (fill.dir !== expected) throw new Error('成交方向与仓位计算不一致')
  return { before, after, delta, action, side, notional: size.times(price) }
}

export function fillKey(fill: Fill) {
  return `${fill.coin}:${fill.time}:${fill.tid}:${fill.oid}:${fill.side}`
}

export function positionChain(observation: Observation, coin: Coin) {
  const fills = observation.fills
    .filter((fill) => fill.coin === coin)
    .sort((a, b) => a.time - b.time)
  const steps = fills.map(classify)
  for (let i = 1; i < steps.length; i++) {
    if (!steps[i - 1].after.eq(steps[i].before))
      throw new Error(`${coin} 成交链不连续，等待补齐`)
  }
  if (
    steps.length &&
    !steps[steps.length - 1].after.eq(decimal(observation.positions[coin]))
  )
    throw new Error(`${coin} 成交与仓位快照不一致，等待复核`)
  return { fills, steps }
}

export function buildCards(observation: Observation): OpportunityCard[] {
  const cards: OpportunityCard[] = []
  for (const coin of COINS) {
    const { fills, steps } = positionChain(observation, coin)
    const groups = new Map<string, number[]>()
    fills.forEach((fill, index) => {
      const key =
        fill.twapId === undefined ? `order:${fill.oid}` : `twap:${fill.twapId}`
      const indices = groups.get(key) ?? []
      indices.push(index)
      groups.set(key, indices)
    })
    for (const [orderKey, indices] of groups) {
      const first = indices[0],
        last = indices[indices.length - 1]
      const group = indices.map((index) => fills[index])
      const notional = indices.reduce(
        (sum, index) => sum.plus(steps[index].notional),
        new D(0),
      )
      if (notional.lt(MIN_NOTIONAL)) continue
      const before = steps[first].before,
        after = steps[last].after
      const interleaved = last - first + 1 !== indices.length
      // shortcut: 交错或跨方向的订单只展示活动；以后需要按完整持仓周期拆分时再细化。
      const mixed = new Set(group.map((fill) => fill.side)).size > 1
      const action = before.isZero()
        ? 'open'
        : after.isZero()
          ? 'close'
          : before.isPositive() !== after.isPositive()
            ? 'reverse'
            : after.abs().gt(before.abs())
              ? 'add'
              : 'reduce'
      const side = (action === 'close' || action === 'reduce'
        ? before
        : after
      ).gt(0)
        ? 'long'
        : 'short'
      const later = steps.slice(last + 1)
      let status: OpportunityCard['status'] = 'activity'
      const liquidation = group.some((fill) => Boolean(fill.liquidation))
      if (
        !interleaved &&
        !mixed &&
        !liquidation &&
        ['open', 'add', 'reverse'].includes(action)
      ) {
        const exit = later.find(
          (step) =>
            step.after.isZero() ||
            step.after.isPositive() !== after.isPositive(),
        )
        status = exit
          ? exit.after.isZero()
            ? 'exited'
            : 'reversed'
          : later.some((step) => step.action === 'reduce')
            ? 'reduced'
            : 'holding'
      }
      cards.push({
        id: `${observation.address}:${coin}:${orderKey}`,
        address: observation.address,
        coin,
        orderKey,
        action,
        side,
        before: before.toFixed(),
        after: after.toFixed(),
        currentPosition: observation.positions[coin],
        notional: notional.toFixed(),
        size: group
          .reduce((sum, fill) => sum.plus(decimal(fill.sz)), new D(0))
          .toFixed(),
        fillCount: group.length,
        firstTime: fills[first].time,
        lastTime: fills[last].time,
        checkedAt: observation.checkedAt,
        status,
        interleaved: interleaved || mixed,
        liquidation,
        fills: group,
      })
    }
  }
  return cards.sort((a, b) => b.lastTime - a.lastTime)
}

export function cardStatus(
  card: OpportunityCard,
  now: number,
  unavailable = false,
) {
  if (unavailable || now - card.checkedAt > STALE_MS) return '待核验'
  return {
    holding: '仍持有',
    reduced: '已减仓',
    exited: '已退出',
    reversed: '已反手',
    activity: '仓位活动',
  }[card.status]
}
