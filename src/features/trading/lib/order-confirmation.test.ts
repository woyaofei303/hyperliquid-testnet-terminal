import assert from 'node:assert/strict'
import test from 'node:test'
import { orderConfirmation } from './order-confirmation.ts'
import { defaultOrderFields } from './order-form-fields.ts'
import {
  preparePositionProtection,
  prepareTicket,
  type TicketInput,
} from './order-ticket.ts'

const market = {
  name: 'BTC',
  asset: 3,
  szDecimals: 5,
  maxLeverage: 40,
  context: { markPx: '70000', prevDayPx: '69000', dayNtlVlm: '1000000' },
}
const input: TicketInput = {
  ...defaultOrderFields(market),
  market,
  mark: '70000',
  size: '0.00192',
  slippageBps: 50,
}
const account = '0x1111111111111111111111111111111111111111'
function confirmation(patch: Partial<TicketInput> = {}) {
  const ticket = prepareTicket({ ...input, ...patch })
  return orderConfirmation({
    kind: 'ticket',
    account,
    coin: ticket.market.name,
    at: Date.now(),
    ticket,
  })
}

test('市价显示市价；限价 IOC 保留具体价格，不把有效方式当订单类型', () => {
  assert.equal(confirmation({ kind: 'market' }).price, '市价')
  assert.equal(
    confirmation({ kind: 'limit', tif: 'Ioc', price: '65000' }).price,
    '65,000 USDC',
  )
  assert.equal(confirmation().quantity, '0.00192 BTC')
})

test('合约开仓和平仓按钮准确表达四种方向', () => {
  for (const [side, reduceOnly, operation, buttonLabel] of [
    ['buy', false, '多头', '买入 / 做多'],
    ['sell', false, '空头', '卖出 / 做空'],
    ['buy', true, '平空', '买入 / 平空'],
    ['sell', true, '平多', '卖出 / 平多'],
  ] as const) {
    const result = confirmation({ side, reduceOnly })
    assert.equal(result.operation, operation)
    assert.equal(result.buttonLabel, buttonLabel)
  }
})

test('现货和预测显示买卖资产或份额，不使用开空与强平语义', () => {
  const spot = confirmation({
    market: {
      ...market,
      kind: 'spot',
      name: '@7',
      base: 'HYPE',
      maxLeverage: 1,
    },
    size: '2',
    price: '20',
    side: 'sell',
  })
  assert.equal(spot.buttonLabel, '卖出')
  assert.equal(spot.quantity, '2 HYPE')
  assert.equal(spot.cash, true)
  const outcome = confirmation({
    market: {
      ...market,
      kind: 'outcome',
      name: '#120',
      base: 'Yes',
      szDecimals: 0,
      maxLeverage: 1,
    },
    size: '100',
    price: '0.5',
  })
  assert.equal(outcome.buttonLabel, '买入')
  assert.equal(outcome.quantity, '100 份')
  assert.equal(outcome.cash, true)
})

test('高级订单保持方向；仓位保护单明确为保护操作，不显示反向开仓', () => {
  for (const kind of ['twap', 'chase', 'trailing'] as const) {
    const result = confirmation({ kind, size: '0.03', side: 'sell' })
    assert.equal(result.buttonLabel, '卖出 / 做空')
    assert.equal(result.basic, false)
  }
  const ticket = preparePositionProtection(
    market,
    '70000',
    '0.00192',
    '72000',
    '68000',
  )
  const result = orderConfirmation({
    kind: 'ticket',
    account,
    coin: 'BTC',
    at: Date.now(),
    ticket,
  })
  assert.equal(result.buttonLabel, '确认止盈 / 止损')
  assert.equal(result.operation, '止盈 / 止损')
  assert.equal(result.reduceOnly, true)
})
