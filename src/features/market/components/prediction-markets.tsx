'use client'

import { Button, FlatSelect, Input, Tab, Tabs } from '@fameex/ui'
import Link from 'next/link'
import { useMemo, useState } from 'react'
import { predictionEvents } from '@/features/market/lib/market-catalog'
import type { TerminalModel } from '@/features/terminal/hooks/use-terminal'
import { t } from '@/i18n'
import { display } from '@/shared/lib/display'
import { CoinIcon } from './coin-icon'

const categories = [
  ['all', '所有'],
  ['crypto', '加密货币'],
  ['economics', '经济'],
  ['tradfi', '传统金融'],
  ['sports', '体育'],
  ['culture', '文化'],
  ['technology', '科技'],
  ['other', '其他'],
]

const categoryIcons: Record<string, string> = {
  crypto:
    'M14 7a5 5 0 1 0-7 7m14 1a6 6 0 1 1-12 0 6 6 0 0 1 12 0ZM15 12v6m-2-5h3a1 1 0 0 1 0 2h-2a1 1 0 0 0 0 2h3',
  economics: 'm3 8 9-5 9 5H3Zm2 3v7m5-7v7m4-7v7m5-7v7M3 21h18',
  tradfi: 'M4 3v17h17M8 14l4-5 4 3 5-7',
  sports:
    'M8 3h8v7a4 4 0 0 1-8 0V3Zm0 2H4v3a4 4 0 0 0 4 4m8-7h4v3a4 4 0 0 1-4 4m-4 2v5m-4 2h8m-7-2h6',
  culture:
    'M12 3a9 9 0 1 0 0 18h1a2 2 0 0 0 1-3.7 1.5 1.5 0 0 1 1-2.8h2a4 4 0 0 0 4-4C21 6 17 3 12 3ZM7 10h.01M10 7h.01M15 7h.01M18 10h.01',
  technology:
    'M7 7h10v10H7V7Zm3 3h4v4h-4v-4ZM9 3v4m6-4v4M9 17v4m6-4v4M3 9h4m-4 6h4m10-6h4m-4 6h4',
  other: 'M4 4h6v6H4V4Zm10 0h6v6h-6V4ZM4 14h6v6H4v-6Zm10 0h6v6h-6v-6Z',
}

const optionColors = [
  'bg-sky-400',
  'bg-fuchsia-400',
  'bg-amber-400',
  'bg-teal-400',
  'bg-indigo-400',
]

export function PredictionMarkets({ model }: { model: TerminalModel }) {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('all')
  const [venue, setVenue] = useState('all')
  const [limit, setLimit] = useState(24)
  const events = useMemo(() => predictionEvents(model.markets), [model.markets])
  const venues = [...new Set(events.map((e) => e.venue).filter(Boolean))].sort()
  const filtered = events
    .filter(
      (event) =>
        (category === 'all' || event.category === category) &&
        (venue === 'all' || event.venue === venue) &&
        `${event.title} ${event.venue} ${event.markets.map((m) => m.outcomeTitle).join(' ')}`
          .toLowerCase()
          .includes(query.trim().toLowerCase()),
    )
    .sort(
      (a, b) =>
        b.markets.reduce((v, m) => v + Number(m.context.dayNtlVlm || 0), 0) -
        a.markets.reduce((v, m) => v + Number(m.context.dayNtlVlm || 0), 0),
    )
  return (
    <section
      aria-label={t('预测市场')}
      aria-busy={model.catalogLoading}
      className="min-h-0 flex-1 overflow-auto bg-background"
    >
      <div className="mx-auto max-w-[1440px] px-4 py-8 md:px-8">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <h2 className="text-3xl font-semibold">{t('预测市场')}</h2>
          <div className="w-full sm:w-80">
            <Input
              aria-label={t('搜索预测市场')}
              placeholder={t('搜索事件、选项或部署者')}
              value={query}
              onChange={(value) => {
                setQuery(value)
                setLimit(24)
              }}
            />
          </div>
        </div>
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 border-b border-edge pb-2">
          <Tabs
            aria-label={t('预测分类')}
            selectedKey={category}
            onSelectionChange={(key) => {
              setCategory(String(key))
              setLimit(24)
            }}
            classNames={{
              base: 'min-w-0 max-w-full overflow-x-auto',
              tabList: 'gap-5',
              tab: 'h-10',
            }}
          >
            {categories.map(([id, label]) => (
              <Tab key={id} title={t(label)} />
            ))}
          </Tabs>
          <FlatSelect
            aria-label={t('部署者')}
            value={venue}
            onChange={(value) => {
              setVenue(value)
              setLimit(24)
            }}
            items={[
              { key: 'all', label: t('全部部署者') },
              ...venues.map((value) => ({ key: value, label: value })),
            ]}
          />
        </div>
        {model.catalogError && (
          <p role="alert" className="mb-4 text-sm text-loss">
            {t('预测市场加载失败：')}
            {model.catalogError}
          </p>
        )}
        {model.catalogLoading && !events.length && (
          <output className="block" aria-label={t('正在加载预测市场…')}>
            <span className="sr-only">{t('正在加载预测市场…')}</span>
            <span
              aria-hidden="true"
              className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3"
            >
              {[0, 1, 2, 3, 4, 5].map((card) => (
                <span
                  key={card}
                  className="block rounded-xl border border-edge bg-panel p-4 motion-safe:animate-pulse md:p-5"
                >
                  <span className="mb-4 flex min-h-12 gap-3">
                    <span className="size-7 shrink-0 rounded-full bg-fill-1" />
                    <span className="flex-1 space-y-2 py-1">
                      <span className="block h-4 w-4/5 rounded bg-fill-1" />
                      <span className="block h-4 w-3/5 rounded bg-fill-1" />
                    </span>
                  </span>
                  <span className="mb-4 block h-3 w-1/3 rounded bg-fill-1" />
                  <span className="mb-4 block space-y-1.5">
                    <span className="block h-11 rounded-lg bg-fill-1" />
                    <span className="block h-11 rounded-lg bg-fill-1" />
                  </span>
                  <span className="flex justify-between border-t border-edge pt-3">
                    <span className="block h-3 w-16 rounded bg-fill-1" />
                    <span className="block h-3 w-20 rounded bg-fill-1" />
                  </span>
                </span>
              ))}
            </span>
          </output>
        )}
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.slice(0, limit).map((event) => (
            <article
              key={event.id}
              className="flex min-w-0 flex-col rounded-xl border border-edge bg-panel p-4 transition-colors hover:border-fill-2 motion-reduce:transition-none md:p-5"
            >
              <div className="mb-4">
                <h3 className="flex items-start gap-3 text-base font-semibold leading-6 sm:min-h-12">
                  {event.iconCoin ? (
                    <CoinIcon coin={event.iconCoin} className="size-7" />
                  ) : (
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-surface text-text-2">
                      <svg
                        aria-hidden="true"
                        focusable="false"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="size-4"
                      >
                        <path
                          d={
                            categoryIcons[event.category] ?? categoryIcons.other
                          }
                        />
                      </svg>
                    </span>
                  )}
                  <Link
                    className="min-w-0 break-words rounded-sm transition-colors hover:text-text-2 motion-reduce:transition-none"
                    href={`/?market=${encodeURIComponent(event.markets[0].name)}`}
                  >
                    {event.title}
                  </Link>
                </h3>
                <div className="mt-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-xs text-muted">
                  {event.venue && (
                    <span className="min-w-0 break-all">
                      {t('部署者')}{' '}
                      <span className="text-text-2">{event.venue}</span>
                    </span>
                  )}
                  <span className="ml-auto shrink-0">
                    {event.markets.length} {t('个选项')}
                  </span>
                </div>
              </div>
              <div className="mb-4 max-h-52 space-y-1.5 overflow-y-auto rounded-lg">
                {event.markets.map((m, index) => {
                  const price = Number(m.context.markPx)
                  const valid =
                    !!m.context.markPx &&
                    Number.isFinite(price) &&
                    price > 0 &&
                    price < 1
                  const label = m.question == null ? m.base : m.outcomeTitle
                  return (
                    <Link
                      key={m.name}
                      href={`/?market=${encodeURIComponent(m.name)}`}
                      aria-label={`${event.title} · ${label}`}
                      className="group flex min-h-11 items-center justify-between gap-3 rounded-lg bg-surface/45 px-3 py-2 text-sm transition-colors hover:bg-accent/10 active:bg-accent/15 focus-visible:bg-accent/10 focus-visible:ring-inset motion-reduce:transition-none"
                    >
                      <span className="flex min-w-0 items-center gap-2.5">
                        <span
                          aria-hidden="true"
                          className={`size-2 shrink-0 rounded-full ${optionColors[index % optionColors.length]}`}
                        />
                        <span className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
                          <span className="min-w-0 break-words">{label}</span>
                          <small className="whitespace-nowrap text-xs tabular-nums text-muted">
                            {valid ? `${(1 / price).toFixed(2)}x` : '—'}
                          </small>
                        </span>
                      </span>
                      <span className="flex w-16 shrink-0 flex-col gap-1.5">
                        <span className="text-right text-base font-semibold leading-5 tabular-nums">
                          {valid ? `${display(price * 100, 1)}%` : '—'}
                        </span>
                        <span
                          aria-hidden="true"
                          className="h-0.5 overflow-hidden rounded-full bg-fill-1"
                        >
                          <span
                            className="block h-full rounded-full bg-accent/70 group-hover:bg-accent group-focus-visible:bg-accent"
                            style={{ width: valid ? `${price * 100}%` : '0%' }}
                          />
                        </span>
                      </span>
                    </Link>
                  )
                })}
              </div>
              <div className="mt-auto flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-t border-edge pt-3 text-xs text-muted">
                <span>{t('24h 成交额')}</span>
                <span className="ml-auto tabular-nums text-text-2">
                  {event.markets.every((m) => m.context.dayNtlVlm !== '')
                    ? display(
                        event.markets.reduce(
                          (sum, m) => sum + Number(m.context.dayNtlVlm),
                          0,
                        ),
                        2,
                      )
                    : '—'}{' '}
                  {event.markets[0].quote}
                </span>
              </div>
            </article>
          ))}
        </div>
        {!filtered.length && !model.catalogLoading && !model.catalogError && (
          <p className="py-20 text-center text-muted">{t('没有匹配的市场')}</p>
        )}
        {filtered.length > limit && (
          <div className="mt-6 text-center">
            <Button variant="bordered" onPress={() => setLimit((n) => n + 24)}>
              {t('加载更多')} ({filtered.length - limit})
            </Button>
          </div>
        )}
        <p className="mt-6 text-xs leading-5 text-muted">
          {t(
            '概率按当前价格展示；倍数为每份结算为 1 时的毛回报倍数，不代表保证收益。结算以各事件规则为准。',
          )}
        </p>
      </div>
    </section>
  )
}
