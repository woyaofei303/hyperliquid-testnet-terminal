import assert from 'node:assert/strict'
import { HORIZONS } from './followups.ts'
import { COINS, decimal } from './opportunities.ts'
import { STUDY_COST_BPS, type Study, summarizeStudy } from './study.ts'

export function compareStudies(batches: { id: string; study: Study }[]) {
  assert.equal(
    new Set(batches.map((row) => row.id)).size,
    batches.length,
    '重复批次',
  )
  const sorted = [...batches].sort(
    (a, b) => a.study.startedAt - b.study.startedAt,
  )
  for (let i = 1; i < sorted.length; i++)
    assert.ok(
      sorted[i].study.startedAt >= sorted[i - 1].study.endsAt,
      '批次观察时间重叠',
    )
  const accountCoins = new Map<string, number>(),
    accounts = new Set<string>()
  for (const { study } of batches)
    for (const row of study.signals) {
      accounts.add(row.address)
      const key = `${row.address}:${row.coin}`
      accountCoins.set(key, (accountCoins.get(key) ?? 0) + 1)
    }
  const summaries = batches.map((row) => ({
    id: row.id,
    startedAt: row.study.startedAt,
    rows: summarizeStudy(row.study),
  }))
  const average = (values: string[]) =>
    values.length
      ? values
          .reduce((sum, v) => sum.plus(decimal(v)), decimal('0'))
          .div(values.length)
          .toFixed()
      : null
  const groups = COINS.flatMap((coin) =>
    (['long', 'short'] as const).flatMap((side) =>
      HORIZONS.flatMap((minutes) =>
        STUDY_COST_BPS.map((costBps, costIndex) => {
          const rows = summaries.map((batch) => {
            const row = batch.rows.find(
              (row) =>
                row.coin === coin &&
                row.side === side &&
                row.minutes === minutes,
            )
            assert.ok(row)
            return {
              id: batch.id,
              startedAt: batch.startedAt,
              signal: row.signal,
              control: row.control,
              ...row.costs[costIndex],
            }
          })
          const paired = rows.filter(
            (row) =>
              row.signalNetPercent !== null && row.controlNetPercent !== null,
          )
          const differences = paired.map((row) => row.difference as string)
          return {
            coin,
            side,
            minutes,
            costBps,
            pairedBatches: paired.length,
            unpairedBatches: rows.length - paired.length,
            signalMeasured: rows.reduce((n, row) => n + row.signal.measured, 0),
            signalMissing: rows.reduce((n, row) => n + row.signal.missing, 0),
            controlMeasured: rows.reduce(
              (n, row) => n + row.control.measured,
              0,
            ),
            controlMissing: rows.reduce((n, row) => n + row.control.missing, 0),
            signalNetPercent: average(
              paired.map((row) => row.signalNetPercent as string),
            ),
            controlNetPercent: average(
              paired.map((row) => row.controlNetPercent as string),
            ),
            meanDifference: average(differences),
            positiveDifferenceBatches: differences.filter((v) =>
              decimal(v).gt(0),
            ).length,
            minDifference: differences.length
              ? differences.reduce((min, v) =>
                  decimal(v).lt(decimal(min)) ? v : min,
                )
              : null,
            maxDifference: differences.length
              ? differences.reduce((max, v) =>
                  decimal(v).gt(decimal(max)) ? v : max,
                )
              : null,
            batches: rows,
          }
        }),
      ),
    ),
  )
  return {
    completedBatches: batches.length,
    uniqueAccounts: accounts.size,
    recurringAccountCoins: [...accountCoins.values()].filter((n) => n > 1)
      .length,
    groups,
  }
}
