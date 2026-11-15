import assert from 'node:assert/strict'
import test from 'node:test'
import { buildSummaries } from './candidates.ts'
import { parseQuote } from './mainnet-read.ts'
import { createStudy, updateStudy } from './study.ts'
import { compareStudies } from './study-comparison.ts'

function batch(start: number, accounts: number, exit: string) {
  const book = (time: number, bid: string, ask: string) =>
    parseQuote(
      {
        coin: 'BTC',
        time,
        levels: [[{ px: bid, sz: '1' }], [{ px: ask, sz: '1' }]],
      },
      time,
    )
  let study = updateStudy(
    createStudy(start, 1),
    [],
    { BTC: book(start + 6000, '59999', '60000') },
    start + 6000,
    true,
  )
  const summaries = Array.from(
    { length: accounts },
    (_, i) =>
      buildSummaries({
        address: `0x${String(i + 1).repeat(40)}`,
        startTime: start,
        checkedAt: start + 16000,
        positions: { BTC: '2', ETH: '0', SOL: '0' },
        fills: [
          {
            coin: 'BTC',
            side: 'B',
            time: start + 15000,
            startPosition: '0',
            sz: '2',
            px: '60000',
            oid: 1,
            tid: 1,
            dir: 'Open Long',
            hash: '0x0',
          },
        ],
      })[0],
  )
  study = updateStudy(
    study,
    summaries,
    { BTC: book(start + 16000, '59999', '60000') },
    start + 16000,
    true,
  )
  study = updateStudy(
    study,
    [],
    { BTC: book(start + 66000, '60600', '60601') },
    start + 66000,
    true,
  )
  study = updateStudy(
    study,
    [],
    { BTC: book(start + 76000, exit, String(Number(exit) + 1)) },
    start + 76000,
    true,
  )
  return updateStudy(study, [], {}, study.endsAt, false)
}

test('按批次等权汇总配对差值，不让信号多的一批主导；无对照组明确计入未配对', () => {
  const result = compareStudies([
    { id: 'a', study: batch(1_000_000, 2, '61800') },
    { id: 'b', study: batch(3_000_000, 1, '60000') },
  ])
  const row = result.groups.find(
    (row) =>
      row.coin === 'BTC' &&
      row.side === 'long' &&
      row.minutes === 1 &&
      row.costBps === 10,
  )
  assert.ok(row)
  assert.equal(row.pairedBatches, 2)
  assert.equal(row.meanDifference, '0.5')
  assert.equal(row.signalNetPercent, '1.4')
  assert.equal(row.controlNetPercent, '0.9')
  assert.equal(row.positiveDifferenceBatches, 1)
  assert.equal(row.signalMeasured, 3)
  const missing = result.groups.find(
    (row) =>
      row.coin === 'ETH' &&
      row.side === 'long' &&
      row.minutes === 1 &&
      row.costBps === 10,
  )
  assert.equal(missing?.pairedBatches, 0)
  assert.equal(missing?.unpairedBatches, 2)
  assert.equal(missing?.meanDifference, null)
  assert.equal(result.recurringAccountCoins, 1)
})

test('拒绝重复或时间重叠的批次，空结果不制造均值', () => {
  const study = batch(1_000_000, 1, '60000')
  assert.throws(
    () =>
      compareStudies([
        { id: 'a', study },
        { id: 'a', study },
      ]),
    /重复/,
  )
  assert.throws(
    () =>
      compareStudies([
        { id: 'a', study },
        { id: 'b', study },
      ]),
    /重叠/,
  )
  const empty = compareStudies([])
  assert.equal(empty.completedBatches, 0)
  assert.ok(empty.groups.every((row) => row.meanDifference === null))
})
