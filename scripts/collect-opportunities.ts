import { parseArgs } from 'node:util'
import { collectStudy } from '../src/features/opportunities/lib/collector.ts'

const { values } = parseArgs({
  options: {
    minutes: { type: 'string', default: '60' },
    out: { type: 'string' },
    help: { type: 'boolean' },
  },
})
if (values.help) {
  console.log(
    '主网只读固定批次：npm run collect:opportunities -- --minutes 60 [--out 新目录]\n入组结束后继续观察约 15 分钟。Ctrl+C 保存未完成报告并停止。不会下单或读取密钥；已有目录一律拒绝覆盖。',
  )
} else {
  const abort = new AbortController()
  const stop = () => abort.abort()
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
  const output =
    values.out ??
    `output-tdd/opportunity-study/${new Date().toISOString().replace(/[:.]/g, '-')}`
  try {
    console.log(
      `只读采集：入组 ${values.minutes} 分钟，之后完成 15 分钟观察；输出 ${output}`,
    )
    const result = await collectStudy(
      output,
      Number(values.minutes),
      abort.signal,
    )
    console.log(JSON.stringify(result))
    if (result.status === 'interrupted') process.exitCode = 130
  } catch (error) {
    console.error(error instanceof Error ? error.message : '只读采集失败')
    process.exitCode = 1
  } finally {
    process.removeListener('SIGINT', stop)
    process.removeListener('SIGTERM', stop)
  }
}
