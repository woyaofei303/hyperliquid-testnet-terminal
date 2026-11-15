import { parseArgs } from 'node:util'
import {
  reportCampaign,
  runCampaign,
} from '../src/features/opportunities/lib/campaign.ts'

const { values } = parseArgs({
  options: {
    out: { type: 'string' },
    report: { type: 'string' },
    help: { type: 'boolean' },
  },
})
if (values.help) {
  console.log(
    '跨时段主网只读采集：npm run campaign:opportunities -- [--out 新目录]\n固定三批，每批入组 30 分钟，间隔 2 小时启动，总计约 4 小时 45 分钟。Ctrl+C 保存并取消未来批次。\n重算本地报告（不联网）：npm run campaign:opportunities -- --report 已有计划目录\n已有目录不覆盖、不续跑；电脑需保持运行，错过时段不补跑。',
  )
} else {
  const abort = new AbortController()
  const stop = () => abort.abort()
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
  try {
    if (values.report && values.out)
      throw new Error('--report 与 --out 不能同时使用')
    if (values.report) {
      const result = reportCampaign(values.report)
      console.log(
        JSON.stringify(
          {
            directory: values.report,
            completedBatches: result.comparison.completedBatches,
            slots: result.slots,
          },
          null,
          2,
        ),
      )
    } else {
      const output =
        values.out ??
        `output-tdd/opportunity-campaign/${new Date().toISOString().replace(/[:.]/g, '-')}`
      console.log(
        `三批只读采集，输出 ${output}；预定时点见 plan.json，报告见 summary.md。`,
      )
      const result = await runCampaign(output, abort.signal)
      console.log(JSON.stringify(result))
      if (result.status === 'interrupted') process.exitCode = 130
      else if (reportCampaign(output).comparison.completedBatches !== 3)
        process.exitCode = 1
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : '跨时段采集失败')
    process.exitCode = 1
  } finally {
    process.removeListener('SIGINT', stop)
    process.removeListener('SIGTERM', stop)
  }
}
