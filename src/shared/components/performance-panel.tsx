'use client'

import { Button } from '@fameex/ui'
import { useRef, useSyncExternalStore } from 'react'
import { t, useLocale } from '@/i18n'
import { performanceStore } from '@/shared/lib/performance'

export function PerformancePanel() {
  useLocale()

  const data = useSyncExternalStore(
    performanceStore.subscribe,
    performanceStore.getSnapshot,
    performanceStore.getServerSnapshot,
  )
  const dialog = useRef<HTMLDialogElement>(null)
  const mode = data.hidden
    ? t('后台暂停绘制')
    : data.level === 0
      ? t('正常 · 逐帧')
      : data.level === 1
        ? t('保护 · 30fps')
        : t('保护 · 10fps')
  const mb = (value: number | null) =>
    value == null ? t('不支持') : `${(value / 1024 / 1024).toFixed(1)} MB`
  function download() {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
    )
    const link = document.createElement('a')
    link.href = url
    link.download = `terminal-performance-${Date.now()}.json`
    link.click()
    URL.revokeObjectURL(url)
  }
  return (
    <>
      <Button
        variant="light"
        size="sm"
        onPress={() => dialog.current?.showModal()}
        className={data.level ? 'text-amber-300' : 'text-muted'}
      >
        {t('性能 ·')}
        {mode}
      </Button>
      <dialog
        ref={dialog}
        aria-labelledby="performance-title"
        className="m-auto max-h-[85dvh] w-[calc(100%-24px)] max-w-5xl overflow-auto rounded-xl border border-edge bg-panel p-5 text-ink shadow-xl backdrop:bg-black/70"
      >
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 id="performance-title" className="text-lg font-semibold">
            {t('性能监测')}
          </h2>
          <div className="flex gap-3">
            <Button size="sm" variant="bordered" onPress={download}>
              {t('导出指标')}
            </Button>
            <Button
              size="sm"
              variant="light"
              onPress={() => dialog.current?.close()}
            >
              {t('关闭')}
            </Button>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
          <Stat label={t('显示策略')} value={mode} />
          <Stat
            label={t('页面帧率')}
            value={data.fps == null ? '—' : `${data.fps.toFixed(1)} fps`}
          />
          <Stat label={t('长任务 / 秒')} value={String(data.longTasks)} />
          <Stat
            label={t('JS 堆内存（浏览器估计）')}
            value={mb(data.heapUsed)}
          />
        </div>
        <p className="my-3 text-xs text-muted">
          {data.reason || '未检测到持续超载，不限制行情接收频率。'}
          {data.level > 0 && ' 连续健康后自动恢复。'}
        </p>
        <div className="overflow-x-auto">
          <table
            aria-label={t('模块性能指标')}
            className="w-full whitespace-nowrap text-right text-xs tabular-nums"
          >
            <thead className="text-muted">
              <tr>
                {[
                  t('模块'),
                  t('接收 / 秒'),
                  t('提交 / 秒'),
                  'P95 ms',
                  t('最大 ms'),
                  t('待处理'),
                  t('缓存条数'),
                  t('累计合并'),
                  t('容量淘汰'),
                  t('数据年龄 ms'),
                ].map((label) => (
                  <th
                    key={t(label)}
                    className="border-b border-edge px-2 py-3 font-normal first:text-left"
                  >
                    {t(label)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.modules.map((row) => (
                <tr
                  key={row.id}
                  className="border-b border-edge/60 hover:bg-surface"
                >
                  <td className="px-2 py-3 text-left">{t(row.name)}</td>
                  {[
                    row.inputRate.toFixed(1),
                    row.updateRate.toFixed(1),
                    row.p95.toFixed(2),
                    row.max.toFixed(2),
                    row.pending,
                    row.retained,
                    row.coalesced,
                    row.dropped,
                    row.age ? row.age.toFixed(0) : '—',
                  ].map((value, index) => (
                    <td key={`${row.id}-${index}`} className="px-2">
                      {value}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-4 space-y-2 text-xs leading-5 text-muted">
          <p>
            {t(
              '每秒汇总一次，各模块最多保留 120 个耗时样本。P95 是 95% 的同步处理耗时不超过的值；React 行记录渲染耗时，图表行记录同步调用耗时，不代表 GPU 绘制耗时。',
            )}
          </p>
          <p>
            {t(
              '盘口只保留最新快照；K 线按时间合并，最多 500 根；成交按 ID 去重，最多 100 笔。合并不代表丢失最终行情，容量淘汰会单独计数。数据年龄含网络与本机时钟偏差，不能当成纯网络延迟。',
            )}
          </p>
          <p>
            {t(
              '连续 3 秒出现高负载和掉帧／长任务后才降低显示频率；JS 堆接近上限时立即保护。连续健康 10 秒恢复一级。订阅持续接收，切回页面会展示最新值。内存指标是浏览器提供的整页估计，不能据此断言某模块泄漏。',
            )}
          </p>
        </div>
      </dialog>
    </>
  )
}
function Stat({ label, value }: { label: string; value: string }) {
  useLocale()

  return (
    <dl className="rounded-lg bg-surface p-3">
      <dt className="text-muted">{t(label)}</dt>
      <dd className="mt-2 font-mono text-sm">{value}</dd>
    </dl>
  )
}
