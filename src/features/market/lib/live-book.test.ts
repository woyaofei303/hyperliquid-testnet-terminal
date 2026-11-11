import assert from 'node:assert/strict'
import test from 'node:test'
import type { Book } from '../../../shared/lib/hyperliquid.ts'
import { createLiveBook } from './live-book.ts'

const book = (time: number, count: number, price = 100): Book => ({
  coin: 'BTC',
  time,
  levels: [
    Array.from({ length: count }, (_, i) => ({
      px: String(price - i),
      sz: '1',
      n: 1,
    })),
    Array.from({ length: count }, (_, i) => ({
      px: String(price + 2 + i),
      sz: '1',
      n: 1,
    })),
  ],
})
test('fast best quotes replace old levels, retain deeper snapshot, and reject stale or other markets', () => {
  const feed = createLiveBook('BTC')
  feed.accept(book(1000, 20), false)
  const fast = feed.accept(book(1500, 5, 99), true)
  assert.equal(fast?.levels[0][0].px, '99')
  assert.equal(fast?.levels[0].length, 19)
  assert.ok(!fast?.levels[0].some((row) => row.px === '100'))
  assert.equal(feed.accept(book(1400, 5, 98), true), null)
  assert.equal(feed.accept({ ...book(2000, 5), coin: 'ETH' }, true), null)
  assert.equal(feed.accept(book(1200, 20), false)?.levels[0][0].px, '99')
  assert.equal(feed.accept(book(18000, 5), true)?.levels[0].length, 5)
})
test('empty fast side clears stale liquidity and full snapshots work before fast arrives', () => {
  const feed = createLiveBook('BTC')
  assert.equal(feed.accept(book(1000, 20), false)?.levels[0].length, 20)
  const empty = book(1500, 5)
  empty.levels[0] = []
  assert.deepEqual(feed.accept(empty, true)?.levels[0], [])
})
