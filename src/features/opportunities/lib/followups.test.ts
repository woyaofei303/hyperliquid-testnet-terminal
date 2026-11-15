import assert from 'node:assert/strict'
import test from 'node:test'
import { buildSummaries } from './candidates.ts'
import { summarizeFollowups, updateFollowups } from './followups.ts'
import { parseQuote } from './mainnet-read.ts'

const now = 1_000_000
const summary = (side: 'long' | 'short' = 'long') =>
  buildSummaries({
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
const quote = (time = now, bid = '59999', ask = '60000') =>
  parseQuote(
    {
      coin: 'BTC',
      time,
      levels: [[{ px: bid, sz: '1' }], [{ px: ask, sz: '2' }]],
    },
    time,
  )

test('没有新候选或到期结果时保持记录不变，避免每秒重写本机存档', () => {
  const records = updateFollowups([], [summary()], { BTC: quote() }, now, true)
  assert.equal(
    updateFollowups(
      records,
      [summary()],
      { BTC: quote(now + 1000) },
      now + 1000,
      true,
    ),
    records,
  )
})

test('首次出现固定入场报价；退出候选后仍记录 1、5、15 分钟表现且不覆盖结果', () => {
  const s = summary()
  let records = updateFollowups([], [s], { BTC: quote() }, now, true)
  assert.equal(records.length, 1)
  assert.equal(records[0].entry.available && records[0].entry.price, '60000')
  records = updateFollowups(
    records,
    [s],
    { BTC: quote(now + 1000, '60099', '60100') },
    now + 1000,
    true,
  )
  assert.equal(records.length, 1)
  assert.equal(records[0].detectedAt, now)
  for (const minutes of [1, 5, 15]) {
    const time = now + minutes * 60_000
    records = updateFollowups(
      records,
      [],
      { BTC: quote(time, '60600', '60601') },
      time,
      true,
    )
    const point = records[0].points.find((p) => p.minutes === minutes)
    assert.equal(point?.status, 'measured')
    if (point?.status === 'measured') {
      assert.equal(point.percent, '1')
      assert.equal(point.quote.bid?.px, '60600')
    }
  }
  const measured = records[0]
  records = updateFollowups(
    records,
    [],
    { BTC: quote(now + 901000, '1', '2') },
    now + 901000,
    true,
  )
  assert.deepEqual(records[0], measured)
})

test('空头以起点买一和到点卖一比较，价差含买卖价差、不使用大户历史成本', () => {
  const s = summary('short')
  let records = updateFollowups(
    [],
    [s],
    { BTC: quote(now, '61000', '61001') },
    now,
    true,
  )
  records = updateFollowups(
    records,
    [],
    { BTC: quote(now + 60000, '60389', '60390') },
    now + 60000,
    true,
  )
  const point = records[0].points[0]
  assert.equal(point.status, 'measured')
  if (point.status === 'measured') assert.equal(point.percent, '1')
})

test('到点前的盘口不能冒充到点价格，错过 10 秒采样窗口后永久缺测', () => {
  const first = updateFollowups([], [summary()], { BTC: quote() }, now, true)
  const due = now + 60000
  for (const book of [
    quote(due - 1),
    { ...quote(due), receivedAt: due - 1 },
    { ...quote(due), time: due + 10001 },
    { ...quote(due), coin: 'ETH' as const },
    { ...quote(due), bid: null },
  ]) {
    const pending = updateFollowups(first, [], { BTC: book }, due, true)
    assert.equal(pending[0].points[0].status, 'pending')
  }
  const missed = updateFollowups(
    first,
    [],
    { BTC: quote(due + 10001) },
    due + 10001,
    true,
  )
  assert.equal(missed[0].points[0].status, 'missing')
  assert.equal(missed[0].points[1].status, 'pending')
  const late = updateFollowups(
    missed,
    [],
    { BTC: quote(due + 11000) },
    due + 11000,
    true,
  )
  assert.deepEqual(late[0].points[0], missed[0].points[0])
  const disconnected = updateFollowups(
    first,
    [],
    { BTC: quote(due) },
    due,
    false,
  )
  assert.equal(disconnected[0].points[0].status, 'pending')
})

test('起点没有有效报价也留下缺测记录，不在后来价格有利时补建起点；总样本上限 100', () => {
  const s = summary()
  const records = updateFollowups([], [s], {}, now, true)
  assert.equal(records[0].entry.available, false)
  assert.ok(records[0].points.every((p) => p.status === 'missing'))
  const later = updateFollowups(
    records,
    [s],
    { BTC: quote(now + 1000) },
    now + 1000,
    true,
  )
  assert.equal(later.length, 1)
  assert.equal(later[0].entry.available, false)
  const capped = updateFollowups(
    [],
    Array.from({ length: 101 }, (_, i) => ({ ...s, id: `sample:${i}` })),
    { BTC: quote() },
    now,
    true,
  )
  assert.equal(capped.length, 100)
  assert.equal(
    updateFollowups(
      [],
      [{ ...s, hasReduction: true }],
      { BTC: quote() },
      now,
      true,
    ).length,
    0,
  )
})

test('统计分开计算有效、待采样和缺测；缺测不当作零涨跌或从总样本里删除', () => {
  const s = summary()
  let records = updateFollowups([], [s], { BTC: quote() }, now, true)
  records = updateFollowups(
    records,
    [],
    { BTC: quote(now + 60000, '60600', '60601') },
    now + 60000,
    true,
  )
  records = updateFollowups(
    records,
    [{ ...s, id: 'missing' }],
    {},
    now + 60000,
    true,
  )
  const stats = summarizeFollowups(records)
  assert.deepEqual(stats[0], {
    minutes: 1,
    total: 2,
    measured: 1,
    missing: 1,
    pending: 0,
    positive: 1,
    averagePercent: '1',
  })
  assert.equal(stats[1].pending, 1)
  assert.equal(stats[1].averagePercent, null)
})
