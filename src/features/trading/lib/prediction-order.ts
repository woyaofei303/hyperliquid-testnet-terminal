import { Money, positiveDecimal } from './orders.ts'

export function predictionEstimate(
  size: string,
  levels: { px: string; sz: string }[],
) {
  if (!size || size === '0') return { value: null, slippage: '0%' }
  try {
    const quantity = positiveDecimal(size, '数量')
    const best = positiveDecimal(levels[0]?.px ?? '', '价格')
    let remaining = quantity,
      value = new Money(0)
    for (const level of levels) {
      const fill = Money.min(remaining, positiveDecimal(level.sz, '数量'))
      value = value.plus(fill.times(positiveDecimal(level.px, '价格')))
      remaining = remaining.minus(fill)
      if (remaining.isZero()) break
    }
    if (remaining.gt(0)) return { value: null, slippage: 'N/A' }
    return {
      value: value.toFixed(),
      slippage: `${value.div(quantity).div(best).minus(1).abs().times(100).toFixed(2)}%`,
    }
  } catch {
    return { value: null, slippage: 'N/A' }
  }
}
