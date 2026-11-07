import assert from 'node:assert/strict'
import test from 'node:test'
import {
  depthAtDistance,
  depthChartScale,
  depthStepPath,
} from './depth-chart.ts'
import { orderBookData } from './order-book-data.ts'

const depth = orderBookData({
  coin: 'BTC',
  time: 1,
  levels: [
    [
      { px: '99', sz: '2', n: 1 },
      { px: '97', sz: '3', n: 1 },
    ],
    [
      { px: '101', sz: '4', n: 1 },
      { px: '104', sz: '6', n: 1 },
    ],
  ],
})

test('深度图围绕中间价等距展示两侧，使用同一累计数量刻度', () => {
  assert.deepEqual(depthChartScale(depth, 1), {
    midpoint: 100,
    radius: 4,
    maxTotal: 11,
  })
  const x = (price: number) => price - 96
  const y = (total: number) => 10 - total
  assert.deepEqual(depthStepPath(depth.bids, x, y, 10), {
    line: 'M 3 10 H 3 V 8 H 1 V 5',
    area: 'M 3 10 H 3 V 8 H 1 V 5 V 10 Z',
  })
  assert.equal(
    depthStepPath(depth.asks, x, y, 10).line,
    'M 5 10 H 5 V 6 H 8 V 0',
  )
})

test('悬停只累计指定价格以内的真实挂单，价差内没有档位', () => {
  assert.equal(depthAtDistance(depth.bids, 100, 0.5), undefined)
  assert.equal(depthAtDistance(depth.bids, 100, 2)?.total, '2')
  assert.equal(depthAtDistance(depth.bids, 100, 3)?.total, '5')
  assert.equal(depthAtDistance(depth.asks, 100, 3)?.total, '4')
  assert.equal(depthAtDistance(depth.asks, 100, 4)?.total, '10')
  assert.equal(depthAtDistance([], 100, 4), undefined)
})

test('空盘口不生成坐标；单边单档和低价资产仍有非零价格范围', () => {
  assert.equal(depthChartScale(orderBookData(null), 5), null)
  assert.deepEqual(depthStepPath([], Number, Number, 10), {
    line: '',
    area: '',
  })
  for (const levels of [
    [[{ px: '0.00001', sz: '0.1', n: 1 }], []],
    [[], [{ px: '0.00001', sz: '0.1', n: 1 }]],
  ] as const) {
    const data = orderBookData({
      coin: 'TEST',
      time: 1,
      levels: [[...levels[0]], [...levels[1]]],
    })
    const scale = depthChartScale(data, 6)
    assert.equal(scale?.midpoint, 0.00001)
    assert.equal(scale?.radius, 0.000001)
    assert.ok(scale && scale.maxTotal > 0)
  }
})
