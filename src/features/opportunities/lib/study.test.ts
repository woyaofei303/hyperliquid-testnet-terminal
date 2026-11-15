import assert from 'node:assert/strict'
import test from 'node:test'
import { buildSummaries } from './candidates.ts'
import { parseQuote } from './mainnet-read.ts'
import { createStudy, summarizeStudy, updateStudy } from './study.ts'

const start = 1_000_000
const book = (time: number, bid = '59999', ask = '60000') =>
  parseQuote(
    {
      coin: 'BTC',
      time,
      levels: [[{ px: bid, sz: '1' }], [{ px: ask, sz: '1' }]],
    },
    time,
  )

test('对照时点在开批时固定；只取窗口内真实报价，错过的起点永久缺测', () => {
  let study = createStudy(start, 6)
  assert.equal(study.controls.length, 12)
  assert.deepEqual(
    [...new Set(study.controls.map((row) => row.scheduledAt))],
    [start + 5000, start + 305000],
  )
  study = updateStudy(
    study,
    [],
    { BTC: book(start + 4999) },
    start + 5000,
    true,
  )
  assert.equal(study.controls[0].entry, null)
  study = updateStudy(
    study,
    [],
    { BTC: book(start + 6000) },
    start + 6000,
    true,
  )
  assert.equal(
    study.controls[0].entry?.available && study.controls[0].entry.price,
    '60000',
  )
  assert.equal(
    study.controls[1].entry?.available && study.controls[1].entry.price,
    '59999',
  )
  assert.equal(study.controls[0].detectedAt, start + 6000)
  study = updateStudy(study, [], {}, start + 16000, false)
  assert.ok(
    study.controls
      .slice(2, 6)
      .every((row) => row.points.every((point) => point.status === 'missing')),
  )
  const missed = study.controls[2]
  study = updateStudy(study, [], {}, start + 17000, true)
  assert.deepEqual(study.controls[2], missed)
  assert.throws(() => createStudy(start, 0))
  assert.throws(() => createStudy(start, Number.NaN))
})

const candidate = (time: number) =>
  buildSummaries({
    address: `0x${'a'.repeat(40)}`,
    startTime: time - 10000,
    checkedAt: time,
    positions: { BTC: '2', ETH: '0', SOL: '0' },
    fills: [
      {
        coin: 'BTC',
        side: 'B',
        time: time - 1000,
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

test('批次截止后只完成旧样本；同一账户币种仅入组一次，不让重开和滑动窗口重复加权', () => {
  const first = start + 6000
  const summary = candidate(first)
  let study = updateStudy(
    createStudy(start, 1),
    [summary],
    { BTC: book(first) },
    first,
    true,
  )
  study = updateStudy(
    study,
    [{ ...summary, id: 'reopened' }],
    { BTC: book(first + 1000) },
    first + 1000,
    true,
  )
  assert.equal(study.signals.length, 1)
  study = updateStudy(
    study,
    [{ ...summary, id: 'late', address: `0x${'b'.repeat(40)}` }],
    { BTC: book(first + 60000, '60600', '60601') },
    first + 60000,
    true,
  )
  assert.equal(study.signals.length, 1)
  assert.equal(study.signals[0].points[0].status, 'measured')
  assert.equal(study.controls[0].points[0].status, 'measured')
  assert.equal(study.endsAt, start + 16 * 60000 + 20000)
})

test('只比较同币种同方向；成本按起点金额扣除，缺测留在分母而非记零', () => {
  const first = start + 6000
  let study = updateStudy(
    createStudy(start, 1),
    [candidate(first)],
    { BTC: book(first) },
    first,
    true,
  )
  study = updateStudy(
    study,
    [],
    { BTC: book(first + 60000, '60600', '60601') },
    first + 60000,
    true,
  )
  const rows = summarizeStudy(study)
  const row = rows.find(
    (row) => row.coin === 'BTC' && row.side === 'long' && row.minutes === 1,
  )
  assert.ok(row)
  assert.equal(row.signal.averagePercent, '1')
  assert.equal(row.control.averagePercent, '1')
  assert.equal(row.costs[1].roundTripBps, 10)
  assert.equal(row.costs[1].signalNetPercent, '0.9')
  assert.equal(row.costs[1].controlNetPercent, '0.9')
  assert.equal(row.costs[1].difference, '0')
  assert.equal(
    rows.find(
      (row) => row.coin === 'BTC' && row.side === 'short' && row.minutes === 1,
    )?.signal.averagePercent,
    null,
  )
  const missing = rows.find(
    (row) => row.coin === 'ETH' && row.side === 'long' && row.minutes === 1,
  )
  assert.equal(missing?.control.total, 1)
  assert.equal(missing?.control.missing, 1)
  assert.equal(missing?.control.averagePercent, null)
  assert.equal(missing?.costs[0].difference, null)
})
