import { type Market, Money } from './orders.ts'

export function marketFees(
  market: Market,
  fees: {
    userCrossRate?: string
    userAddRate?: string
    userSpotCrossRate: string
    userSpotAddRate: string
    activeReferralDiscount?: string
  },
  side: 'buy' | 'sell',
) {
  const cash = market.kind === 'spot' || market.kind === 'outcome'
  const outcome = market.kind === 'outcome'
  const taker = new Money(
    cash ? fees.userSpotCrossRate : (fees.userCrossRate ?? 'NaN'),
  )
  const maker = new Money(
    cash ? fees.userSpotAddRate : (fees.userAddRate ?? 'NaN'),
  )
  const discount = new Money(fees.activeReferralDiscount ?? 0)
  const deployer = new Money(
    market.kind === 'spot' ? 0 : (market.deployerFeeScale ?? 0),
  )
  const outcomeScale = new Money(outcome ? (market.feeScale ?? 0) : 1)
  if (
    [taker, maker].some((v) => !v.isFinite() || v.abs().gt(1)) ||
    [discount, deployer, outcomeScale].some((v) => !v.isFinite() || v.lt(0)) ||
    discount.gt(1)
  )
    throw new Error('市场或账户费率无效')
  const scale = deployer.plus(Money.max(1, deployer))
  const share = deployer.div(scale)
  const base = new Money(market.stablePair ? '0.2' : 1).times(
    market.growthMode === 'enabled' ? '0.1' : 1,
  )
  let take = taker
    .times(base)
    .times(scale)
    .times(outcomeScale)
    .times(new Money(1).minus(discount))
  let make = maker.times(base)
  if (make.gt(0))
    make = make
      .times(scale)
      .times(outcomeScale)
      .times(new Money(1).minus(discount))
  else if (market.alignedQuote)
    make = make.times(new Money(1).minus(share).times('1.5').plus(share))
  if (market.alignedQuote)
    take = take.times(new Money(1).minus(share).times('0.8').plus(share))
  if (outcome) {
    make = Money.max(0, make)
    if (side === 'buy') return { taker: '0', maker: '0' }
  }
  if (take.abs().gt(1) || make.abs().gt(1))
    throw new Error('市场或账户费率无效')
  return { taker: take.toFixed(), maker: make.toFixed() }
}
