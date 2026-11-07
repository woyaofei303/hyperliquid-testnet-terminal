import type { orderBookData } from './order-book-data.ts'

type Depth = ReturnType<typeof orderBookData>
type Row = Depth['bids'][number]

export function depthChartScale(depth: Depth, priceDecimals: number) {
  const bestBid = Number(depth.bids[0]?.px)
  const bestAsk = Number(depth.asks[0]?.px)
  const midpoint = depth.midpoint
    ? Number(depth.midpoint)
    : Number.isFinite(bestBid)
      ? bestBid
      : bestAsk
  if (!Number.isFinite(midpoint)) return null
  const radius = Math.max(
    Math.abs(midpoint - Number(depth.bids.at(-1)?.px ?? midpoint)),
    Math.abs(Number(depth.asks.at(-1)?.px ?? midpoint) - midpoint),
    10 ** -priceDecimals,
  )
  return {
    midpoint,
    radius,
    maxTotal:
      Math.max(
        Number(depth.bids.at(-1)?.total ?? 0),
        Number(depth.asks.at(-1)?.total ?? 0),
      ) * 1.1,
  }
}

// 从最优报价向外画阶梯，档位之间保持累计数量，不插值制造流动性。
export function depthStepPath(
  rows: Row[],
  x: (price: number) => number,
  y: (total: number) => number,
  baseline: number,
) {
  if (!rows.length) return { line: '', area: '' }
  let line = `M ${x(Number(rows[0].px))} ${baseline}`
  for (const row of rows)
    line += ` H ${x(Number(row.px))} V ${y(Number(row.total))}`
  return {
    line,
    area: `${line} V ${baseline} Z`,
  }
}

export function depthAtDistance(
  rows: Row[],
  midpoint: number,
  distance: number,
) {
  // 只返回已经到达的档位，避免把更远的挂单算入当前价格的累计量。
  let selected: Row | undefined
  for (const row of rows) {
    if (Math.abs(Number(row.px) - midpoint) > distance) break
    selected = row
  }
  return selected
}
