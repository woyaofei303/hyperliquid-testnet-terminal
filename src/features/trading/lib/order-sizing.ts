import { Money, positiveDecimal } from './orders.ts'

export function amountFromPercent(
  maximum: string,
  percent: number,
  unit: 'base' | 'usdc',
  price: string,
  precision: number,
) {
  if (!Number.isFinite(percent) || percent < 0 || percent > 100)
    throw new Error('下单比例须在 0% 至 100% 之间')
  const max = new Money(maximum)
  if (!max.isFinite() || max.lt(0)) throw new Error('最大可下数量无效')
  const quantity = max
    .times(percent)
    .div(100)
    .toDecimalPlaces(precision, Money.ROUND_DOWN)
  return unit === 'base'
    ? quantity.toFixed()
    : quantity
        .times(positiveDecimal(price, '价格'))
        .toFixed(6, Money.ROUND_DOWN)
}

export function sizeFromAmount(
  amount: string,
  unit: 'base' | 'usdc',
  price: string,
  precision: number,
) {
  const quantity = positiveDecimal(amount, unit === 'base' ? '数量' : '金额')
  return unit === 'base'
    ? quantity.toFixed()
    : quantity
        .div(positiveDecimal(price, '价格'))
        .toDecimalPlaces(precision, Money.ROUND_DOWN)
        .toFixed()
}
export function maximumOrderSize({
  maxTradeSize,
  position,
  side,
  reduceOnly,
  markPrice,
  orderPrice,
  precision,
}: {
  maxTradeSize: string
  position: string
  side: 'buy' | 'sell'
  reduceOnly: boolean
  markPrice: string
  orderPrice: string
  precision: number
}) {
  const held = new Money(position)
  if (reduceOnly)
    return (
      (side === 'sell' && held.gt(0)) || (side === 'buy' && held.lt(0))
        ? held.abs()
        : new Money(0)
    ).toFixed()
  const maximum = new Money(maxTradeSize)
  if (!maximum.isFinite() || maximum.lt(0))
    throw new Error('账户最大可下数量无效')
  const ratio = Money.min(
    1,
    positiveDecimal(markPrice, '标记价').div(
      positiveDecimal(orderPrice, '价格'),
    ),
  )
  return maximum
    .times(ratio)
    .toDecimalPlaces(precision, Money.ROUND_DOWN)
    .toFixed()
}
