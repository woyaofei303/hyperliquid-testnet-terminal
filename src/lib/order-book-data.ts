import type { Book } from './hyperliquid.ts'
import { Money } from './orders.ts'

export function orderBookData(book: Book | null) {
  const side = (index: 0 | 1) => {
    const rows = (book?.levels[index] ?? [])
      .filter((row) => {
        try {
          return (
            new Money(row.px).isFinite() &&
            new Money(row.px).gt(0) &&
            new Money(row.sz).isFinite() &&
            new Money(row.sz).gt(0)
          )
        } catch {
          return false
        }
      })
      .slice()
      .sort((a, b) => new Money(a.px).cmp(b.px) * (index === 0 ? -1 : 1))
    let total = new Money(0)
    let totalQuote = new Money(0)
    return rows.map((row) => {
      total = total.plus(row.sz)
      totalQuote = totalQuote.plus(new Money(row.px).times(row.sz))
      return {
        ...row,
        total: total.toFixed(),
        totalQuote: totalQuote.toFixed(),
        average: totalQuote.div(total).toFixed(),
      }
    })
  }
  const bids = side(0)
  const asks = side(1)
  const bestBid = bids[0]?.px
  const bestAsk = asks[0]?.px
  const spread = bestBid && bestAsk ? new Money(bestAsk).minus(bestBid) : null
  const percent =
    spread && bestBid && bestAsk
      ? spread.div(new Money(bestBid).plus(bestAsk).div(2)).times(100)
      : null
  return {
    bids,
    asks,
    midpoint:
      bestBid && bestAsk
        ? new Money(bestBid).plus(bestAsk).div(2).toFixed()
        : null,
    spread: spread?.toFixed() ?? null,
    percent: percent?.toFixed(3) ?? null,
  }
}
