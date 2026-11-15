import assert from 'node:assert/strict'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { collectStudy } from './collector.ts'
import { createStudy, STUDY_METHOD, type Study } from './study.ts'
import { readStudy } from './study-archive.ts'
import { compareStudies } from './study-comparison.ts'

export function createCampaign(startedAt: number) {
  createStudy(startedAt, 30)
  return {
    version: 1,
    method: STUDY_METHOD,
    startedAt,
    enrollmentMinutes: 30,
    startGraceMs: 60000,
    slots: Array.from({ length: 3 }, (_, index) => ({
      id: `batch-${String(index + 1).padStart(3, '0')}`,
      scheduledAt: startedAt + index * 120 * 60000,
    })),
  }
}

function readFile(path: string, limit = 1_000_000) {
  assert.ok(statSync(path).size <= limit, '文件过大')
  return readFileSync(path, 'utf8')
}
function atomic(directory: string, name: string, data: unknown) {
  const temporary = join(directory, `${name}.${process.pid}.tmp`)
  writeFileSync(
    temporary,
    typeof data === 'string' ? data : JSON.stringify(data, null, 2),
  )
  renameSync(temporary, join(directory, name))
}
const message = (cause: unknown) =>
  (cause instanceof Error ? cause.message : '采集失败').slice(0, 500)

type SlotStatus =
  | 'scheduled'
  | 'running'
  | 'complete'
  | 'failed'
  | 'missed'
  | 'interrupted'
  | 'cancelled'
type SlotProgress = { id: string; status: SlotStatus; error?: string }

export function reportCampaign(directory: string) {
  const saved = JSON.parse(readFile(join(directory, 'plan.json')))
  const plan = createCampaign(saved.startedAt)
  assert.deepEqual(saved, plan, '计划不兼容或已修改')
  const progress = JSON.parse(readFile(join(directory, 'progress.json')))
  assert.ok(
    Array.isArray(progress.slots) &&
      progress.slots.length === plan.slots.length,
    '进度无效',
  )
  const complete: { id: string; study: Study }[] = []
  const slots = plan.slots.map((slot, index) => {
    const row = progress.slots[index]
    assert.equal(row?.id, slot.id, '进度批次不匹配')
    assert.ok(
      [
        'scheduled',
        'running',
        'complete',
        'failed',
        'missed',
        'interrupted',
        'cancelled',
      ].includes(row.status),
      '进度状态无效',
    )
    const result = {
      ...slot,
      status: String(row.status),
      detail: typeof row.error === 'string' ? row.error.slice(0, 500) : '',
      capturedAt: null as number | null,
    }
    const batch = join(directory, slot.id)
    if (!existsSync(batch)) {
      if (row.status === 'complete') {
        result.status = 'invalid'
        result.detail = '标记完成但没有批次文件'
      }
      return result
    }
    try {
      const parsed = readStudy(
        readFile(join(batch, 'checkpoint.json'), 20_000_000),
        readFile(join(batch, 'protocol.json')),
        Date.now(),
      )
      assert.ok(
        parsed.study.startedAt >= slot.scheduledAt &&
          parsed.study.startedAt <= slot.scheduledAt + plan.startGraceMs,
        '批次启动时间不符',
      )
      assert.equal(
        parsed.study.enrollmentEndsAt - parsed.study.startedAt,
        plan.enrollmentMinutes * 60000,
        '入组时长不符',
      )
      assert.ok(
        !['missed', 'cancelled', 'scheduled'].includes(row.status),
        '未启动的批次出现采样文件',
      )
      if (row.status === 'complete')
        assert.equal(parsed.status, 'complete', '进度与检查点完成状态不一致')
      result.status = ['failed', 'interrupted'].includes(row.status)
        ? row.status
        : parsed.status
      result.capturedAt = parsed.capturedAt
      if (result.status === 'complete')
        complete.push({ id: slot.id, study: parsed.study })
    } catch (cause) {
      result.status = 'invalid'
      result.detail = message(cause)
    }
    return result
  })
  const comparison = compareStudies(complete)
  const report = { capturedAt: Date.now(), plan, slots, comparison }
  const fmt = (value: string | null) =>
    value === null ? '—' : Number(value).toFixed(4)
  const rows = comparison.groups
    .filter((row) => row.costBps === 10)
    .map(
      (row) =>
        `| ${row.coin} ${row.side === 'long' ? '多' : '空'} | ${row.minutes} | ${row.pairedBatches}/${row.unpairedBatches} | ${row.signalMeasured}/${row.signalMissing} | ${row.controlMeasured}/${row.controlMissing} | ${fmt(row.signalNetPercent)} | ${fmt(row.controlNetPercent)} | ${fmt(row.meanDifference)} | ${row.positiveDifferenceBatches}/${row.pairedBatches} | ${fmt(row.minDifference)} / ${fmt(row.maxDifference)} |`,
    )
  atomic(directory, 'summary.json', report)
  atomic(
    directory,
    'summary.md',
    `# 跨时段主网只读观察\n\n更新：${new Date(report.capturedAt).toISOString()}（UTC）。计划 3 批，完成并通过核验 ${complete.length} 批。只纳入计划内已完成批次；没有信号、缺测、中断、失败与错过时段都保留，未完成批次不进入均值。\n\n${slots.map((row) => `- ${row.id}：${new Date(row.scheduledAt).toISOString()}，${row.status}${row.detail ? `；${row.detail.replace(/\s+/g, ' ')}` : ''}`).join('\n')}\n\n每批入组 30 分钟，再观察 15 分 20 秒；间隔 2 小时启动，超过预定启动时间 60 秒就记为 missed，不补跑。状态来自最后保存文件，不表示进程仍存活。\n\n下表为双边合计额外成本 10 bps 情景，0／10／20 bps 全部结果与逐批明细见 summary.json。成本按起点名义金额扣减，不是实际手续费；价差已含买卖价差，未模拟成交、资金费或跨档滑点。\n\n仅在同币种、方向、期限内，先计算每批信号均值和对照均值，再对两者都有有效样本的批次等权平均。未配对批次不进入均值；有效/缺测数量覆盖全部完成批次，不能用这些总数加权重算表中均值。差值及范围单位为百分点，净价差单位为 %。\n\n| 币种方向 | 分钟 | 配对/未配对批次 | 信号有效/缺测 | 对照有效/缺测 | 信号净价差 | 对照净价差 | 平均差值 | 优于对照批次 | 差值最小/最大 |\n|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|\n${rows.join('\n')}\n\n完成批次覆盖 ${comparison.uniqueAccounts} 个入选地址；有 ${comparison.recurringAccountCoins} 个账户币种组合跨批重复。同批行情、重复账户和多空对照并不独立；这是描述性检查，三批结果不能证明稳定交易优势。没有计算显著性或收益承诺。旧试采批次、计划之外的目录不混入本次汇总。\n`,
  )
  return report
}

export async function runCampaign(
  directory: string,
  signal: AbortSignal,
  collect = collectStudy,
) {
  signal.throwIfAborted()
  const output = resolve(directory),
    plan = createCampaign(Date.now())
  mkdirSync(dirname(output), { recursive: true })
  mkdirSync(output)
  writeFileSync(join(output, 'plan.json'), JSON.stringify(plan, null, 2), {
    flag: 'wx',
  })
  const slots: SlotProgress[] = plan.slots.map(({ id }) => ({
    id,
    status: 'scheduled',
  }))
  const save = () => {
    atomic(output, 'progress.json', {
      pid: process.pid,
      capturedAt: Date.now(),
      slots,
    })
    reportCampaign(output)
  }
  save()
  for (const [index, slot] of plan.slots.entries()) {
    while (!signal.aborted && Date.now() < slot.scheduledAt) {
      try {
        await delay(slot.scheduledAt - Date.now(), undefined, { signal })
      } catch (cause) {
        if (!signal.aborted) throw cause
      }
    }
    if (signal.aborted) slots[index].status = 'cancelled'
    else if (Date.now() > slot.scheduledAt + plan.startGraceMs)
      slots[index].status = 'missed'
    else {
      slots[index].status = 'running'
      save()
      try {
        const result = await collect(
          join(output, slot.id),
          plan.enrollmentMinutes,
          signal,
        )
        slots[index].status = result.status
      } catch (cause) {
        slots[index].status = signal.aborted ? 'interrupted' : 'failed'
        slots[index].error = message(cause)
      }
    }
    save()
  }
  return {
    directory: output,
    status: signal.aborted ? 'interrupted' : 'finished',
  }
}
