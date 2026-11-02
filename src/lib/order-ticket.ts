import { isCash, quoteName } from './market-catalog.ts'
import {
  formatOrderPrice,
  type Market,
  Money,
  positiveDecimal,
  prepareOrder,
} from './orders.ts'

export const orderKinds = [
  ['limit', '限价单'],
  ['market', '市价单'],
  ['stop-market', '止损市价'],
  ['stop-limit', '止损限价'],
  ['take-market', '止盈市价'],
  ['take-limit', '止盈限价'],
  ['scale', '阶梯单'],
  ['twap', 'TWAP'],
  ['chase', '追价单'],
  ['trailing', '移动止损'],
] as const
export type OrderKind = (typeof orderKinds)[number][0]
export function supportedOrderKinds(market: Pick<Market, 'kind'>) {
  return orderKinds.filter(([kind]) => {
    if (market.kind === 'outcome')
      return ['limit', 'market', 'scale'].includes(kind)
    if (market.kind === 'spot')
      return ['limit', 'market', 'scale', 'twap', 'chase'].includes(kind)
    return true
  })
}
export type WireOrder = Omit<ReturnType<typeof prepareOrder>, 't'> & {
  t:
    | ReturnType<typeof prepareOrder>['t']
    | { trigger: { isMarket: boolean; triggerPx: string; tpsl: 'tp' | 'sl' } }
}
export type TimeInForce = 'Gtc' | 'Ioc' | 'Alo'
export interface TicketInput {
  market: Market
  side: 'buy' | 'sell'
  kind: OrderKind
  price: string
  mark: string
  size: string
  reduceOnly: boolean
  slippageBps: number
  tif: TimeInForce
  trigger: string
  takeProfit: string
  stopLoss: string
  upperPrice: string
  levels: string
  distribution: 'equal' | 'increasing' | 'decreasing'
  minutes: string
  randomize: boolean
  twapTrigger: string
  twapAbove: boolean
  twapLimit: string
  retracement: string
  retracementUnit: 'pct' | 'px'
  activationPrice: string
}
export type TwapAction = {
  type: 'twapOrder'
  twap: { a: number; b: boolean; s: string; r: boolean; m: number; t: boolean }
  details?: { t: { p: string; a: boolean } | null; s: string | null }
}
export type TrailingAction = {
  type: 'trailingStop'
  asset: number
  isBuy: boolean
  sz: string
  reduceOnly: boolean
  retracement: { pct: string } | { px: string }
  activationPx: string | null
}
export type Ticket = {
  label: string
  market: Market
  size: string
  orderKind: OrderKind | 'positionTpsl'
} & (
  | {
      kind: 'orders'
      orders: WireOrder[]
      grouping: 'na' | 'normalTpsl' | 'positionTpsl'
    }
  | { kind: 'twap'; action: TwapAction; referencePrice: string }
  | { kind: 'trailing'; action: TrailingAction }
  | { kind: 'chase'; order: ReturnType<typeof prepareOrder> }
)
function validPrice(value: string, market: Market, label: string) {
  const price = positiveDecimal(value, label).toFixed()
  if (formatOrderPrice(price, market) !== price)
    throw new Error(`${label}不符合市场价格精度`)
  if (market.kind === 'outcome' && new Money(price).gte(1))
    throw new Error(`${label}必须小于 1`)
  return price
}
function triggerOrder(
  input: Pick<
    TicketInput,
    | 'market'
    | 'side'
    | 'mark'
    | 'price'
    | 'size'
    | 'reduceOnly'
    | 'slippageBps'
    | 'tif'
  >,
  tpsl: 'tp' | 'sl',
  triggerPx: string,
  isMarket: boolean,
): WireOrder {
  const trigger = validPrice(triggerPx, input.market, '触发价')
  const above = (input.side === 'buy') === (tpsl === 'sl')
  if (
    above
      ? new Money(trigger).lte(input.mark)
      : new Money(trigger).gte(input.mark)
  )
    throw new Error(`触发价必须${above ? '高于' : '低于'}当前标记价`)
  const order = prepareOrder({
    ...input,
    kind: isMarket ? 'market' : 'limit',
    price: isMarket ? trigger : input.price,
  })
  return { ...order, t: { trigger: { isMarket, triggerPx: trigger, tpsl } } }
}
export function prepareTicket(input: TicketInput): Ticket {
  if (!supportedOrderKinds(input.market).some(([key]) => key === input.kind))
    throw new Error('当前产品不支持该订单类型')
  if (
    isCash(input.market) &&
    (input.reduceOnly || input.takeProfit || input.stopLoss)
  )
    throw new Error('现货和预测不支持只减仓或附带 TP/SL')
  const mark = positiveDecimal(input.mark, '标记价')
  const size = positiveDecimal(input.size, '数量')
  if (!['Gtc', 'Ioc', 'Alo'].includes(input.tif))
    throw new Error('订单有效方式无效')
  const label = orderKinds.find(([key]) => key === input.kind)?.[1]
  if (!label) throw new Error('未知订单类型')
  const base = {
    label,
    market: input.market,
    size: size.toFixed(),
    orderKind: input.kind,
  }
  const basic = (kind: 'market' | 'limit', price = input.price) =>
    prepareOrder({ ...input, kind, price })
  if (input.kind === 'twap') {
    basic('market', input.mark)
    const minutes = Number(input.minutes)
    if (!Number.isInteger(minutes) || minutes < 5 || minutes > 10080)
      throw new Error('TWAP 时长为 5 至 10080 分钟（7 天）的整数')
    if (size.times(mark).lt(100))
      throw new Error(`TWAP 总金额至少 100 ${quoteName(input.market)}`)
    if (input.twapLimit) {
      const boundary = positiveDecimal(
        validPrice(input.twapLimit, input.market, 'TWAP 价格边界'),
        'TWAP 价格边界',
      )
      const reference = input.twapTrigger
        ? positiveDecimal(input.twapTrigger, 'TWAP 触发价')
        : mark
      if (
        input.side === 'buy' ? boundary.lte(reference) : boundary.gte(reference)
      )
        throw new Error(
          `TWAP ${input.side === 'buy' ? '最高价须高于' : '最低价须低于'}${input.twapTrigger ? '触发价' : '标记价'}`,
        )
    }
    return {
      ...base,
      kind: 'twap',
      referencePrice: mark.toFixed(),
      action: {
        type: 'twapOrder',
        twap: {
          a: input.market.asset,
          b: input.side === 'buy',
          s: size.toFixed(),
          r: input.reduceOnly,
          m: minutes,
          t: input.randomize,
        },
        ...(input.twapTrigger || input.twapLimit
          ? {
              details: {
                t: input.twapTrigger
                  ? {
                      p: validPrice(
                        input.twapTrigger,
                        input.market,
                        'TWAP 触发价',
                      ),
                      a: input.twapAbove,
                    }
                  : null,
                s: input.twapLimit
                  ? validPrice(input.twapLimit, input.market, 'TWAP 价格边界')
                  : null,
              },
            }
          : {}),
      },
    }
  }
  if (input.kind === 'trailing') {
    basic('market', input.mark)
    const distance = positiveDecimal(input.retracement, '回撤距离')
    if (input.retracementUnit === 'pct' && distance.decimalPlaces() > 4)
      throw new Error('回撤百分比最多 4 位小数')
    if (
      input.activationPrice &&
      (input.side === 'buy'
        ? positiveDecimal(input.activationPrice, '激活价格').gte(mark)
        : positiveDecimal(input.activationPrice, '激活价格').lte(mark))
    )
      throw new Error(
        `激活价格须${input.side === 'buy' ? '低于' : '高于'}当前标记价`,
      )
    if (input.retracementUnit === 'pct' && distance.gte(100))
      throw new Error('回撤百分比必须小于 100%')
    if (input.retracementUnit === 'px' && distance.gte(mark))
      throw new Error('回撤价差必须小于标记价')
    return {
      ...base,
      kind: 'trailing',
      action: {
        type: 'trailingStop',
        asset: input.market.asset,
        isBuy: input.side === 'buy',
        sz: size.toFixed(),
        reduceOnly: input.reduceOnly,
        retracement:
          input.retracementUnit === 'pct'
            ? { pct: `${distance.toFixed()}%` }
            : { px: validPrice(input.retracement, input.market, '回撤价差') },
        activationPx: input.activationPrice
          ? validPrice(input.activationPrice, input.market, '激活价格')
          : null,
      },
    }
  }
  if (input.kind === 'chase')
    return {
      ...base,
      kind: 'chase',
      order: { ...basic('limit'), t: { limit: { tif: 'Alo' } } },
    }
  let orders: WireOrder[]
  if (input.kind === 'scale') {
    const low = positiveDecimal(
      validPrice(input.price, input.market, '最低价'),
      '最低价',
    )
    const high = positiveDecimal(
      validPrice(input.upperPrice, input.market, '最高价'),
      '最高价',
    )
    const levels = Number(input.levels)
    if (!Number.isInteger(levels) || levels < 2 || levels > 50)
      throw new Error('阶梯档数为 2 至 50 的整数')
    if (high.lte(low)) throw new Error('最高价必须高于最低价')
    if (size.decimalPlaces() > input.market.szDecimals)
      throw new Error('数量精度超过市场允许的小数位')
    const weights = Array.from({ length: levels }, (_, index) =>
      input.distribution === 'equal'
        ? 1
        : input.distribution === 'increasing'
          ? index + 1
          : levels - index,
    )
    const totalWeight = weights.reduce((sum, weight) => sum + weight, 0)
    let assigned = new Money(0)
    orders = weights.map((weight, index) => {
      const amount =
        index === levels - 1
          ? size.minus(assigned)
          : size
              .times(weight)
              .div(totalWeight)
              .toDecimalPlaces(input.market.szDecimals, Money.ROUND_DOWN)
      assigned = assigned.plus(amount)
      const price = formatOrderPrice(
        low
          .plus(
            high
              .minus(low)
              .times(index)
              .div(levels - 1),
          )
          .toFixed(),
        input.market,
      )
      return prepareOrder({
        ...input,
        kind: 'limit',
        price,
        size: amount.toFixed(),
      })
    })
    if (new Set(orders.map((order) => order.p)).size !== levels)
      throw new Error('价格区间过窄，多档价格舍入后重复')
  } else if (input.kind.startsWith('stop-') || input.kind.startsWith('take-')) {
    orders = [
      triggerOrder(
        input,
        input.kind.startsWith('stop-') ? 'sl' : 'tp',
        input.trigger,
        input.kind.endsWith('-market'),
      ),
    ]
  } else orders = [basic(input.kind === 'market' ? 'market' : 'limit')]
  let grouping: 'na' | 'normalTpsl' = 'na'
  if (
    (input.kind === 'limit' || input.kind === 'market') &&
    (input.takeProfit || input.stopLoss)
  ) {
    if (input.reduceOnly)
      throw new Error('只减仓订单不附带反向 TP/SL，请直接使用止盈或止损订单')
    const opposite = {
      ...input,
      side: input.side === 'buy' ? ('sell' as const) : ('buy' as const),
      reduceOnly: true,
      slippageBps: 1000,
    }
    if (input.takeProfit)
      orders.push(triggerOrder(opposite, 'tp', input.takeProfit, true))
    if (input.stopLoss)
      orders.push(triggerOrder(opposite, 'sl', input.stopLoss, true))
    grouping = 'normalTpsl'
  }
  return { ...base, kind: 'orders', orders, grouping }
}

export function chasePrice(
  bid: string,
  ask: string,
  isBuy: boolean,
  cap: string,
  market: Pick<Market, 'kind' | 'szDecimals'>,
) {
  if (positiveDecimal(bid, '买价').gte(positiveDecimal(ask, '卖价')))
    throw new Error('盘口交叉，暂停追价')
  const best = positiveDecimal(isBuy ? bid : ask, '最优价格')
  const other = positiveDecimal(isBuy ? ask : bid, '对手价')
  const decimals = Math.max(
    0,
    Math.min((market.kind === 'spot' ? 8 : 6) - market.szDecimals, 4 - best.e),
  )
  const tick = new Money(10).pow(-decimals)
  let price = isBuy
    ? Money.min(best.plus(tick), other.minus(tick))
    : Money.max(best.minus(tick), other.plus(tick))
  price = isBuy ? Money.min(price, cap) : Money.max(price, cap)
  return formatOrderPrice(price.toFixed(), market)
}

export function preparePositionProtection(
  market: Market,
  mark: string,
  position: string,
  takeProfit: string,
  stopLoss: string,
): Ticket {
  const signed = new Money(position)
  if (!signed.isFinite() || signed.isZero())
    throw new Error('当前没有可保护的仓位')
  if (!takeProfit && !stopLoss) throw new Error('请至少填写止盈价或止损价')
  const input = {
    market,
    mark,
    side: signed.gt(0) ? ('sell' as const) : ('buy' as const),
    price: mark,
    size: signed.abs().toFixed(),
    reduceOnly: true,
    slippageBps: 1000,
    tif: 'Ioc' as const,
  }
  const orders = []
  if (takeProfit) orders.push(triggerOrder(input, 'tp', takeProfit, true))
  if (stopLoss) orders.push(triggerOrder(input, 'sl', stopLoss, true))
  return {
    label: '仓位止盈 / 止损',
    orderKind: 'positionTpsl',
    market,
    size: input.size,
    kind: 'orders',
    grouping: 'positionTpsl',
    orders,
  }
}
