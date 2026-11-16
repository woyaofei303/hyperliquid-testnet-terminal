import type { WireOrder } from './order-ticket.ts'
import { Money, positiveDecimal } from './orders.ts'
import type { ConfirmationAction } from './trading.ts'

export function quoteAmount(size: string, price: string) {
  const amount = new Money(size).times(positiveDecimal(price, '价格'))
  return amount.toFixed(Math.max(6, amount.decimalPlaces()))
}

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
    : quoteAmount(quantity.toFixed(), price)
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

export function validateOrderCapacity(
  action: ConfirmationAction,
  current: { maxTradeSzs: string[]; markPx: string },
  position: string,
) {
  const ticket = action.kind === 'ticket' ? action.ticket : null
  const mark = positiveDecimal(current.markPx, '标记价')
  const orders: {
    b: boolean
    r: boolean
    s: string
    p: string
    t?: WireOrder['t']
  }[] =
    action.kind === 'order'
      ? [action.order]
      : action.ticket.kind === 'orders'
        ? action.ticket.grouping === 'normalTpsl'
          ? action.ticket.orders.slice(0, 1)
          : action.ticket.orders
        : action.ticket.kind === 'chase'
          ? [action.ticket.order]
          : action.ticket.kind === 'twap'
            ? [
                {
                  b: action.ticket.action.twap.b,
                  r: action.ticket.action.twap.r,
                  s: action.ticket.action.twap.s,
                  p: mark.toFixed(),
                },
              ]
            : [
                {
                  b: action.ticket.action.isBuy,
                  r: action.ticket.action.reduceOnly,
                  s: action.ticket.action.sz,
                  p: mark.toFixed(),
                },
              ]
  const held = new Money(position)
  if (!held.isFinite()) throw new Error('仓位数据无效')
  for (const buy of [true, false]) {
    let opening = new Money(0)
    let openingValue = new Money(0)
    let closing = new Money(0)
    for (const order of orders.filter((order) => order.b === buy)) {
      const size = new Money(order.s)
      if (!size.isFinite() || size.lt(0)) throw new Error('数量无效')
      if (order.r) {
        if (buy ? held.gte(0) : held.lte(0))
          throw new Error('可平仓位已变化，请重新预览')
        closing =
          ticket?.kind === 'orders' && ticket.grouping === 'positionTpsl'
            ? Money.max(closing, size)
            : closing.plus(size)
      } else {
        const price =
          (action.kind === 'order'
            ? action.orderKind
            : action.ticket.orderKind) === 'market'
            ? mark
            : order.t && 'trigger' in order.t && order.t.trigger.isMarket
              ? positiveDecimal(order.t.trigger.triggerPx, '触发价')
              : positiveDecimal(order.p, '委托价')
        opening = opening.plus(size)
        openingValue = openingValue.plus(size.times(price))
      }
    }
    if (closing.gt(held.abs())) throw new Error('可平仓位已变化，请重新预览')
    const maximum = new Money(current.maxTradeSzs[buy ? 0 : 1])
    if (!maximum.isFinite() || maximum.lt(0))
      throw new Error('账户最大可下数量无效')
    if (Money.max(opening, openingValue.div(mark)).gt(maximum))
      throw new Error('下单额度已变化，请重新预览')
  }
}
