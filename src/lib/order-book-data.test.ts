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

test('切换盘口价格步长按买向下卖向上合并，保留真实累计金额与价差', () => {
  const data = orderBookData(
    {
      coin: 'BTC',
      time: 1,
      levels: [
        [
          { px: '99.9', sz: '0.1', n: 1 },
          { px: '99.1', sz: '0.2', n: 2 },
          { px: '98.8', sz: '0.3', n: 1 },
        ],
        [
          { px: '100.1', sz: '0.1', n: 1 },
          { px: '100.9', sz: '0.2', n: 1 },
          { px: '101.1', sz: '0.3', n: 1 },
        ],
      ],
    },
    '1',
  )
  assert.deepEqual(
    data.bids.map((r) => [r.px, r.sz, r.n]),
    [
      ['99', '0.3', 3],
      ['98', '0.3', 1],
    ],
  )
  assert.deepEqual(
    data.asks.map((r) => [r.px, r.sz]),
    [
      ['101', '0.3'],
      ['102', '0.3'],
    ],
  )
  assert.equal(data.bids[0].totalQuote, '29.81')
  assert.equal(data.asks[1].totalQuote, '60.52')
  assert.equal(data.asks[1].total, '0.6')
  assert.equal(data.spread, '0.2')
  assert.equal(data.midpoint, '100')
})

test('小数步长使用十进制计算并拒绝无效精度', () => {
  const data = orderBookData(
    {
      coin: 'SMALL',
      time: 1,
      levels: [
        [
          { px: '0.00001234', sz: '3', n: 1 },
          { px: '0.00001231', sz: '2', n: 1 },
        ],
        [{ px: '0.00001236', sz: '1', n: 1 }],
      ],
    },
    '0.0000001',
  )
  assert.equal(data.bids[0].px, '0.0000123')
  assert.equal(data.bids[0].sz, '5')
  assert.equal(data.asks[0].px, '0.0000124')
  for (const step of ['0', '-1', 'NaN', 'Infinity', 'bad']) {
    assert.throws(() => orderBookData(null, step))
  }
})
