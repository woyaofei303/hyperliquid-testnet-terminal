import { Input, SmartPopover, Tab, Tabs } from '@fameex/ui'
import { useReducedMotion } from 'framer-motion'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { TerminalModel } from '@/hooks/use-terminal'
import { display } from '@/lib/display'
import { marketLabel, pricePrecision } from '@/lib/market-catalog'
import { marketSummary } from '@/lib/market-summary'

export function MarketSelector({ model }: { model: TerminalModel }) {
  const reduceMotion = useReducedMotion()
  return (
    <SmartPopover
      triggerLabel="交易市场"
      placement="bottom-start"
      offset={12}
      disableAnimation={Boolean(reduceMotion)}
      classNames={{ base: 'max-h-[inherit]' }}
      motionProps={{
        className: 'max-h-[inherit]',
        variants: {
          initial: { opacity: 0, y: -6 },
          enter: {
            opacity: 1,
            y: 0,
            transition: { duration: 0.16, ease: 'easeOut' },
          },
          exit: {
            opacity: 0,
            y: -4,
            transition: { duration: 0.12, ease: 'easeIn' },
          },
        },
      }}
      closeOnContentClick={false}
      shouldCloseOnScroll={false}
      contentClassName="max-h-[inherit] w-[min(800px,calc(100vw-24px))] items-stretch overflow-hidden rounded-lg border border-edge bg-surface p-0 text-ink shadow-2xl"
      content={({ closePopover }) => (
        <MarketList model={model} close={closePopover} />
      )}
    >
      {({ isOpen }) => (
        <span className="flex max-w-60 items-center gap-2 py-2 text-lg font-semibold">
          <span className="truncate">
            {model.market ? marketLabel(model.market) : model.coin}
          </span>
          {model.market?.kind !== 'spot' &&
            model.market?.kind !== 'outcome' && (
              <span className="rounded bg-accent/10 px-1 text-[10px] text-accent">
                {model.market?.maxLeverage ?? '—'}x
              </span>
            )}
          <svg
            aria-hidden="true"
            className={`size-4 shrink-0 transition-transform duration-150 motion-reduce:transition-none ${isOpen ? 'rotate-180' : ''}`}
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
          >
            <path d="m5 8 5 5 5-5" />
          </svg>
        </span>
      )}
    </SmartPopover>
  )
}
function MarketList({
  model,
  close,
}: {
  model: TerminalModel
  close: () => void
}) {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('all')
  const [sort, setSort] = useState<'volume' | 'change' | 'price'>('volume')
  const [descending, setDescending] = useState(true)
  const [favorites, setFavorites] = useState<string[]>([])
  const [offset, setOffset] = useState(0)
  const search = useRef<HTMLInputElement>(null)
  useEffect(() => {
    search.current?.focus()
  }, [])
  const scroller = useRef<HTMLDivElement>(null)
  useEffect(() => {
    try {
      const saved: unknown = JSON.parse(
        localStorage.getItem('hl-favorite-markets') ?? '[]',
      )
      if (Array.isArray(saved))
        setFavorites(
          saved.filter((s): s is string => typeof s === 'string').slice(0, 500),
        )
    } catch {
      /* 无效收藏按空列表处理。 */
    }
  }, [])
  const rows = useMemo(
    () =>
      model.markets
        .filter((m) => {
          if (category === 'favorites' && !favorites.includes(m.name))
            return false
          if (category === 'perp' && m.kind !== 'perp') return false
          if (category === 'spot' && m.kind !== 'spot') return false
          if (
            (category === 'outcome' || category === 'hip4') &&
            m.kind !== 'outcome'
          )
            return false
          if (category === 'hip3' && !m.dex) return false
          return `${marketLabel(m)} ${m.name} ${m.dex ?? ''}`
            .toLowerCase()
            .includes(query.trim().toLowerCase())
        })
        .sort((a, b) => {
          const value = (m: typeof a) =>
            sort === 'price'
              ? Number(m.context.markPx)
              : sort === 'change'
                ? Number(marketSummary(m.context)?.changePercent)
                : Number(m.context.dayNtlVlm)
          return (
            (value(a) - value(b)) * (descending ? -1 : 1) || a.asset - b.asset
          )
        }),
    [model.markets, category, query, sort, descending, favorites],
  )
  function reset() {
    setOffset(0)
    scroller.current?.scrollTo(0, 0)
  }
  function select(name: string) {
    model.selectMarket(name)
    close()
  }
  const start = Math.max(0, Math.floor(offset / 40) - 3)
  return (
    <section
      aria-label="市场选择器"
      className="flex min-h-0 max-h-[min(580px,80dvh)] flex-col"
    >
      <div className="p-3">
        <Input
          ref={search}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault()
              scroller.current
                ?.querySelector<HTMLButtonElement>('[role=option]')
                ?.focus()
            } else if ('continuePropagation' in event) {
              event.continuePropagation()
            }
          }}
          aria-label="搜索市场"
          placeholder="搜索币种、交易对或预测事件"
          value={query}
          onChange={(v) => {
            setQuery(v)
            reset()
          }}
        />
      </div>
      <Tabs
        aria-label="市场分类"
        selectedKey={category}
        onSelectionChange={(key) => {
          setCategory(String(key))
          reset()
        }}
        classNames={{
          base: 'border-b border-edge px-3',
          tabList: 'gap-5',
          tab: 'h-9',
        }}
      >
        {[
          ['all', '所有'],
          ['favorites', '自选'],
          ['perp', '合约'],
          ['spot', '现货'],
          ['outcome', '预测'],
          ['hip3', 'HIP-3'],
          ['hip4', 'HIP-4'],
        ].map(([key, label]) => (
          <Tab key={key} title={label} />
        ))}
      </Tabs>
      {model.catalogError && (
        <p role="alert" className="px-3 py-2 text-xs text-loss">
          扩展市场加载失败：{model.catalogError}
        </p>
      )}
      <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.2fr)] gap-2 overflow-y-auto py-3 pl-8 pr-3 text-right text-xs text-muted [scrollbar-gutter:stable]">
        <span className="-ml-5 text-left">市场</span>
        {[
          ['price', '最新价格'],
          ['change', '24h 涨跌'],
          ['volume', '24h 成交额'],
        ].map(([key, label]) => (
          <button
            key={key}
            type="button"
            className="min-w-0 truncate text-right"
            onClick={() => {
              setSort(key as typeof sort)
              setDescending(sort === key ? !descending : true)
              reset()
            }}
          >
            {label}
            {sort === key ? (descending ? ' ↓' : ' ↑') : ''}
          </button>
        ))}
      </div>
      <div
        ref={scroller}
        className="min-h-0 h-80 overflow-auto [scrollbar-gutter:stable]"
        onScroll={(event) => setOffset(event.currentTarget.scrollTop)}
        role="listbox"
        aria-label="市场列表"
      >
        <div style={{ height: start * 40 }} />
        {rows.slice(start, start + 20).map((m) => {
          const summary = marketSummary(m.context)
          return (
            <div
              key={m.name}
              className="flex h-10 items-center px-3 hover:bg-ink/5"
            >
              <button
                type="button"
                aria-label={`${favorites.includes(m.name) ? '取消收藏' : '收藏'} ${marketLabel(m)}`}
                className="mr-2 w-3 shrink-0 text-muted hover:text-accent"
                onClick={() => {
                  const next = favorites.includes(m.name)
                    ? favorites.filter((v) => v !== m.name)
                    : [...favorites, m.name].slice(-500)
                  setFavorites(next)
                  localStorage.setItem(
                    'hl-favorite-markets',
                    JSON.stringify(next),
                  )
                }}
              >
                {favorites.includes(m.name) ? '★' : '☆'}
              </button>
              <button
                type="button"
                role="option"
                aria-selected={model.coin === m.name}
                aria-label={marketLabel(m)}
                onClick={() => select(m.name)}
                className="grid h-full min-w-0 flex-1 grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.2fr)] items-center gap-2 text-right text-xs tabular-nums focus-visible:outline focus-visible:outline-accent"
              >
                <span className="truncate text-left" title={marketLabel(m)}>
                  {marketLabel(m)}
                  <small className="ml-1 text-accent">
                    {m.kind === 'perp'
                      ? `${m.maxLeverage}x${m.dex ? ` · ${m.dex}` : ''}`
                      : m.kind === 'spot'
                        ? '现货'
                        : '预测'}
                  </small>
                </span>
                <span className="truncate">
                  {m.context.markPx
                    ? display(m.context.markPx, pricePrecision(m))
                    : '—'}
                </span>
                <span
                  className={
                    Number(summary?.changePercent) < 0
                      ? 'text-loss'
                      : 'text-mint'
                  }
                >
                  {summary?.changePercent == null
                    ? '—'
                    : `${summary.changePercent}%`}
                </span>
                <span className="truncate">
                  {m.context.dayNtlVlm ? display(m.context.dayNtlVlm, 0) : '—'}{' '}
                  <small className="text-muted">{m.quote}</small>
                </span>
              </button>
            </div>
          )
        })}
        <div style={{ height: Math.max(0, rows.length - start - 20) * 40 }} />
        {!rows.length && (
          <p className="p-8 text-center text-sm text-muted">没有匹配的市场</p>
        )}
      </div>
      <p className="border-t border-edge px-3 py-2 text-[11px] text-muted">
        {rows.length} 个市场 · HIP-3 为独立部署合约，HIP-4 为预测市场 · Esc 关闭
      </p>
    </section>
  )
}
