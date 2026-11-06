'use client'

import { Button, FlatSelect, Input, Tab, Tabs } from '@fameex/ui'
import Link from 'next/link'
import { useMemo, useState } from 'react'
import type { TerminalModel } from '@/hooks/use-terminal'
import { t } from '@/i18n'
import { display } from '@/lib/display'
import { predictionEvents } from '@/lib/market-catalog'

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
      className="min-h-0 flex-1 overflow-auto bg-background"
    >
      <div className="mx-auto max-w-[1440px] px-4 py-8 md:px-8">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="text-3xl font-semibold">{t('预测市场')}</h2>
            <p className="mt-2 text-sm text-muted">
              {t('选择事件与结果，使用测试网资产参与预测。')}
            </p>
          </div>
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
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.slice(0, limit).map((event) => (
            <article
              key={event.id}
              className="flex min-h-60 flex-col rounded-lg border border-edge bg-panel p-5"
            >
              <div className="mb-5 flex items-start justify-between gap-3">
                <h3 className="min-w-0 break-words text-base font-medium">
                  <Link
                    className="hover:text-accent"
                    href={`/?market=${encodeURIComponent(event.markets[0].name)}`}
                  >
                    {event.title}
                  </Link>
                </h3>
                {event.venue && (
                  <span
                    className="max-w-24 truncate rounded bg-accent/10 px-2 py-1 text-[11px] text-accent"
                    title={event.venue}
                  >
                    {event.venue}
                  </span>
                )}
              </div>
              <div className="max-h-52 space-y-2 overflow-y-auto">
                {event.markets.map((m) => {
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
                      className="flex items-center justify-between gap-4 rounded-md px-2 py-2 text-sm hover:bg-surface focus-visible:outline focus-visible:outline-accent"
                    >
                      <span className="min-w-0 break-words">
                        {label}
                        <small className="ml-2 whitespace-nowrap text-muted">
                          {valid ? `${(1 / price).toFixed(2)}x` : '—'}
                        </small>
                      </span>
                      <span className="min-w-16 rounded-md border border-accent/40 px-3 py-2 text-center tabular-nums text-accent">
                        {valid ? `${display(price * 100, 1)}%` : '—'}
                      </span>
                    </Link>
                  )
                })}
              </div>
              <div className="mt-auto flex justify-between gap-2 border-t border-edge pt-3 text-xs text-muted">
                <span>
                  {t('24h 成交额')}{' '}
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
                <span>
                  {event.markets.length} {t('个选项')}
                </span>
              </div>
            </article>
          ))}
        </div>
        {!filtered.length && (
          <p className="py-20 text-center text-muted">
            {t(model.catalogLoading ? '正在加载预测市场…' : '没有匹配的市场')}
          </p>
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
