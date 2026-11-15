import {
  COINS,
  type Coin,
  decimal,
  type Fill,
  MIN_NOTIONAL,
  type Observation,
  positionChain,
  STALE_MS,
} from './opportunities.ts'

export const CANDIDATE_WINDOW_MS = 5 * 60_000
export interface PositionSummary {
  id: string
  address: string
  coin: Coin
  side: 'long' | 'short'
  origin: 'open' | 'add' | 'reverse'
  before: string
  currentPosition: string
  firstTime: number
  lastTime: number
  checkedAt: number
  orderCount: number
  hasReduction: boolean
  liquidation: boolean
  exitsInWindow: number
  increases: { time: number; notional: string; size: string }[]
  fills: Fill[]
}

export function buildSummaries(observation: Observation): PositionSummary[] {
  const summaries: PositionSummary[] = []
  for (const coin of COINS) {
    const { fills, steps } = positionChain(observation, coin)
    if (!fills.length) continue
    let start = 0
    steps.forEach((step, index) => {
      if (step.action === 'open' || step.action === 'reverse') start = index
    })
    const segment = fills.slice(start)
    const segmentSteps = steps.slice(start)
    const first = segmentSteps[0]
    summaries.push({
      id: `${observation.address}:${coin}:${segment[0].time}:${segment[0].tid}`,
      address: observation.address,
      coin,
      side: first.side,
      origin:
        first.action === 'open' || first.action === 'reverse'
          ? first.action
          : 'add',
      before: first.before.toFixed(),
      currentPosition: observation.positions[coin],
      firstTime: segment[0].time,
      lastTime: segment[segment.length - 1].time,
      checkedAt: observation.checkedAt,
      orderCount: new Set(
        segment.map((fill) =>
          fill.twapId === undefined
            ? `order:${fill.oid}`
            : `twap:${fill.twapId}`,
        ),
      ).size,
      hasReduction: segmentSteps.some(
        (step) => step.action === 'reduce' || step.action === 'close',
      ),
      liquidation: segment.some((fill) => Boolean(fill.liquidation)),
      exitsInWindow: steps.filter(
        (step) => step.action === 'close' || step.action === 'reverse',
      ).length,
      increases: segmentSteps.flatMap((step, index) => {
        const size =
          step.action === 'reverse'
            ? step.after.abs()
            : step.action === 'open' || step.action === 'add'
              ? decimal(segment[index].sz)
              : null
        return size
          ? [
              {
                time: segment[index].time,
                size: size.toFixed(),
                notional: size.times(decimal(segment[index].px)).toFixed(),
              },
            ]
          : []
      }),
      fills: segment,
    })
  }
  return summaries.sort((a, b) => b.lastTime - a.lastTime)
}

export function assessCandidate(
  summary: PositionSummary,
  now: number,
  unavailable = false,
) {
  const recent = summary.increases.filter(
    (row) => row.time >= now - CANDIDATE_WINDOW_MS && row.time <= now + 10_000,
  )
  const recentNotional = recent.reduce(
    (sum, row) => sum.plus(decimal(row.notional)),
    decimal('0'),
  )
  const recentSize = recent.reduce(
    (sum, row) => sum.plus(decimal(row.size)),
    decimal('0'),
  )
  const reasons: string[] = []
  if (unavailable || now - summary.checkedAt > STALE_MS)
    reasons.push('数据暂停、过期或最新核验未通过')
  if (decimal(summary.currentPosition).isZero())
    reasons.push('该方向持仓已退出')
  if (summary.hasReduction) reasons.push('本段持仓期间已发生减仓')
  if (summary.liquidation) reasons.push('包含清算成交')
  if (summary.exitsInWindow >= 2) reasons.push('近 20 分钟至少两次平仓或反手')
  if (recentNotional.lt(MIN_NOTIONAL))
    reasons.push('近 5 分钟新增仓位成交不足 100,000 USDC')
  const eligible = reasons.length === 0
  const status =
    unavailable || now - summary.checkedAt > STALE_MS
      ? '待核验'
      : decimal(summary.currentPosition).isZero()
        ? '已退出'
        : eligible
          ? '候选'
          : '仅观察'
  return {
    eligible,
    status,
    reasons,
    recentNotional: recentNotional.toFixed(),
    recentSize: recentSize.toFixed(),
    averageEntryPrice: recentSize.gt(0)
      ? recentNotional.div(recentSize).toFixed()
      : null,
  }
}
