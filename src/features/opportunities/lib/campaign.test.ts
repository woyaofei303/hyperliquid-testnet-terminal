import assert from 'node:assert/strict'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createCampaign, reportCampaign, runCampaign } from './campaign.ts'
import { createStudy, updateStudy } from './study.ts'

test('预先固定三批时点；错过超过一分钟的批次不补跑，已有目录不覆盖', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'opportunity-campaign-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const start = 1_000_000
  let now = start
  t.mock.method(Date, 'now', () => now)
  const plan = createCampaign(start)
  assert.deepEqual(
    plan.slots.map((row) => row.scheduledAt),
    [start, start + 7_200_000, start + 14_400_000],
  )
  assert.equal(plan.enrollmentMinutes, 30)
  const calls: string[] = []
  const directory = join(root, 'run')
  await runCampaign(
    directory,
    new AbortController().signal,
    async (out, minutes) => {
      calls.push(out)
      assert.equal(minutes, 30)
      now = start + 14_400_000
      throw new Error('模拟接口故障')
    },
  )
  assert.deepEqual(
    calls.map((path) => path.split('/').at(-1)),
    ['batch-001', 'batch-003'],
  )
  const report = reportCampaign(directory)
  assert.deepEqual(
    report.slots.map((row) => row.status),
    ['failed', 'missed', 'failed'],
  )
  assert.equal(report.comparison.completedBatches, 0)
  assert.ok(
    readFileSync(join(directory, 'summary.md'), 'utf8').includes(
      '模拟接口故障',
    ),
  )
  const original = readFileSync(join(directory, 'plan.json'), 'utf8')
  await assert.rejects(
    runCampaign(directory, new AbortController().signal),
    /EEXIST/,
  )
  assert.equal(readFileSync(join(directory, 'plan.json'), 'utf8'), original)
  writeFileSync(
    join(directory, 'plan.json'),
    original.replace('"enrollmentMinutes": 30', '"enrollmentMinutes": 1'),
  )
  assert.throws(() => reportCampaign(directory), /计划/)
})

test('等待未来批次时可立即停止，后续批次取消而不是假装完成', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'opportunity-campaign-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const abort = new AbortController()
  const directory = join(root, 'run')
  const running = runCampaign(directory, abort.signal, async () => {
    throw new Error('模拟首批失败')
  })
  await new Promise((resolve) => setImmediate(resolve))
  abort.abort()
  const result = await running
  assert.equal(result.status, 'interrupted')
  assert.deepEqual(
    reportCampaign(directory).slots.map((row) => row.status),
    ['failed', 'cancelled', 'cancelled'],
  )
})

test('汇总只读计划内完整且匹配的批次；损坏文件明确剔除，原始检查点不改写', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'opportunity-campaign-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const start = 1_000_000
  let now = start,
    index = 0
  t.mock.method(Date, 'now', () => now)
  const directory = join(root, 'run')
  await runCampaign(
    directory,
    new AbortController().signal,
    async (out, minutes) => {
      let study = createStudy(now, minutes)
      study = updateStudy(study, [], {}, study.endsAt, false)
      mkdirSync(out)
      writeFileSync(
        join(out, 'checkpoint.json'),
        JSON.stringify({ status: 'complete', capturedAt: study.endsAt, study }),
      )
      writeFileSync(
        join(out, 'protocol.json'),
        JSON.stringify({
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
        }),
      )
      now = start + ++index * 7_200_000
      return { directory: out, status: 'complete' }
    },
  )
  assert.equal(reportCampaign(directory).comparison.completedBatches, 3)
  const progressPath = join(directory, 'progress.json')
  const originalProgress = readFileSync(progressPath, 'utf8')
  const progress = JSON.parse(originalProgress)
  progress.slots[0].status = 'failed'
  progress.slots[0].error = '保存失败'
  writeFileSync(progressPath, JSON.stringify(progress))
  assert.equal(reportCampaign(directory).slots[0].status, 'failed')
  assert.equal(reportCampaign(directory).comparison.completedBatches, 2)
  writeFileSync(progressPath, originalProgress)
  mkdirSync(join(directory, 'unplanned'))
  writeFileSync(join(directory, 'unplanned', 'checkpoint.json'), 'unreadable')
  const checkpoint = join(directory, 'batch-002', 'checkpoint.json')
  writeFileSync(checkpoint, 'broken')
  const report = reportCampaign(directory)
  assert.equal(report.comparison.completedBatches, 2)
  assert.equal(report.slots[1].status, 'invalid')
  assert.equal(readFileSync(checkpoint, 'utf8'), 'broken')
  assert.ok(
    report.comparison.groups.every(
      (row) => row.pairedBatches === 0 && row.unpairedBatches === 2,
    ),
  )
})
