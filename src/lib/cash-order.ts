import { type AccountSnapshot, info } from './hyperliquid.ts'
import { isCash } from './market-catalog.ts'
import { prepareTicket, type Ticket, type TicketInput } from './order-ticket.ts'
import {
  type Market,
  Money,
  type OrderInput,
  positiveDecimal,
  prepareOrder,
} from './orders.ts'

export function availableBalance(
  balances: AccountSnapshot['spot']['balances'],
  coin: string,
  token?: number,
) {
  const row = balances.find((item) =>
    token == null
      ? item.coin === coin
      : 'token' in item && item.token === token,
  )
  if (!row) return '0'
  const total = new Money(row.total),
    hold = new Money(row.hold)
  if (!total.isFinite() || !hold.isFinite() || hold.lt(0))
    throw new Error('余额数据无效')
  return Money.max(0, total.minus(hold)).toFixed()
}
export function cashBalances(
  market: Market,
  balances: AccountSnapshot['spot']['balances'],
) {
  return {
    base: availableBalance(
      balances,
      market.balanceCoin ?? market.base ?? market.name,
      market.baseToken,
    ),
    quote: availableBalance(
      balances,
      market.quote ?? 'USDC',
      market.quoteToken,
    ),
  }
}
export function prepareCashOrder(
  input: OrderInput,
  balances: { base: string; quote: string },
  feeRate: string,
) {
  if (!isCash(input.market)) throw new Error('此下单区只支持现货或预测')
  const order = prepareOrder(input)
  const fee = new Money(feeRate)
  if (!fee.isFinite() || fee.lt(0) || fee.gt(1)) throw new Error('手续费率无效')
  const cost = new Money(order.s).times(order.p).times(fee.plus(1))
  if (
    input.side === 'sell' &&
    positiveDecimal(order.s, '数量').gt(balances.base)
  )
    throw new Error('卖出数量超过可用持有量')
  if (input.side === 'buy' && cost.gt(balances.quote))
    throw new Error('可用余额不足以支付订单和预估手续费')
  return order
}

export async function loadCashFunds(market: Market, user: `0x${string}`) {
  const [state, fees] = await Promise.all([
    info.spotClearinghouseState({ user }),
    info.userFees({ user }),
  ])
  return {
    balances: cashBalances(market, state.balances),
    feeRate: Money.max(
      0,
      fees.userSpotCrossRate,
      fees.userSpotAddRate,
    ).toFixed(),
  }
}

export function cashTicketValue(ticket: Ticket) {
  if (ticket.kind === 'orders')
    return ticket.orders.reduce(
      (sum, order) => sum.plus(new Money(order.s).times(order.p)),
      new Money(0),
    )
  if (ticket.kind === 'chase')
    return new Money(ticket.order.s).times(ticket.order.p)
  if (ticket.kind === 'twap')
    return new Money(ticket.size).times(
      ticket.action.details?.s ??
        Money.max(
          ticket.referencePrice,
          ticket.action.details?.t?.p ?? 0,
        ).times(ticket.action.twap.b ? '1.03' : '0.97'),
    )
  throw new Error('现货和预测不支持移动止损')
}

export function validateCashTicketFunds(
  ticket: Ticket,
  balances: { base: string; quote: string },
  feeRate: string,
) {
  if (!isCash(ticket.market)) throw new Error('此下单区只支持现货或预测')
  const fee = new Money(feeRate)
  if (!fee.isFinite() || fee.lt(0) || fee.gt(1)) throw new Error('手续费率无效')
  for (const amount of [balances.base, balances.quote])
    if (!new Money(amount).isFinite() || new Money(amount).lt(0))
      throw new Error('可用余额无效')
  if (ticket.kind === 'trailing') throw new Error('现货和预测不支持移动止损')
  const buy =
    ticket.kind === 'orders'
      ? ticket.orders[0]?.b
      : ticket.kind === 'twap'
        ? ticket.action.twap.b
        : ticket.order.b
  const size =
    ticket.kind === 'orders'
      ? ticket.orders.reduce((sum, order) => sum.plus(order.s), new Money(0))
      : positiveDecimal(ticket.size, '数量')
  if (!buy && size.gt(balances.base)) throw new Error('卖出数量超过可用持有量')
  if (buy && cashTicketValue(ticket).times(fee.plus(1)).gt(balances.quote))
    throw new Error('可用余额不足以支付整笔订单和预估手续费')
}

export function prepareCashTicket(
  input: TicketInput,
  balances: { base: string; quote: string },
  feeRate: string,
) {
  const ticket = prepareTicket(input)
  validateCashTicketFunds(ticket, balances, feeRate)
  return ticket
}
