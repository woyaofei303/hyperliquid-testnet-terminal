import assert from 'node:assert/strict'
import test from 'node:test'
import { orderBookData } from './order-book-data.ts'

test('盘口先排序再从最优价累加，买卖价差使用最优报价和中间价', () => {
  const row = (px: string, sz: string) => ({ px, sz, n: 1 })
  const data = orderBookData({
    coin: 'BTC',
    time: 1,
    levels: [
      [row('98', '0.2'), row('99', '0.1')],
      [row('102', '0.2'), row('101', '0.1')],
    ],
  })
  assert.deepEqual(
    data.bids.map((r) => [r.px, r.total]),
    [
      ['99', '0.1'],
      ['98', '0.3'],
    ],
  )
  assert.deepEqual(
    data.asks.map((r) => [r.px, r.total]),
    [
      ['101', '0.1'],
      ['102', '0.3'],
    ],
  )
  assert.equal(data.spread, '2')
  assert.equal(data.percent, '2.000')
  assert.equal(orderBookData(null).spread, null)
})

test('悬浮累计数量与金额从最优价累加，平均价按数量加权', () => {
  const data = orderBookData({
    coin: 'BTC',
    time: 1,
    levels: [
      [{ px: '99', sz: '0.1', n: 1 }],
      [
        { px: '101', sz: '0.1', n: 1 },
        { px: '102', sz: '0.2', n: 1 },
      ],
    ],
  })
  assert.equal(data.midpoint, '100')
  assert.equal(data.asks[1].totalQuote, '30.5')
  assert.equal(Number(data.asks[1].average).toFixed(4), '101.6667')
})
