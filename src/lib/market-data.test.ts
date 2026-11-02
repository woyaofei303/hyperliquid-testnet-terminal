import assert from 'node:assert/strict'
import test from 'node:test'
import {
  type Candle,
  type MarketTrade,
  mergeCandles,
  mergeTrades,
} from './market-data.ts'

test('历史请求晚于推送返回时，同一根 K 线保留新的推送且不重复', () => {
  const c: Candle = {
    t: 1000,
    T: 2000,
    s: 'BTC',
    i: '1m',
    o: '100',
    h: '102',
    l: '99',
    c: '100',
    v: '1',
    n: 1,
  }
  const result = mergeCandles([c], [{ ...c, c: '101', n: 2 }])
  assert.equal(result.length, 1)
  assert.equal(result[0].c, '101')
})

const trade: MarketTrade = {
  coin: 'BTC',
  tid: 1,
  side: 'B',
  px: '100',
  sz: '1',
  time: 1000,
  hash: '0x00',
  users: ['0x11', '0x22'],
}
test('成交历史与实时数据按币对隔离、去重并倒序，晚到历史不覆盖推送', () => {
  const result = mergeTrades(
    'BTC',
    [trade, { ...trade, tid: 2, time: 2000 }],
    [
      { ...trade, tid: 2, time: 2000, sz: '2' },
      { ...trade, coin: 'ETH', tid: 3 },
    ],
  )
  assert.deepEqual(
    result.map((t) => [t.tid, t.sz]),
    [
      [2, '2'],
      [1, '1'],
    ],
  )
})
test('成交列表最多保留最新 100 笔，同毫秒按成交 ID 排序', () => {
  const result = mergeTrades(
    'BTC',
    [],
    Array.from({ length: 150 }, (_, tid) => ({ ...trade, tid })),
  )
  assert.equal(result.length, 100)
  assert.equal(result[0].tid, 149)
  assert.equal(result.at(-1)?.tid, 50)
})
test('无效价格、数量、时间和成交 ID 不进入公开成交列表', () => {
  assert.deepEqual(
    mergeTrades(
      'BTC',
      [],
      [
        { ...trade, px: 'NaN' },
        { ...trade, sz: '-1' },
        { ...trade, time: Infinity },
        { ...trade, time: 8640000000000001 },
        { ...trade, tid: -1 },
        { ...trade, tid: 1.1 },
      ],
    ),
    [],
  )
})
