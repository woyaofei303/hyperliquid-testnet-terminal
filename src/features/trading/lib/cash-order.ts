import {
  type AccountSnapshot,
  info,
} from '../../../shared/lib/fameex-testnet.ts'
import { isCash } from '../../market/lib/market-catalog.ts'
import { marketFees } from './market-fees.ts'
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
  if (!total.isFinite() || !hold.isFinite()) throw new Error('余额数据无效')
  // 组合保证金可借额度已由交易所计入 hold，允许为负，不能再次累加 LTV。
  return Money.max(0, total.minus(hold)).toFixed()
}
export function cashBalances(
  market: Market,
  balances: AccountSnapshot['spot']['balances'],
  borrowReserves?: AccountSnapshot['borrowReserves'],
) {
  const available = {
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
  if (market.kind === 'spot' && borrowReserves) {
    const base = balances.find(
      (row) => 'token' in row && row.token === market.baseToken,
    )
    const quote = balances.find(
      (row) => 'token' in row && row.token === market.quoteToken,
    )
    const basePrice = borrowReserves.find(
      ([token]) => token === market.baseToken,
    )?.[1].oraclePx
    const quotePrice = borrowReserves.find(
      ([token]) => token === market.quoteToken,
    )?.[1].oraclePx
    if (
      base &&
      'supplied' in base &&
      base.supplied != null &&
      quote &&
      'borrowed' in quote &&
      quote.borrowed != null &&
      basePrice &&
      quotePrice
    ) {
      const supplied = new Money(base.supplied),
        borrowed = new Money(quote.borrowed)
      if ([supplied, borrowed].some((v) => !v.isFinite() || v.lt(0)))
        throw new Error('借贷余额数据无效')
      // 官方偿债卖出上限含 2% 价格缓冲；仅释放已有供应资产，不新增基础币借款。
      const repay = borrowed
        .times(positiveDecimal(quotePrice, '借款预言机价格'))
        .div(positiveDecimal(basePrice, '抵押品预言机价格'))
        .times('1.02')
      available.base = Money.max(
        available.base,
        Money.min(repay, supplied),
      ).toFixed()
    }
  }
  return available
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
  // 现货买入手续费扣所得基础币，卖出手续费扣所得报价币。
  const cost = new Money(order.s).times(order.p)
  if (
    input.side === 'sell' &&
    positiveDecimal(order.s, '数量').gt(balances.base)
  )
    throw new Error('卖出数量超过可用持有量')
  if (input.side === 'buy' && cost.gt(balances.quote))
    throw new Error('可用余额不足以支付订单')
  return order
}

export async function loadCashFunds(market: Market, user: `0x${string}`) {
  const [state, fees, mode] = await Promise.all([
    info.spotClearinghouseState({ user }),
    info.userFees({ user }),
    info.userAbstraction({ user }),
  ])
  const reserves =
    mode === 'portfolioMargin'
      ? await info.allBorrowLendReserveStates()
      : undefined
  return {
    balances: cashBalances(market, state.balances, reserves),
    feeRate:
      market.kind === 'outcome'
        ? '0'
        : Money.max(
            0,
            ...Object.values(marketFees(market, fees, 'buy')),
          ).toFixed(),
  }
}

export function cashTwapPrice(
  mark: string,
  buy: boolean,
  trigger?: string | null,
  limit?: string | null,
) {
  return limit
    ? positiveDecimal(limit, 'TWAP 价格边界')
    : Money.max(
        positiveDecimal(mark, '标记价'),
        trigger ? positiveDecimal(trigger, 'TWAP 触发价') : 0,
      ).times(buy ? '1.03' : '0.97')
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
      cashTwapPrice(
        ticket.referencePrice,
        ticket.action.twap.b,
        ticket.action.details?.t?.p,
        ticket.action.details?.s,
      ),
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
  if (buy && cashTicketValue(ticket).gt(balances.quote))
    throw new Error('可用余额不足以支付整笔订单')
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
