import assert from 'node:assert/strict'
import test from 'node:test'
import { readArchive } from './archive.ts'
import { buildSummaries } from './candidates.ts'
import { updateFollowups } from './followups.ts'
import { parseQuote } from './mainnet-read.ts'

const now = 1_000_000
const summary = buildSummaries({
  address: `0x${'a'.repeat(40)}`,
  startTime: now - 10000,
  checkedAt: now,
  positions: { BTC: '2', ETH: '0', SOL: '0' },
  fills: [
    {
      coin: 'BTC',
      side: 'B',
      time: now - 1000,
      startPosition: '0',
      sz: '2',
      px: '60000',
      oid: 1,
      tid: 1,
      dir: 'Open Long',
      hash: '0x0',
    },
  ],
})[0]
const quote = (time = now, bid = '59999', ask = '60000') =>
  parseQuote(
    {
      coin: 'BTC',
      time,
      levels: [[{ px: bid, sz: '1' }], [{ px: ask, sz: '1' }]],
    },
    time,
  )

test('本机存档恢复固定起点、已测结果和冷却期限，离线错过的点标缺测', () => {
  let followups = updateFollowups([], [summary], { BTC: quote() }, now, true)
  followups = updateFollowups(
    followups,
    [],
    { BTC: quote(now + 60000, '60600', '60601') },
    now + 60000,
    true,
  )
  const stored = JSON.stringify({
    version: 1,
    followups,
    cooldownUntil: now + 600000,
  })
  const restored = readArchive(stored, now + 400000)
  assert.equal(restored.cooldownUntil, now + 600000)
  assert.deepEqual(restored.followups[0].entry, followups[0].entry)
  assert.deepEqual(restored.followups[0].points[0], followups[0].points[0])
  assert.equal(restored.followups[0].points[1].status, 'missing')
  assert.equal(restored.followups[0].points[2].status, 'pending')
  assert.deepEqual(readArchive(null, now), { followups: [], cooldownUntil: 0 })
})

test('损坏、重复、超量、错币种和伪造价格的存档一律拒绝，不返回部分记录', () => {
  let followups = updateFollowups([], [summary], { BTC: quote() }, now, true)
  followups = updateFollowups(
    followups,
    [],
    { BTC: quote(now + 60000, '60600', '60601') },
    now + 60000,
    true,
  )
  const original = { version: 1, followups, cooldownUntil: 0 }
  const mutations = [
    (v: typeof original) => {
      v.version = 2
    },
    (v: typeof original) => {
      v.followups.push(v.followups[0])
    },
    (v: typeof original) => {
      v.followups = Array.from({ length: 101 }, () => v.followups[0])
    },
    (v: typeof original) => {
      v.followups[0].address = 'invalid'
    },
    (v: typeof original) => {
      v.followups[0].signal.recentSize = 'NaN'
    },
    (v: typeof original) => {
      v.followups[0].points[0].dueAt++
    },
    (v: typeof original) => {
      const p = v.followups[0].points[0]
      if (p.status === 'measured') p.percent = '99'
    },
    (v: typeof original) => {
      const p = v.followups[0].points[0]
      if (p.status === 'measured') p.quote.coin = 'ETH'
    },
    (v: typeof original) => {
      const p = v.followups[0].points[0]
      if (p.status === 'measured') p.sampledAt = p.dueAt + 10001
    },
    (v: typeof original) => {
      const e = v.followups[0].entry
      if (e.available) e.price = '1'
    },
  ]
  for (const mutate of mutations) {
    const value = structuredClone(original)
    mutate(value)
    assert.throws(
      () => readArchive(JSON.stringify(value), now + 400000),
      /存档/,
    )
  }
  assert.throws(() => readArchive('{broken', now), /存档/)
  assert.throws(() => readArchive(' '.repeat(2_000_001), now), /存档/)
  const missing = updateFollowups([], [summary], {}, now, true)
  assert.deepEqual(
    readArchive(
      JSON.stringify({ version: 1, followups: missing, cooldownUntil: 0 }),
      now,
    ).followups,
    missing,
  )
})

test('超出浏览器日期范围的冷却时间拒绝恢复，避免时间展示崩溃', () => {
  assert.throws(
    () =>
      readArchive(
        JSON.stringify({
          version: 1,
          followups: [],
          cooldownUntil: Number.MAX_SAFE_INTEGER,
        }),
        now,
      ),
    /存档/,
  )
})
