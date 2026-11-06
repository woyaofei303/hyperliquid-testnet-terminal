import type { OrderFormFields } from './order-form-fields.ts'
import { prepareTicket, type Ticket, type TicketInput } from './order-ticket.ts'
import {
  formatOrderPrice,
  type Market,
  Money,
  positiveDecimal,
  prepareOrder,
} from './orders.ts'

export function predictionFees(
  market: Market,
  fees: {
    userSpotCrossRate: string
    userSpotAddRate: string
    activeReferralDiscount?: string
  },
  side: 'buy' | 'sell',
) {
  const scale = new Money(market.feeScale ?? 1)
  const deployer = new Money(market.deployerFeeScale ?? 0)
  const discount = new Money(fees.activeReferralDiscount ?? 0)
  if (
    [scale, deployer, discount].some((v) => !v.isFinite() || v.lt(0)) ||
    discount.gt(1)
  )
    throw new Error('预测市场费率无效')
  const multiplier = scale
    .times(deployer.lt(1) ? deployer.plus(1) : deployer.times(2))
    .times(new Money(1).minus(discount))
  const rate = (value: string) => {
    const raw = new Money(value)
    if (!raw.isFinite() || raw.abs().gt(1)) throw new Error('账户费率无效')
    const result = Money.max(0, raw).times(multiplier)
    if (result.gt(1)) throw new Error('预测市场费率无效')
    return side === 'buy' ? '0' : result.toFixed()
  }
  return {
    taker: rate(fees.userSpotCrossRate),
    maker: rate(fees.userSpotAddRate),
  }
}

export function predictionScale(
  input: Pick<OrderFormFields, 'price' | 'upperPrice' | 'levels' | 'sizeSkew'>,
  market: Market,
) {
  const start = positiveDecimal(input.price, '开始价格')
  const end = positiveDecimal(input.upperPrice, '结束价格')
  for (const p of [start, end]) {
    if (p.gte(1)) throw new Error('预测价格必须小于 1')
    if (p.decimalPlaces() > 5) throw new Error('预测价格最多 5 位小数')
  }
  if (start.eq(end)) throw new Error('开始价格和结束价格不能相同')
  const count = Number(input.levels)
  if (!Number.isInteger(count) || count < 2 || count > 50)
    throw new Error('总订单数为 2 至 50 的整数')
  const skew = positiveDecimal(input.sizeSkew, '数量偏差')
  const legs = Array.from({ length: count }, (_, i) => ({
    price: formatOrderPrice(
      start
        .plus(
          end
            .minus(start)
            .times(i)
            .div(count - 1),
        )
        .toFixed(),
      market,
    ),
    weight: new Money(1).plus(
      skew
        .minus(1)
        .times(i)
        .div(count - 1),
    ),
  }))
  if (new Set(legs.map((leg) => leg.price)).size !== count)
    throw new Error('价格区间过窄，多档价格舍入后重复')
  const weight = legs.reduce((sum, leg) => sum.plus(leg.weight), new Money(0))
  const cost = legs.reduce(
    (sum, leg) => sum.plus(leg.weight.times(leg.price)),
    new Money(0),
  )
  return { legs, weight, cost, average: cost.div(weight).toFixed() }
}

export function preparePredictionTicket(
  input: TicketInput & Pick<OrderFormFields, 'unit' | 'amount' | 'sizeSkew'>,
): Ticket {
  if (input.market.kind !== 'outcome') throw new Error('请选择预测市场')
  if (input.kind !== 'scale') return prepareTicket(input)
  if (input.reduceOnly || input.takeProfit || input.stopLoss)
    throw new Error('预测不支持只减仓或附带 TP/SL')
  const scale = predictionScale(input, input.market)
  const amount = positiveDecimal(input.amount, '数量')
  if (input.unit === 'base' && !amount.isInteger())
    throw new Error('预测合约数量必须为整数')
  let assigned = new Money(0)
  const orders = scale.legs.map((leg, index) => {
    // USDC 输入逐单向下取整，避免尾单补足份额后超过用户输入的金额。
    const size =
      input.unit === 'usdc'
        ? amount.times(leg.weight).div(scale.cost).floor()
        : index === scale.legs.length - 1
          ? amount.minus(assigned)
          : amount.times(leg.weight).div(scale.weight).floor()
    assigned = assigned.plus(size)
    return prepareOrder({
      ...input,
      kind: 'limit',
      price: leg.price,
      size: size.toFixed(),
    })
  })
  return {
    kind: 'orders',
    label: '分段订单',
    orderKind: 'scale',
    market: input.market,
    size: assigned.toFixed(),
    orders,
    grouping: 'na',
  }
}

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
