import { display } from './display.ts'
import { baseName, isCash, quoteName } from './market-catalog.ts'
import { type Market, Money } from './orders.ts'
import type { ConfirmationAction } from './trading.ts'

export function orderConfirmation(action: ConfirmationAction, market?: Market) {
  const ticket = action.kind === 'ticket' ? action.ticket : null
  const selected = ticket?.market ?? market
  const order =
    action.kind === 'order'
      ? action.order
      : ticket?.kind === 'orders'
        ? ticket.orders[0]
        : ticket?.kind === 'chase'
          ? ticket.order
          : null
  const buy =
    ticket?.kind === 'twap'
      ? ticket.action.twap.b
      : ticket?.kind === 'trailing'
        ? ticket.action.isBuy
        : (order?.b ?? false)
  const reduceOnly =
    ticket?.kind === 'twap'
      ? ticket.action.twap.r
      : ticket?.kind === 'trailing'
        ? ticket.action.reduceOnly
        : (order?.r ?? false)
  const cash = isCash(selected)
  const protection =
    ticket?.kind === 'orders' && ticket.grouping === 'positionTpsl'
  const orderKind =
    action.kind === 'order' ? action.orderKind : action.ticket.orderKind
  const basic =
    (orderKind === 'market' || orderKind === 'limit') &&
    (!ticket || (ticket.kind === 'orders' && ticket.orders.length === 1))
  const unit =
    selected?.kind === 'outcome'
      ? '份'
      : selected
        ? baseName(selected)
        : action.coin
  return {
    buy,
    cash,
    protection,
    reduceOnly,
    basic,
    title: basic
      ? reduceOnly
        ? '确认减仓 / 平仓'
        : '确认订单'
      : `确认${ticket?.label ?? '订单'}`,
    operation: protection
      ? '止盈 / 止损'
      : cash
        ? buy
          ? '买入'
          : '卖出'
        : reduceOnly
          ? buy
            ? '平空'
            : '平多'
          : buy
            ? '多头'
            : '空头',
    buttonLabel: protection
      ? '确认止盈 / 止损'
      : cash
        ? buy
          ? '买入'
          : '卖出'
        : buy
          ? reduceOnly
            ? '买入 / 平空'
            : '买入 / 做多'
          : reduceOnly
            ? '卖出 / 平多'
            : '卖出 / 做空',
    quantity: `${ticket?.size ?? order?.s} ${unit}`,
    // IOC 也可以是用户指定价格的限价单，不能用有效方式反推订单类型。
    price:
      orderKind === 'market'
        ? '市价'
        : orderKind === 'limit' && order
          ? `${display(order.p, new Money(order.p).decimalPlaces())} ${quoteName(selected)}`
          : null,
  }
}
