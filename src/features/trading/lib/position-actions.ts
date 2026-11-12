import type { MarketContext } from '../../../shared/lib/fameex-testnet.ts'
import { defaultOrderFields } from './order-form-fields.ts'
import { prepareTicket, type Ticket } from './order-ticket.ts'
import { Money, positiveDecimal } from './orders.ts'

export type PositionActionKind = 'limit' | 'market' | 'trailing' | 'reverse'
export interface PositionActionOptions {
  kind: PositionActionKind
  size?: string
  price?: string
  retracement?: string
  retracementUnit?: 'pct' | 'px'
  activationPrice?: string
}
export function preparePositionAction(
  market: MarketContext,
  position: string,
  price: string,
  options: PositionActionOptions,
): Ticket {
  const signed = new Money(position)
  if (!signed.isFinite() || signed.isZero())
    throw new Error('当前没有可操作的仓位')
  const size =
    options.kind === 'reverse'
      ? signed.abs().times(2).toFixed()
      : (options.size ?? signed.abs().toFixed())
  if (
    options.kind !== 'reverse' &&
    positiveDecimal(size, '平仓数量').gt(signed.abs())
  )
    throw new Error('平仓数量超过当前仓位')
  return prepareTicket({
    ...defaultOrderFields(market),
    market,
    mark: market.context.markPx,
    side: signed.gt(0) ? 'sell' : 'buy',
    kind: options.kind === 'reverse' ? 'market' : options.kind,
    price: options.kind === 'limit' ? (options.price ?? '') : price,
    size,
    reduceOnly: options.kind !== 'reverse',
    slippageBps: 50,
    retracement: options.retracement ?? '',
    retracementUnit: options.retracementUnit ?? 'pct',
    activationPrice: options.activationPrice ?? '',
  })
}
export function protectionPrice(
  entry: string,
  size: string,
  leverage: number,
  value: string,
  unit: 'roe' | 'usd',
) {
  const amount = new Money(value)
  const signed = new Money(size)
  const delta =
    unit === 'usd'
      ? amount.div(signed)
      : new Money(entry)
          .times(amount)
          .div(100)
          .div(leverage)
          .times(signed.isPositive() ? 1 : -1)
  return new Money(entry).plus(delta).toFixed()
}
export function protectionReturn(
  entry: string,
  size: string,
  leverage: number,
  price: string,
  unit: 'roe' | 'usd',
) {
  const delta = new Money(price).minus(entry)
  return (
    unit === 'usd'
      ? delta.times(size)
      : delta
          .div(entry)
          .times(leverage)
          .times(100)
          .times(new Money(size).isPositive() ? 1 : -1)
  )
    .toDecimalPlaces(4)
    .toFixed()
}
