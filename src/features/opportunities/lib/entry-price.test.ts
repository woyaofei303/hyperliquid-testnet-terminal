import assert from 'node:assert/strict'
import test from 'node:test'
import { assessCandidate, buildSummaries } from './candidates.ts'
import { compareEntry } from './entry-price.ts'
import { parseQuote } from './mainnet-read.ts'

const now = 1_000_000
function summary(side: 'long' | 'short' = 'long') {
  return buildSummaries({
    address: `0x${'a'.repeat(40)}`,
    startTime: now - 10000,
    checkedAt: now,
    positions: { BTC: side === 'long' ? '2' : '-2', ETH: '0', SOL: '0' },
    fills: [
      {
        coin: 'BTC',
        side: side === 'long' ? 'B' : 'A',
        startPosition: '0',
        sz: '2',
        px: '60000',
        dir: side === 'long' ? 'Open Long' : 'Open Short',
        time: now - 1000,
        oid: 1,
        tid: 1,
        hash: '0x0',
      },
    ],
  })[0]
}
const quote = (bid = '59400', ask = '60600') =>
  parseQuote(
    {
      coin: 'BTC',
      time: now,
      levels: [[{ px: bid, sz: '0.1' }], [{ px: ask, sz: '0.2' }]],
    },
    now,
  )

test('同向价格比较：多头取卖一，空头取买一；正值统一表示价格较差', () => {
  for (const side of ['long', 'short'] as const) {
    const s = summary(side)
    const result = compareEntry(s, assessCandidate(s, now), quote(), now, true)
    assert.ok(result.available)
    assert.equal(result.adversePercent, '1')
    assert.equal(result.price, side === 'long' ? '60600' : '59400')
    assert.equal(result.size, side === 'long' ? '0.2' : '0.1')
  }
  const long = summary()
  const cheaper = compareEntry(
    long,
    assessCandidate(long, now),
    quote('59000', '59400'),
    now,
    true,
  )
  assert.ok(cheaper.available)
  assert.equal(cheaper.adversePercent, '-1')
})

test('断线、陈旧或早于成交的盘口、错币种和空侧不能提供价格比较', () => {
  const s = summary()
  const assessment = assessCandidate(s, now)
  const current = quote()
  for (const value of [
    undefined,
    { ...current, coin: 'ETH' as const },
    { ...current, time: now - 10001 },
    { ...current, receivedAt: now - 10001 },
    { ...current, time: now + 10001 },
    { ...current, time: now - 2000 },
    { ...current, ask: null },
  ]) {
    assert.equal(compareEntry(s, assessment, value, now, true).available, false)
  }
  assert.equal(
    compareEntry(s, assessment, current, now, false).available,
    false,
  )
  assert.equal(
    compareEntry(s, assessCandidate(s, now, true), current, now, true)
      .available,
    false,
  )
})

test('均价缺失及已退出持仓不展示报价差；价差不是行为候选的入选条件', () => {
  const s = summary()
  const assessment = assessCandidate(s, now)
  assert.equal(
    compareEntry(
      s,
      { ...assessment, averageEntryPrice: null },
      quote(),
      now,
      true,
    ).available,
    false,
  )
  assert.equal(
    compareEntry({ ...s, currentPosition: '0' }, assessment, quote(), now, true)
      .available,
    false,
  )
  const badPrice = compareEntry(
    s,
    assessment,
    quote('119999', '120000'),
    now,
    true,
  )
  assert.ok(badPrice.available)
  assert.equal(badPrice.adversePercent, '100')
  assert.equal(assessment.eligible, true)
})
