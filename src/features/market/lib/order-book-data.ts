import type { Book } from '../../../shared/lib/hyperliquid.ts'
import { Money } from '../../trading/lib/orders.ts'

export function orderBookData(book: Book | null, step?: string) {
  const priceStep = step === undefined ? null : new Money(step)
  if (priceStep && (!priceStep.isFinite() || priceStep.lte(0)))
    throw new Error('价格精度必须为正数')
  const best: (string | undefined)[] = []
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
    best[index] = rows[0]?.px
    const groups = new Map<
      string,
      {
        px: string
        sz: InstanceType<typeof Money>
        n: number
        quote: InstanceType<typeof Money>
      }
    >()
    for (const row of rows) {
      const price = new Money(row.px)
      const px = priceStep
        ? price
            .div(priceStep)
            .toDecimalPlaces(
              0,
              index === 0 ? Money.ROUND_FLOOR : Money.ROUND_CEIL,
            )
            .times(priceStep)
            .toFixed()
        : row.px
      const group = groups.get(px) ?? {
        px,
        sz: new Money(0),
        n: 0,
        quote: new Money(0),
      }
      group.sz = group.sz.plus(row.sz)
      group.n += row.n
      // 累计金额保留原始报价，不能按合并后的档位价格重算。
      group.quote = group.quote.plus(price.times(row.sz))
      groups.set(px, group)
    }
    let total = new Money(0)
    let totalQuote = new Money(0)
    return [...groups.values()].map((row) => {
      total = total.plus(row.sz)
      totalQuote = totalQuote.plus(row.quote)
      return {
        px: row.px,
        sz: row.sz.toFixed(),
        n: row.n,
        total: total.toFixed(),
        totalQuote: totalQuote.toFixed(),
        average: totalQuote.div(total).toFixed(),
      }
    })
  }
  const bids = side(0)
  const asks = side(1)
  const [bestBid, bestAsk] = best
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
