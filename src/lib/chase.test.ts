import assert from 'node:assert/strict'
import test from 'node:test'
import { chaseQuote, chaseRemainder } from './chase.ts'

const order = {
  a: 0,
  b: true,
  p: '105',
  s: '1',
  r: false,
  t: { limit: { tif: 'Alo' as const } },
}
test('追价遵守价格界限、不追逐自身、拒绝过期/交叉盘口', () => {
  const book = {
    coin: 'BTC',
    time: Date.now(),
    levels: [
      [{ px: '100', sz: '1', n: 1 }],
      [{ px: '102', sz: '1', n: 1 }],
    ] as [
      { px: string; sz: string; n: number }[],
      { px: string; sz: string; n: number }[],
    ],
  }
  assert.equal(chaseQuote(book, order, { szDecimals: 5 }), '100.1')
  assert.equal(chaseQuote(book, order, { szDecimals: 5 }, '100'), '100')
  assert.equal(chaseQuote(book, { ...order, p: '99' }, { szDecimals: 5 }), '99')
  assert.throws(
    () => chaseQuote({ ...book, time: 0 }, order, { szDecimals: 5 }),
    /过期/,
  )
  assert.throws(
    () =>
      chaseQuote({ ...book, levels: [book.levels[1], book.levels[0]] }, order, {
        szDecimals: 5,
      }),
    /交叉/,
  )
})
test('先确认取消后的最终剩余量，不能把成交数量补回或重发未知订单', () => {
  assert.equal(chaseRemainder('1', '0.6', 'canceled'), '0.6')
  assert.equal(chaseRemainder('1', '0', 'filled'), '0')
  assert.throws(() => chaseRemainder('1', '1.1', 'canceled'), /异常/)
  assert.throws(() => chaseRemainder('1', '0.6', 'open'), /核对/)
})
