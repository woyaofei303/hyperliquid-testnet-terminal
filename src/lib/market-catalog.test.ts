import assert from 'node:assert/strict'
import test from 'node:test'
import { availableBalance, prepareCashOrder } from './cash-order.ts'
import {
  builderMarkets,
  cashMarkets,
  predictionMarkets,
  pricePrecision,
} from './market-catalog.ts'
import { type Market, prepareOrder } from './orders.ts'

test('市场 ID 用交易对索引、DEX 索引和 outcome side 编码，展示名不参与 API 请求', () => {
  const spot = cashMarkets(
    JSON.parse(
      JSON.stringify([
        {
          universe: [
            { name: '@7', index: 7, tokens: [20, 0], isCanonical: true },
          ],
          tokens: [
            { name: 'HYPE', index: 20, szDecimals: 2 },
            { name: 'USDC', index: 0, szDecimals: 8 },
          ],
        },
        [{ coin: '@7', markPx: '20', prevDayPx: '19', dayNtlVlm: '50' }],
      ]),
    ),
  )
  assert.equal(spot[0].asset, 10007)
  assert.equal(spot[0].baseToken, 20)
  assert.equal(spot[0].name, '@7')
  const perps = builderMarkets(
    JSON.parse(
      '[{"universe":[]},{"universe":[{"name":"test:ABC","szDecimals":0,"maxLeverage":3}],"collateralToken":0}]',
    ),
    JSON.parse('[{"index":0,"name":"USDC"}]'),
  )
  assert.equal(perps[0].asset, 110000)
  const outcomes = predictionMarkets(
    JSON.parse(
      '{"outcomes":[{"outcome":12,"name":"template:price","description":"target:80000|feed:https://example.com","quoteToken":"USDC","sideSpecs":[{"name":"Yes"},{"name":"No"}]}]}',
    ),
    JSON.parse(
      '[{"id":"price","name":"BTC > {target}?","description":"Source: {feed}"}]',
    ),
  )
  assert.deepEqual(
    outcomes.map((m) => [m.name, m.asset, m.balanceCoin, m.paired]),
    [
      ['#120', 100000120, '+120', '#121'],
      ['#121', 100000121, '+121', '#120'],
    ],
  )
  assert.equal(outcomes[0].description, 'Source: https://example.com')
  assert.equal(outcomes[0].label, 'BTC > 80000? · Yes')
})
const spot: Market = {
  name: '@7',
  asset: 10007,
  kind: 'spot',
  szDecimals: 2,
  maxLeverage: 1,
  quote: 'USDC',
}
const input = {
  market: spot,
  side: 'buy' as const,
  kind: 'limit' as const,
  price: '20',
  size: '2',
  reduceOnly: false,
  slippageBps: 50,
}
test('现货数量/价格精度、冻结余额、买单手续费和卖单持仓都参与校验', () => {
  assert.equal(pricePrecision(spot), 6)
  assert.equal(
    availableBalance(
      [{ coin: 'HYPE', token: 20, total: '10', hold: '2', entryNtl: '200' }],
      'HYPE',
      20,
    ),
    '8',
  )
  assert.equal(
    prepareCashOrder(input, { base: '8', quote: '100' }, '0.001').a,
    10007,
  )
  assert.throws(
    () => prepareCashOrder(input, { base: '8', quote: '40' }, '0.001'),
    /手续费/,
  )
  assert.throws(
    () =>
      prepareCashOrder(
        { ...input, side: 'sell', size: '9' },
        { base: '8', quote: '100' },
        '0.001',
      ),
    /持有量/,
  )
  assert.throws(() => prepareOrder({ ...input, reduceOnly: true }), /只减仓/)
  assert.throws(() => prepareOrder({ ...input, size: '2.001' }), /数量精度/)
})
test('预测使用整数份额及 0 到 1 之间的五位报价，市价滑点不越界', () => {
  const market: Market = {
    ...spot,
    kind: 'outcome',
    name: '#120',
    asset: 100000120,
    szDecimals: 0,
  }
  const order = { ...input, market, price: '0.5', size: '100' }
  assert.equal(prepareOrder(order).a, 100000120)
  assert.throws(() => prepareOrder({ ...order, size: '100.1' }), /数量精度/)
  assert.throws(() => prepareOrder({ ...order, price: '1' }), /预测价格/)
  assert.throws(() => prepareOrder({ ...order, price: '0.123456' }), /价格/)
  assert.equal(
    prepareOrder({ ...order, kind: 'market', price: '0.99999' }).p,
    '0.99999',
  )
})
