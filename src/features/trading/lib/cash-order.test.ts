import assert from 'node:assert/strict'
import test from 'node:test'
import { prepareCashTicket } from './cash-order.ts'
import { defaultOrderFields } from './order-form-fields.ts'
import {
  chasePrice,
  prepareTicket,
  supportedOrderKinds,
} from './order-ticket.ts'
import { Money } from './orders.ts'

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

test('产品能力：现货仅阶梯/TWAP/追价，预测仅阶梯，不冒用合约条件单', () => {
  assert.deepEqual(
    supportedOrderKinds(market).map(([k]) => k),
    ['limit', 'market', 'scale', 'twap', 'chase'],
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
test('现货阶梯使用现货价格精度，按整批金额加手续费检查可用余额', () => {
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
  assert.throws(
    () => prepareCashTicket(input, { ...balances, quote: '75' }, '0.001'),
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
    () => prepareCashTicket(twap, { base: '8', quote: '110' }, '0.001'),
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
