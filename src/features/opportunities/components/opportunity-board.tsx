'use client'

import { Button } from '@fameex/ui'
import Link from 'next/link'
import { Profiler, type ReactNode, useState } from 'react'
import { PerformancePanel } from '@/shared/components/performance-panel'
import { recordReactRender } from '@/shared/lib/performance'
import { useOpportunities } from '../hooks/use-opportunities'
import { assessCandidate, type PositionSummary } from '../lib/candidates'
import { compareEntry } from '../lib/entry-price'
import {
  type Followup,
  HORIZONS,
  MAX_FOLLOWUPS,
  summarizeFollowups,
  updateFollowups,
} from '../lib/followups'
import {
  cardStatus,
  type Fill,
  type OpportunityCard,
} from '../lib/opportunities'

const money = (value: string | number) =>
  new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(
    Number(value),
  )
const time = (value: number) =>
  new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(value)
const short = (address: string) => `${address.slice(0, 8)}…${address.slice(-6)}`
const price = (value: string) =>
  new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 6 }).format(
    Number(value),
  )
const gap = (value: string) => {
  const n = Number(value)
  if (n !== 0 && Math.abs(n) < 0.001) return `${n > 0 ? '+' : '-'}<0.001%`
  return `${new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 3, minimumFractionDigits: 3, signDisplay: 'always' }).format(n)}%`
}
const actionNames = {
  open: '新开',
  add: '加仓',
  reduce: '减仓',
  close: '平仓',
  reverse: '反手',
}

function FillEvidence({
  address,
  fills,
  children,
}: {
  address: string
  fills: Fill[]
  children: ReactNode
}) {
  return (
    <details className="mt-4 border-t border-edge pt-3 text-xs">
      <summary className="cursor-pointer rounded text-muted focus-visible:outline-2 focus-visible:outline-accent">
        查看成交证据
      </summary>
      <div className="mt-3 space-y-2 break-all text-muted">
        <p>账户：{address}</p>
        {children}
        <p>
          负仓位表示空仓。仅汇总近 20
          分钟可用成交，可能不是订单或持仓的全部历史。
        </p>
        {fills.slice(0, 5).map((fill) => (
          <p key={`${fill.time}:${fill.tid}:${fill.side}`}>
            tid {fill.tid} · {fill.side === 'B' ? '买' : '卖'} {fill.sz} @{' '}
            {fill.px}
            {/^0x[0-9a-fA-F]{64}$/.test(fill.hash) &&
              !/^0x0{64}$/.test(fill.hash) && (
                <>
                  {' '}
                  ·{' '}
                  <a
                    className="text-accent underline"
                    href={`https://app.hyperliquid.xyz/explorer/tx/${fill.hash}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    交易记录
                  </a>
                </>
              )}
          </p>
        ))}
        <p>展示前 5 笔；完整成交可通过页面顶部“导出证据”保存。</p>
      </div>
    </details>
  )
}

function SummaryCard({
  summary,
  assessment,
  entry,
}: {
  summary: PositionSummary
  assessment: ReturnType<typeof assessCandidate>
  entry: ReturnType<typeof compareEntry>
}) {
  const side = summary.side === 'long' ? '多头' : '空头'
  const origin = {
    open: '窗口内新开仓',
    add: '已有仓位变化',
    reverse: '反手后的新方向',
  }[summary.origin]
  return (
    <article
      className="flex min-w-0 flex-col rounded-xl border border-edge bg-panel p-5"
      aria-label={`${summary.coin} ${side}持仓摘要`}
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">
            {summary.coin}{' '}
            <span className="text-sm font-normal text-muted">{side}</span>
          </h2>
          <p className="mt-1 text-xs text-muted">{origin}</p>
        </div>
        <span
          className={`shrink-0 rounded px-2 py-1 text-xs ${assessment.eligible ? 'bg-mint/10 text-mint' : 'bg-surface text-muted'}`}
        >
          {assessment.status}
        </span>
      </div>
      <p className="mt-5 text-2xl font-semibold tracking-tight">
        {money(assessment.recentNotional)}{' '}
        <span className="text-xs font-normal text-muted">USDC</span>
      </p>
      <p className="mt-1 text-xs text-muted">
        近 5 分钟新增仓位成交 · 排除平仓部分
      </p>
      <p className="mt-4 text-sm leading-6">
        本段合并 {summary.orderCount} 个订单、{summary.fills.length}{' '}
        笔成交，仓位从 {summary.before} 变为 {summary.currentPosition}{' '}
        {summary.coin}。
      </p>
      <dl className="mt-4 space-y-2 text-xs text-muted">
        <div className="flex justify-between gap-2">
          <dt>账户</dt>
          <dd title={summary.address}>{short(summary.address)}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt>最近成交</dt>
          <dd>{time(summary.lastTime)}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt>仓位核验</dt>
          <dd>{time(summary.checkedAt)}</dd>
        </div>
      </dl>
      <section
        aria-label={`${summary.coin} 入场价格参考`}
        className="mt-4 rounded-lg border border-edge p-3 text-xs"
      >
        <h3 className="font-medium">入场价格参考</h3>
        <dl className="mt-3 space-y-2">
          <div className="flex flex-wrap justify-between gap-2">
            <dt className="text-muted">近 5 分钟增仓均价</dt>
            <dd>
              {assessment.averageEntryPrice
                ? `${price(assessment.averageEntryPrice)} USDC`
                : '无近期增仓'}
            </dd>
          </div>
          {entry.available && (
            <>
              <div className="flex flex-wrap justify-between gap-2">
                <dt className="text-muted">
                  {entry.side === 'ask' ? '当前卖一价' : '当前买一价'}
                </dt>
                <dd>{price(entry.price)} USDC</dd>
              </div>
              <div className="flex flex-wrap justify-between gap-2">
                <dt className="text-muted">该档显示数量</dt>
                <dd>
                  {entry.size} {summary.coin}
                </dd>
              </div>
              <div className="flex flex-wrap justify-between gap-2">
                <dt className="text-muted">同向价差</dt>
                <dd
                  className={
                    Number(entry.adversePercent) > 0 ? 'text-loss' : 'text-ink'
                  }
                >
                  {gap(entry.adversePercent)}
                </dd>
              </div>
              <div className="flex flex-wrap justify-between gap-2">
                <dt className="text-muted">盘口时间</dt>
                <dd>{time(entry.quoteTime)}</dd>
              </div>
            </>
          )}
        </dl>
        {!entry.available && <p className="mt-3 text-muted">{entry.reason}</p>}
        <p className="mt-3 leading-5 text-muted">
          正值表示同方向开仓价格较差，负值表示较优，仅比较价格。均价不是账户总持仓成本；第一档报价不保证整单成交，未计手续费、资金费及跨档滑点。
        </p>
      </section>
      <div className="mt-4 rounded-lg bg-surface p-3 text-xs leading-5">
        <p className="font-medium">
          {assessment.eligible ? '入选依据' : '暂不入选'}
        </p>
        {assessment.eligible ? (
          <p className="mt-1 text-muted">
            近期新增仓位达到门槛，核验时仍持有；本段没有减仓或清算，窗口内未反复退出。
          </p>
        ) : (
          <ul className="mt-1 list-inside list-disc text-muted">
            {assessment.reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        )}
      </div>
      <FillEvidence address={summary.address} fills={summary.fills}>
        <p>
          本段可见起点：{time(summary.firstTime)}。订单与 TWAP 父订单分别计数。
        </p>
        <p>近 20 分钟归零或反手次数：{summary.exitsInWindow}。</p>
        <p>
          摘要由成交规则生成，入选只表示符合观察条件，不表示预期收益。其他平台的对冲未知。
        </p>
      </FillEvidence>
    </article>
  )
}

function FollowupResults({ records }: { records: Followup[] }) {
  return (
    <section aria-label="候选后续表现" className="min-w-0 space-y-4">
      <p className="text-sm leading-6 text-muted">
        首次入选时固定起点报价，分别记录 1／5／15
        分钟后的第一档价格表现。多头用起点卖一和到点买一，空头用起点买一和到点卖一；正值表示有利的方向变化，含买卖价差，未计手续费、资金费、跨档滑点或杠杆。
      </p>
      <p className="text-xs leading-5 text-muted">
        每个时间点只取目标时间后 10
        秒内采集的有效盘口，迟到不补记。候选退出或核验失败后仍保留并观察价格，固定持有期不跟随大户平仓。缺测单独计数；这里只检验价格变化，不是实际收益或盈利证明。
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        {summarizeFollowups(records).map((stat) => (
          <section
            key={stat.minutes}
            className="rounded-lg border border-edge bg-panel p-4"
            aria-label={`${stat.minutes} 分钟统计`}
          >
            <h2 className="text-sm font-medium">{stat.minutes} 分钟</h2>
            <p className="mt-3 text-xl tabular-nums">
              {stat.averagePercent === null ? '—' : gap(stat.averagePercent)}
            </p>
            <p className="mt-1 text-xs text-muted">有效样本平均价差表现</p>
            <p className="mt-3 text-xs leading-5 text-muted">
              有效 {stat.measured} / 总计 {stat.total} · 正向 {stat.positive}
              <br />
              待采样 {stat.pending} · 缺测 {stat.missing}
            </p>
          </section>
        ))}
      </div>
      <p className="text-xs leading-5 text-muted">
        本机记录 {records.length} / {MAX_FOLLOWUPS}{' '}
        条，达到上限后停止新增。记录保存在当前浏览器，刷新、重新打开同一网址可恢复。关闭页面后不采集，离线错过的点记为缺测；清空前请先导出证据。
      </p>
      {records.length ? (
        <div className="overflow-x-auto rounded-lg border border-edge bg-panel">
          <table
            aria-label="候选后续表现记录"
            className="w-full min-w-[850px] text-left text-xs"
          >
            <thead className="border-b border-edge text-muted">
              <tr>
                {[
                  '持仓 / 账户',
                  '首次入选',
                  '起点报价',
                  ...HORIZONS.map((minutes) => `${minutes} 分钟`),
                ].map((label) => (
                  <th key={label} className="px-4 py-3 font-medium">
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...records].reverse().map((record) => (
                <tr
                  key={record.id}
                  className="border-b border-edge last:border-0"
                >
                  <td className="whitespace-nowrap px-4 py-4 align-top">
                    <p>
                      {record.coin} {record.side === 'long' ? '多头' : '空头'}
                    </p>
                    <p className="mt-2 text-muted" title={record.address}>
                      {short(record.address)}
                    </p>
                  </td>
                  <td className="whitespace-nowrap px-4 py-4 align-top">
                    {time(record.detectedAt)}
                  </td>
                  <td className="max-w-44 px-4 py-4 align-top">
                    {record.entry.available ? (
                      <>
                        {price(record.entry.price)}
                        <p className="mt-2 text-muted">
                          {record.entry.side === 'ask' ? '卖一' : '买一'} ·{' '}
                          {record.entry.size} {record.coin}
                        </p>
                      </>
                    ) : (
                      <span className="text-muted">{record.entry.reason}</span>
                    )}
                  </td>
                  {record.points.map((point) => (
                    <td
                      key={point.minutes}
                      className="max-w-48 px-4 py-4 align-top"
                    >
                      {point.status === 'measured' ? (
                        <>
                          <p
                            className={
                              Number(point.percent) > 0
                                ? 'text-mint'
                                : Number(point.percent) < 0
                                  ? 'text-loss'
                                  : 'text-ink'
                            }
                          >
                            {gap(point.percent)}
                          </p>
                          <p className="mt-2 text-muted">
                            采样 {time(point.sampledAt)}
                          </p>
                        </>
                      ) : (
                        <>
                          <p>
                            {point.status === 'pending' ? '待采样' : '缺测'}
                          </p>
                          <p className="mt-2 leading-5 text-muted">
                            {point.status === 'pending'
                              ? `目标 ${time(point.dueAt)}`
                              : point.reason}
                          </p>
                        </>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="rounded-lg border border-dashed border-edge p-8 text-center text-muted">
          尚未记录到入选候选；不会使用历史成交价格补造起点。
        </p>
      )}
    </section>
  )
}

function EvidenceCard({
  card,
  unavailable,
  now,
}: {
  card: OpportunityCard
  unavailable: boolean
  now: number
}) {
  const status = cardStatus(card, now, unavailable)
  const positive = status === '仍持有'
  const title = card.interleaved
    ? '交错订单活动'
    : `${actionNames[card.action]}${card.side === 'long' ? '多仓' : '空仓'}`
  return (
    <article
      className="flex min-w-0 flex-col rounded-xl border border-edge bg-panel p-5"
      aria-label={`${card.coin} ${title}`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-baseline gap-2">
          <h2 className="text-lg font-semibold">{card.coin}</h2>
          <span className="text-sm text-muted">{title}</span>
        </div>
        <span
          className={`shrink-0 rounded px-2 py-1 text-xs ${positive ? 'bg-mint/10 text-mint' : 'bg-surface text-muted'}`}
        >
          {status}
        </span>
      </div>
      <p className="mt-5 text-2xl font-semibold tracking-tight">
        {money(card.notional)}{' '}
        <span className="text-xs font-normal text-muted">USDC</span>
      </p>
      <p className="mt-1 text-xs text-muted">
        窗口内此{card.orderKey.startsWith('twap:') ? ' TWAP 父订单' : '订单'}
        已成交金额 · {card.fillCount} 笔成交
      </p>
      <dl className="mt-5 space-y-2 text-sm">
        {!card.interleaved && (
          <div className="flex flex-wrap justify-between gap-2">
            <dt className="text-muted">事件前后仓位</dt>
            <dd>
              {card.before} → {card.after} {card.coin}
            </dd>
          </div>
        )}
        <div className="flex flex-wrap justify-between gap-2">
          <dt className="text-muted">核验时仓位</dt>
          <dd>
            {card.currentPosition} {card.coin}
          </dd>
        </div>
        <div className="flex flex-wrap justify-between gap-2">
          <dt className="text-muted">账户</dt>
          <dd title={card.address}>{short(card.address)}</dd>
        </div>
        <div className="flex flex-wrap justify-between gap-2">
          <dt className="text-muted">最近成交</dt>
          <dd>{time(card.lastTime)}</dd>
        </div>
      </dl>
      <p className="mt-4 min-h-10 text-xs leading-5 text-muted">
        {card.liquidation
          ? '包含清算成交，不作为主动开仓判断。'
          : card.interleaved
            ? '与其他订单交错成交，仅展示此订单金额，不归因整段仓位变化。'
            : card.status === 'exited' || card.status === 'reversed'
              ? '原方向持仓已结束；旧事件保留用于复核。'
              : card.action === 'reduce' || card.action === 'close'
                ? '这次成交减少了原有持仓，不代表建立相反方向的新仓。'
                : '该地址增加了此方向的风险敞口；其他账户或平台的对冲未知。'}
      </p>
      <FillEvidence address={card.address} fills={card.fills}>
        <p>订单：{card.orderKey}</p>
        <p>
          首次成交：{time(card.firstTime)} · 核验：{time(card.checkedAt)}
        </p>
      </FillEvidence>
    </article>
  )
}

export function OpportunityBoard() {
  const [enabled, setEnabled] = useState(true)
  const [session, setSession] = useState(0)
  const [filter, setFilter] = useState('全部')
  const [view, setView] = useState('候选机会')
  const {
    reports,
    connection,
    streamError,
    tradeCount,
    now,
    quotes,
    followups,
    cooldownUntil,
    canCollect,
    archiveMessage,
    archiveOwned,
    saveFailed,
    retrySave,
    clearArchive,
  } = useOpportunities(enabled, session)
  const allCards = reports
    .flatMap((report) => report.cards)
    .sort((a, b) => b.lastTime - a.lastTime)
  const unavailable = (address: string) =>
    !enabled ||
    Boolean(reports.find((report) => report.address === address)?.error)
  const summaries = reports
    .flatMap((report) =>
      report.summaries.map((summary) => {
        const assessment = assessCandidate(
          summary,
          now,
          unavailable(report.address),
        )
        return {
          summary,
          assessment,
          entry: compareEntry(
            summary,
            assessment,
            quotes[summary.coin],
            now,
            enabled && connection === '已连接',
          ),
        }
      }),
    )
    .sort((a, b) => b.summary.lastTime - a.summary.lastTime)
  const candidates = summaries.filter((row) => row.assessment.eligible)
  const visibleSummaries = view === '候选机会' ? candidates : summaries
  const cards = allCards.filter(
    (card) =>
      filter === '全部' ||
      (filter === '仍持有'
        ? cardStatus(card, now, unavailable(card.address)) === '仍持有'
        : ['已退出', '已反手'].includes(
            cardStatus(card, now, unavailable(card.address)),
          )),
  )
  const errors = reports.filter((report) => report.error)
  const exportEvidence = () => {
    const exportedAt = Date.now()
    const exportedFollowups = updateFollowups(
      followups,
      [],
      {},
      exportedAt,
      false,
    )
    const url = URL.createObjectURL(
      new Blob(
        [
          JSON.stringify(
            {
              network: 'mainnet',
              mode: 'read-only',
              exportedAt,
              connection,
              cooldownUntil,
              quotes,
              followups: exportedFollowups,
              followupStats: summarizeFollowups(exportedFollowups),
              reports: reports.map((report) => ({
                ...report,
                summaries: report.summaries.map((summary) => {
                  const assessment = assessCandidate(
                    summary,
                    exportedAt,
                    unavailable(report.address),
                  )
                  return {
                    ...summary,
                    assessment,
                    entry: compareEntry(
                      summary,
                      assessment,
                      quotes[summary.coin],
                      exportedAt,
                      enabled && connection === '已连接',
                    ),
                  }
                }),
                cards: report.cards.map((card) => ({
                  ...card,
                  displayStatus: cardStatus(
                    card,
                    exportedAt,
                    unavailable(report.address),
                  ),
                })),
              })),
            },
            null,
            2,
          ),
        ],
        { type: 'application/json' },
      ),
    )
    const link = document.createElement('a')
    link.href = url
    link.download = `mainnet-observations-${Date.now()}.json`
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  return (
    <Profiler id="opportunityReact" onRender={recordReactRender}>
      <main className="min-h-screen bg-canvas text-ink">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-edge bg-panel px-5 py-4 sm:px-8">
          <div className="flex items-center gap-3">
            <Link href="/" className="text-sm text-muted hover:text-ink">
              ← 测试网交易
            </Link>
            <span className="h-4 w-px bg-edge" />
            <span className="text-sm font-medium">机会观察</span>
            <span className="rounded border border-accent/30 bg-accent/10 px-2 py-1 text-xs text-accent">
              主网 · 只读
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            <PerformancePanel />
            <Button
              size="sm"
              variant="bordered"
              isDisabled={!canCollect}
              onClick={() => setEnabled((value) => !value)}
            >
              {enabled ? '暂停观察' : '继续观察'}
            </Button>
            <Button
              size="sm"
              variant="bordered"
              isDisabled={!canCollect}
              onClick={() => {
                setSession((value) => value + 1)
                setEnabled(true)
              }}
            >
              重新扫描
            </Button>
            <Button
              size="sm"
              variant="bordered"
              isDisabled={
                !reports.some((report) => report.checkedAt) && !followups.length
              }
              onClick={exportEvidence}
            >
              导出证据
            </Button>
          </div>
        </header>
        <div className="mx-auto max-w-7xl px-5 py-8 sm:px-8">
          {archiveMessage && (
            <output className="mb-5 block rounded-lg border border-edge bg-surface p-3 text-sm">
              {archiveMessage}
              {saveFailed && (
                <Button
                  className="ml-3"
                  size="sm"
                  variant="bordered"
                  onPress={retrySave}
                >
                  重试保存
                </Button>
              )}
            </output>
          )}
          {cooldownUntil > now && (
            <output className="mb-5 block rounded-lg border border-edge bg-surface p-3 text-sm">
              账户查询冷却中，将在 {time(cooldownUntil)}{' '}
              后继续；盘口订阅与后续价格观察不受此查询冷却影响。
            </output>
          )}
          <p className="text-xs font-medium tracking-widest text-accent">
            BTC / ETH / SOL
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight">
            从大额成交，筛出值得继续观察的持仓
          </h1>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-muted">
            同一账户、同一币种合并成一条持仓摘要。优先展示近期新增、仍持有的方向，每条候选都能展开核对依据。
          </p>
          <div className="mt-7 grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[
              ['公开成交流', connection],
              ['近 5 分钟采样', `${tradeCount} 笔`],
              ['跟踪账户', `${reports.length} / 6`],
              ['候选 / 持仓摘要', `${candidates.length} / ${summaries.length}`],
            ].map(([label, value]) => (
              <div
                key={label}
                className="rounded-lg border border-edge bg-panel px-4 py-3"
              >
                <p className="text-xs text-muted">{label}</p>
                <p className="mt-2 text-lg font-medium">{value}</p>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs leading-5 text-muted">
            账户发现及大额订单门槛：成交名义金额 ≥ 100,000 USDC。每轮核验完成 30
            秒后刷新；快照超过 90 秒标为待核验。时间为北京时间。
          </p>
          <details className="mt-3 text-xs leading-5 text-muted">
            <summary className="cursor-pointer rounded focus-visible:outline-2 focus-visible:outline-accent">
              候选如何筛选
            </summary>
            <p className="mt-2">
              最新持仓段近 5 分钟新增仓位成交至少 100,000
              USDC，仍持有且本段没有减仓、清算；近 20 分钟归零或反手少于 2
              次。反手只计新方向数量，TWAP
              按父订单合并。摘要只覆盖可见成交窗口。
            </p>
            <p className="mt-1">
              暂停、核验失败或快照超过 90
              秒会移出候选。规则用于减少观察噪音，尚未验证盈利能力；没有符合条件的持仓时保持空列表。
            </p>
            <p className="mt-1">
              入场价格参考用近 5
              分钟新增仓位的成交量加权均价，与当前同方向第一档报价比较：多头参考卖一、空头参考买一。盘口超过
              10
              秒未更新或断线时暂停比较；价格差不改变行为候选资格，也不是收益预测。
            </p>
          </details>
          <p className="mt-1 text-xs leading-5 text-muted">
            每次扫描固定跟踪最多 6
            个地址；继续观察或重新扫描会清空账户列表，保留本机后续表现记录。页面关闭后停止采集，重新打开会恢复存档。一次只允许同一网址的一个标签页采集。
          </p>
          {(!enabled || streamError || connection === '重连中') && (
            <output className="mt-5 block rounded-lg border border-edge bg-surface p-3 text-sm text-muted">
              {!enabled
                ? '观察已暂停，已有卡片待重新核验。'
                : (streamError ??
                  '公开成交流已断开，正在重连；账户核验仍独立刷新。')}
            </output>
          )}
          {errors.length > 0 && (
            <details className="mt-5 rounded-lg border border-loss/30 bg-loss/5 p-3 text-sm">
              <summary className="cursor-pointer text-loss">
                {errors.length} 个账户暂未通过核验
              </summary>
              <ul className="mt-2 space-y-2 text-xs text-muted">
                {errors.map((report) => (
                  <li key={report.address}>
                    {short(report.address)}：{report.error}
                  </li>
                ))}
              </ul>
            </details>
          )}
          <div className="mb-5 mt-8 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-2">
              {['候选机会', '全部摘要', '订单活动', '后续表现'].map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={view === value}
                  onClick={() => setView(value)}
                  className={`rounded-md px-3 py-2 text-sm ${view === value ? 'bg-accent/15 text-accent' : 'text-muted hover:bg-surface'}`}
                >
                  {value}
                </button>
              ))}
            </div>
            <span className="text-xs text-muted">
              {view === '后续表现'
                ? '按首次入选时间倒序 · 仅为价格观察'
                : '按最近成交排序 · 金额不等于账户净值'}
            </span>
          </div>
          {view === '后续表现' ? (
            <>
              <div className="mb-4 flex justify-end">
                <Button
                  size="sm"
                  variant="bordered"
                  isDisabled={!archiveOwned}
                  onPress={() => {
                    if (
                      window.confirm(
                        '清空本机全部观察记录？此操作无法撤销，请先导出证据。查询冷却期限会保留。',
                      ) &&
                      clearArchive()
                    ) {
                      setSession((value) => value + 1)
                    }
                  }}
                >
                  清空本机记录
                </Button>
              </div>
              <FollowupResults records={followups} />
            </>
          ) : view !== '订单活动' ? (
            visibleSummaries.length ? (
              <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
                {visibleSummaries.map((row) => (
                  <SummaryCard
                    key={row.summary.id}
                    summary={row.summary}
                    assessment={row.assessment}
                    entry={row.entry}
                  />
                ))}
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-edge px-6 py-16 text-center">
                <p className="text-lg">
                  {!enabled
                    ? '观察已暂停'
                    : view === '候选机会'
                      ? '暂时没有符合规则的候选'
                      : '正在等待通过核验的持仓摘要'}
                </p>
                <p className="mt-3 text-sm text-muted">
                  {summaries.length
                    ? `已识别 ${summaries.length} 条摘要，可在“全部摘要”查看排除原因和证据。`
                    : '从公开成交发现账户后逐个核验；没有数据时不会填充示例。'}
                </p>
              </div>
            )
          ) : (
            <>
              <div className="mb-4 flex gap-2">
                {['全部', '仍持有', '已退出'].map((value) => (
                  <button
                    type="button"
                    key={value}
                    aria-pressed={filter === value}
                    onClick={() => setFilter(value)}
                    className={`rounded px-3 py-1 text-xs ${filter === value ? 'bg-surface text-ink' : 'text-muted'}`}
                  >
                    {value}
                  </button>
                ))}
              </div>
              {cards.length ? (
                <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
                  {cards.map((card) => (
                    <EvidenceCard
                      key={card.id}
                      card={card}
                      unavailable={unavailable(card.address)}
                      now={now}
                    />
                  ))}
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-edge px-6 py-16 text-center">
                  <p className="text-lg">
                    {!enabled
                      ? '观察已暂停'
                      : allCards.length
                        ? '当前筛选下暂无观察卡'
                        : reports.length
                          ? '正在核验账户，暂无符合条件的卡片'
                          : '正在扫描大额成交'}
                  </p>
                  <p className="mt-3 text-sm text-muted">
                    {enabled
                      ? '只展示通过仓位核对、达到金额门槛的订单活动；没有结果时不会填充示例数据。'
                      : '继续观察后会读取新的主网数据。'}
                  </p>
                </div>
              )}
            </>
          )}
        </div>
      </main>
    </Profiler>
  )
}
