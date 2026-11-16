import assert from 'node:assert/strict'
import test from 'node:test'
import { defaultOrderFields } from './order-form-fields.ts'
import {
  amountFromPercent,
  maximumOrderSize,
  sizeFromAmount,
  validateOrderCapacity,
} from './order-sizing.ts'
import {
  preparePositionProtection,
  prepareTicket,
  type TicketInput,
} from './order-ticket.ts'

test('现货数量与报价金额往返不丢最小数量，比例金额保留完整乘积', () => {
  const amount = amountFromPercent('123.45', 100, 'usdc', '0.12345', 2)
  assert.equal(amount, '15.2399025')
  assert.equal(sizeFromAmount(amount, 'usdc', '0.12345', 2), '123.45')
})

test('比例换算按最新额度和价格计算，数量向下取整且金额不超预算', () => {
  assert.equal(amountFromPercent('0.5', 50, 'base', '140000', 5), '0.25')
  assert.equal(
    amountFromPercent('0.5', 50, 'usdc', '140000', 5),
    '35000.000000',
  )
  assert.equal(amountFromPercent('24.7326', 50, 'base', '40', 4), '12.3663')
  assert.equal(amountFromPercent('95', 50, 'base', '0.51', 0), '47')
  assert.equal(
    amountFromPercent('0.000019', 100, 'base', '70000', 5),
    '0.00001',
  )
  assert.equal(amountFromPercent('1', 0, 'base', '70000', 5), '0')
  for (const percent of [-1, 101, Number.NaN, Infinity])
    assert.throws(() => amountFromPercent('1', percent, 'base', '70000', 5))
  assert.throws(() => amountFromPercent('-1', 50, 'base', '70000', 5))
  assert.throws(() => amountFromPercent('1', 50, 'usdc', '0', 5))
})

test('USDC 转数量只向下取整，不增加预算；只减仓最大值取反向仓位', () => {
  assert.equal(sizeFromAmount('100', 'usdc', '70000', 5), '0.00142')
  assert.equal(sizeFromAmount('0.001234', 'base', '70000', 5), '0.001234')
  const input = {
    maxTradeSize: '1',
    position: '0.25',
    side: 'sell' as const,
    reduceOnly: true,
    markPrice: '70000',
    orderPrice: '71000',
    precision: 5,
  }
  assert.equal(maximumOrderSize(input), '0.25')
  assert.equal(maximumOrderSize({ ...input, side: 'buy' }), '0')
  assert.equal(maximumOrderSize({ ...input, reduceOnly: false }), '0.98591')
})

const capacityMarket = { name: 'BTC', asset: 3, szDecimals: 5, maxLeverage: 40 }
function capacityAction(patch: Partial<TicketInput> = {}) {
  const ticket = prepareTicket({
    ...defaultOrderFields({
      ...capacityMarket,
      context: { markPx: '100', prevDayPx: '100', dayNtlVlm: '1000' },
    }),
    market: capacityMarket,
    kind: 'limit',
    mark: '100',
    price: '100',
    size: '1',
    slippageBps: 800,
    ...patch,
  })
  return {
    kind: 'ticket' as const,
    account: '0x1111111111111111111111111111111111111111' as const,
    coin: 'BTC',
    at: Date.now(),
    ticket,
  }
}

test('确认额度按当前方向与限价核对，市价不把滑点上限当成交预算', () => {
  const limits = { maxTradeSzs: ['1', '0.5'], markPx: '100' }
  assert.doesNotThrow(() =>
    validateOrderCapacity(capacityAction(), limits, '0'),
  )
  assert.throws(
    () => validateOrderCapacity(capacityAction({ side: 'sell' }), limits, '0'),
    /下单额度已变化/,
  )
  assert.throws(
    () => validateOrderCapacity(capacityAction({ price: '200' }), limits, '0'),
    /下单额度已变化/,
  )
  assert.doesNotThrow(() =>
    validateOrderCapacity(capacityAction({ kind: 'market' }), limits, '0'),
  )
  for (const max of ['NaN', '-1'])
    assert.throws(
      () =>
        validateOrderCapacity(
          capacityAction(),
          { ...limits, maxTradeSzs: [max, '1'] },
          '0',
        ),
      /账户最大可下数量无效/,
    )
})

test('阶梯单合并整批占用，附带 TP/SL 不重复占用开仓额度', () => {
  const limits = { maxTradeSzs: ['1', '1'], markPx: '100' }
  const scale = capacityAction({
    kind: 'scale',
    price: '100',
    upperPrice: '200',
    levels: '2',
    size: '1.2',
    unit: 'base',
  })
  assert.throws(
    () => validateOrderCapacity(scale, limits, '0'),
    /下单额度已变化/,
  )
  const crossingScale = capacityAction({
    kind: 'scale',
    price: '50',
    upperPrice: '150',
    levels: '2',
    size: '1',
    unit: 'base',
  })
  assert.doesNotThrow(() => validateOrderCapacity(crossingScale, limits, '0'))
  const protectedOrder = capacityAction({ takeProfit: '120', stopLoss: '80' })
  assert.doesNotThrow(() => validateOrderCapacity(protectedOrder, limits, '0'))
})

test('只减仓确认重查方向与剩余仓位，整仓 TP/SL 不把两条保护数量相加', () => {
  const limits = { maxTradeSzs: ['0', '0'], markPx: '100' }
  const close = capacityAction({ side: 'sell', reduceOnly: true, size: '0.5' })
  assert.doesNotThrow(() => validateOrderCapacity(close, limits, '0.5'))
  for (const position of ['0.2', '0', '-1'])
    assert.throws(
      () => validateOrderCapacity(close, limits, position),
      /可平仓位已变化/,
    )
  for (const size of [undefined, '0.5']) {
    const action = {
      ...close,
      ticket: preparePositionProtection(
        capacityMarket,
        '100',
        '0.5',
        '120',
        '80',
        { size },
      ),
    }
    assert.doesNotThrow(() => validateOrderCapacity(action, limits, '0.5'))
  }
})
