import assert from 'node:assert/strict'
import test from 'node:test'
import { parseQuote } from './mainnet-read.ts'
import { createStudy, updateStudy } from './study.ts'
import { readStudy } from './study-archive.ts'

function example() {
  let study = createStudy(1_000_000, 1)
  const at = study.startedAt + 6000
  const quote = (time: number, bid: string) =>
    parseQuote(
      {
        coin: 'BTC',
        time,
        levels: [
          [{ px: bid, sz: '1' }],
          [{ px: String(Number(bid) + 1), sz: '1' }],
        ],
      },
      time,
    )
  study = updateStudy(study, [], { BTC: quote(at, '59999') }, at, true)
  for (const minutes of [1, 5, 15])
    study = updateStudy(
      study,
      [],
      { BTC: quote(at + minutes * 60000, '60600') },
      at + minutes * 60000,
      true,
    )
  study = updateStudy(study, [], {}, study.endsAt, false)
  const protocol = {
    version: 1,
    method: 'opportunity-study-v1',
    network: 'hyperliquid-mainnet',
    readOnly: true,
    startedAt: study.startedAt,
    enrollmentEndsAt: study.enrollmentEndsAt,
    endsAt: study.endsAt,
    coins: ['BTC', 'ETH', 'SOL'],
    maxAccounts: 6,
    uniqueSignal: 'account+coin',
    controls: study.controls.map(({ coin, side, scheduledAt }) => ({
      coin,
      side,
      scheduledAt,
    })),
    horizonsMinutes: [1, 5, 15],
    extraRoundTripCostBps: [0, 10, 20],
  }
  const checkpoint = {
    status: 'complete',
    capturedAt: study.endsAt,
    study,
    summary: [{ fake: '999' }],
  }
  return { protocol, checkpoint }
}

test('汇总前从原始报价复核批次，不信任保存的统计；保留缺测对照', () => {
  const { protocol, checkpoint } = example()
  const parsed = readStudy(
    JSON.stringify(checkpoint),
    JSON.stringify(protocol),
    checkpoint.capturedAt,
  )
  assert.deepEqual(parsed.study, checkpoint.study)
  assert.equal(parsed.status, 'complete')
})

test('篡改收益、预设时点、费用、版本或伪造完成状态均拒绝统计', () => {
  for (const mutate of [
    (v: ReturnType<typeof example>) => {
      const p = v.checkpoint.study.controls[0].points[0]
      if (p.status === 'measured') p.percent = '99'
    },
    (v: ReturnType<typeof example>) => {
      v.protocol.controls[0].scheduledAt++
    },
    (v: ReturnType<typeof example>) => {
      v.protocol.extraRoundTripCostBps = [0, 1, 2]
    },
    (v: ReturnType<typeof example>) => {
      v.protocol.method = 'different'
    },
    (v: ReturnType<typeof example>) => {
      v.checkpoint.capturedAt = v.checkpoint.study.endsAt - 1
    },
    (v: ReturnType<typeof example>) => {
      v.checkpoint.study.controls[0].entry = { available: true, price: '1' }
    },
  ]) {
    const value = example()
    mutate(value)
    assert.throws(() =>
      readStudy(
        JSON.stringify(value.checkpoint),
        JSON.stringify(value.protocol),
        value.checkpoint.study.endsAt,
      ),
    )
  }
})
