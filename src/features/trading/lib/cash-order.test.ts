import assert from 'node:assert/strict'
import test from 'node:test'
import { cashBalances, prepareCashTicket } from './cash-order.ts'
import { defaultOrderFields } from './order-form-fields.ts'
import { sizeFromAmount } from './order-sizing.ts'
import {
  chasePrice,
  prepareTicket,
  supportedOrderKinds,
} from './order-ticket.ts'
import { Money, marketOrderPrice } from './orders.ts'

const market = {
  name: '@7',
  kind: 'spot' as const,
  asset: 10007,
  szDecimals: 5,
  maxLeverage: 1,
  base: 'HYPE',
  quote: 'USDC',
  context: { markPx: '0.123', prevDayPx: '0.12', dayNtlVlm: '100' },
}
const input = {
  ...defaultOrderFields(market),
  market,
  mark: '0.123',
  size: '600',
  slippageBps: 50,
  upperPrice: '0.127',
  levels: '3',
  kind: 'scale' as const,
}
const balances = { base: '600', quote: '100' }

test('组合保证金使用接口给出的负占用额度，额度回落后确认必须拒绝超额订单', () => {
  const rows = [
    { coin: 'USDC', token: 0, total: '0', hold: '-100', entryNtl: '0' },
  ]
  const funds = cashBalances(market, rows)
  assert.equal(funds.quote, '100')
  assert.doesNotThrow(() => prepareCashTicket(input, funds, '0.001'))
  assert.throws(
    () =>
      prepareCashTicket(
        input,
        cashBalances(market, [{ ...rows[0], hold: '-50' }]),
        '0.001',
      ),
    /余额/,
  )
  assert.throws(
    () => cashBalances(market, [{ ...rows[0], hold: 'NaN' }]),
    /余额/,
  )
})

test('组合保证金卖出抵押品偿债采用借款币与基础币预言机，最多释放已供应数量', () => {
  const selected = { ...market, baseToken: 1105, quoteToken: 0 }
  const rows = [
    {
      coin: 'HYPE',
      token: 1105,
      total: '10',
      hold: '9',
      supplied: '8',
      entryNtl: '0',
    },
    {
      coin: 'USDC',
      token: 0,
      total: '0',
      hold: '0',
      borrowed: '100',
      entryNtl: '0',
    },
  ]
  const reserve = {
    oraclePx: '1',
    borrowYearlyRate: '0.05',
    supplyYearlyRate: '0',
    balance: '100',
    utilization: '0',
    ltv: '0',
    totalSupplied: '100',
    totalBorrowed: '0',
  }
  const reserves: NonNullable<Parameters<typeof cashBalances>[2]> = [
    [1105, { ...reserve, oraclePx: '20' }],
    [0, reserve],
  ]
  assert.throws(
    () =>
      cashBalances(
        selected,
        [{ ...rows[0], supplied: '-1' }, rows[1]],
        reserves,
      ),
    /借贷余额/,
  )
  assert.throws(
    () =>
      cashBalances(selected, rows, [
        [1105, { ...reserve, oraclePx: 'NaN' }],
        [0, reserve],
      ]),
    /预言机/,
  )
  assert.equal(cashBalances(selected, rows, []).base, '1')
  assert.equal(cashBalances(selected, rows).base, '1')
  assert.equal(cashBalances(selected, rows, reserves).base, '5.1')
  assert.equal(
    cashBalances(selected, [{ ...rows[0], supplied: '3' }, rows[1]], reserves)
      .base,
    '3',
  )
  assert.equal(
    cashBalances({ ...selected, kind: 'outcome' }, rows, reserves).base,
    '1',
  )
})

test('现货和预测市价按报价币金额买入，滑点内最差成交也不超预算', () => {
  for (const selected of [
    market,
    { ...market, kind: 'outcome' as const, asset: 100000120, szDecimals: 0 },
  ]) {
    const price = selected.kind === 'outcome' ? '0.51' : '20'
    const protectedPrice = marketOrderPrice(price, selected, 'buy', 800)
    const size = sizeFromAmount(
      '100',
      'usdc',
      protectedPrice,
      selected.szDecimals,
    )
    const ticket = prepareCashTicket(
      {
        ...input,
        market: selected,
        kind: 'market',
        price,
        size,
        slippageBps: 800,
      },
      { base: '0', quote: '100' },
      '0.001',
    )
    if (ticket.kind !== 'orders') throw Error('类型错误')
    assert.ok(new Money(ticket.orders[0].p).times(ticket.size).lte(100))
    assert.equal(ticket.orders[0].p, protectedPrice)
  }
})

test('产品能力：现货仅阶梯/TWAP/追价，预测仅阶梯，不冒用合约条件单', () => {
  assert.deepEqual(
    supportedOrderKinds(market).map(([k]) => k),
    ['limit', 'market', 'chase', 'scale', 'twap'],
  )
  assert.deepEqual(
    supportedOrderKinds({ kind: 'outcome' }).map(([k]) => k),
    ['limit', 'market', 'scale'],
  )
  assert.throws(
    () => prepareTicket({ ...input, kind: 'stop-market' }),
    /不支持/,
  )
  assert.throws(() => prepareTicket({ ...input, kind: 'trailing' }), /不支持/)
  assert.throws(
    () =>
      prepareTicket({
        ...input,
        market: { ...market, kind: 'outcome', szDecimals: 0 },
        kind: 'twap',
      }),
    /不支持/,
  )
  assert.throws(() => prepareTicket({ ...input, takeProfit: '0.15' }), /附带/)
})
test('现货阶梯使用现货价格精度，买入手续费从所得基础币扣除，不额外占报价币', () => {
  const ticket = prepareCashTicket(input, balances, '0.001')
  if (ticket.kind !== 'orders') throw Error('类型错误')
  assert.deepEqual(
    ticket.orders.map((o) => o.p),
    ['0.123', '0.125', '0.127'],
  )
  assert.equal(
    ticket.orders.reduce((sum, o) => sum.plus(o.s), new Money(0)).toFixed(),
    '600',
  )
  assert.equal(
    prepareCashTicket(input, { ...balances, quote: '75' }, '0.001').kind,
    'orders',
  )
  assert.throws(
    () => prepareCashTicket(input, { ...balances, quote: '74.99' }, '0.001'),
    /余额/,
  )
  assert.throws(
    () =>
      prepareCashTicket(
        { ...input, side: 'sell' },
        { ...balances, base: '599' },
        '0.001',
      ),
    /持有量/,
  )
  assert.throws(() => prepareCashTicket(input, balances, 'NaN'), /手续费/)
})
test('现货 TWAP 检查最高价格预算，无价格边界时预留当前价的 3% 滑点', () => {
  const twap = {
    ...input,
    kind: 'twap' as const,
    price: '20',
    mark: '20',
    size: '5',
    twapLimit: '22',
  }
  assert.equal(
    prepareCashTicket(twap, { base: '8', quote: '111' }, '0.001').kind,
    'twap',
  )
  assert.throws(
    () => prepareCashTicket(twap, { base: '8', quote: '109.99' }, '0.001'),
    /余额/,
  )
  assert.throws(
    () =>
      prepareCashTicket(
        { ...twap, twapLimit: '' },
        { base: '8', quote: '102' },
        '0',
      ),
    /余额/,
  )
  assert.throws(
    () =>
      prepareCashTicket(
        { ...twap, side: 'sell', twapLimit: '' },
        { base: '4', quote: '200' },
        '0',
      ),
    /持有量/,
  )
})
test('预测阶梯每档至少 1 USDC、整数数量和五位报价，不允许卖出超持有份额', () => {
  const prediction = {
    ...input,
    market: {
      ...market,
      name: '#120',
      asset: 100000120,
      kind: 'outcome' as const,
      szDecimals: 0,
    },
    mark: '0.5',
    price: '0.33333',
    upperPrice: '0.77777',
    size: '12',
  }
  const ticket = prepareCashTicket(prediction, { base: '12', quote: '20' }, '0')
  if (ticket.kind !== 'orders') throw Error('类型错误')
  assert.deepEqual(
    ticket.orders.map((o) => o.p),
    ['0.33333', '0.55555', '0.77777'],
  )
  assert.deepEqual(
    ticket.orders.map((o) => o.s),
    ['4', '4', '4'],
  )
  assert.throws(
    () => prepareCashTicket({ ...prediction, size: '6' }, balances, '0'),
    /至少 1/,
  )
  assert.throws(
    () => prepareCashTicket({ ...prediction, upperPrice: '1' }, balances, '0'),
    /小于 1/,
  )
  assert.throws(
    () =>
      prepareCashTicket(
        { ...prediction, side: 'sell' },
        { base: '11', quote: '20' },
        '0',
      ),
    /持有量/,
  )
})
test('现货追价使用现货 tick 并检查最高买入价预算', () => {
  assert.equal(chasePrice('0.123', '0.127', true, '0.13', market), '0.124')
  assert.equal(chasePrice('0.123', '0.124', true, '0.13', market), '0.123')
  assert.throws(
    () =>
      prepareCashTicket(
        { ...input, kind: 'chase', price: '0.13' },
        { base: '1000', quote: '77' },
        '0',
      ),
    /余额/,
  )
})
