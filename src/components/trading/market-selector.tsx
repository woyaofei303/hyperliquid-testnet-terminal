import { Button, ChartIcon, Input, SmartPopover, Tab, Tabs } from '@fameex/ui'
import { useReducedMotion } from 'framer-motion'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { TerminalModel } from '@/hooks/use-terminal'
import { t, useLocale } from '@/i18n'
import { display } from '@/lib/display'
import { baseName, marketLabel, pricePrecision } from '@/lib/market-catalog'
import { marketSummary } from '@/lib/market-summary'
import { notify } from '../notifications'
import { CoinIcon } from './coin-icon'

export function MarketSelector({ model }: { model: TerminalModel }) {
  useLocale()

  const reduceMotion = useReducedMotion()
  return (
    <SmartPopover
      triggerLabel={t('交易市场')}
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
          <CoinIcon
            coin={
              model.market?.kind === 'outcome'
                ? ''
                : model.market
                  ? baseName(model.market)
                  : model.coin
            }
            className="size-7"
          />
          <span className="truncate">
            {model.market ? marketLabel(model.market) : model.coin}
          </span>
          {model.market?.kind !== 'spot' &&
            model.market?.kind !== 'outcome' && (
              <span className="rounded bg-surface px-1 text-[10px] text-text-2">
                {model.market?.maxLeverage ?? '—'}x
              </span>
            )}
          <ChartIcon
            name="arrow-drop-down"
            className={`size-4 shrink-0 transition-transform duration-150 motion-reduce:transition-none ${isOpen ? 'rotate-180' : ''}`}
          />
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
  useLocale()

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
  function saveFavorites(next: string[]) {
    try {
      localStorage.setItem('hl-favorite-markets', JSON.stringify(next))
      setFavorites(next)
      reset()
    } catch {
      notify('error', t('无法保存自选，请允许浏览器本地存储后重试。'))
    }
  }
  const hasFavorites = model.markets.some((m) => favorites.includes(m.name))
  const popularMarkets = model.markets.filter(
    (m) =>
      m.kind === 'perp' &&
      !m.dex &&
      [
        'BTC',
        'ETH',
        'SOL',
        'HYPE',
        'BNB',
        'XRP',
        'DOGE',
        'AVAX',
        'LINK',
        'SUI',
      ].includes(m.name),
  )
  const start = Math.max(0, Math.floor(offset / 40) - 3)
  return (
    <section
      aria-label={t('市场选择器')}
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
          aria-label={t('搜索市场')}
          placeholder={t('搜索币种、交易对或预测事件')}
          value={query}
          onChange={(v) => {
            setQuery(v)
            reset()
          }}
        />
      </div>
      <Tabs
        aria-label={t('市场分类')}
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
          ['all', t('所有')],
          ['favorites', t('自选')],
          ['perp', t('合约')],
          ['spot', t('现货')],
          ['outcome', t('预测')],
          ['hip3', 'HIP-3'],
          ['hip4', 'HIP-4'],
        ].map(([key, label]) => (
          <Tab key={key} title={t(label)} />
        ))}
      </Tabs>
      {!hasFavorites && popularMarkets.length > 0 && (
        <div className="flex items-center justify-between gap-2 border-b border-edge px-3 py-2">
          <span className="text-xs text-muted">{t('暂无自选')}</span>
          <Button
            size="sm"
            variant="light"
            className="h-7 text-xs text-accent"
            onPress={() => {
              saveFavorites(
                [
                  ...new Set([
                    ...favorites,
                    ...popularMarkets.map((m) => m.name),
                  ]),
                ].slice(-500),
              )
              setCategory('favorites')
              setQuery('')
            }}
          >
            {t('一键自选主流币对')}
          </Button>
        </div>
      )}
      {model.catalogError && (
        <p role="alert" className="px-3 py-2 text-xs text-loss">
          {t('扩展市场加载失败：')}
          {model.catalogError}
        </p>
      )}
      <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.2fr)] gap-2 overflow-y-auto py-3 pl-8 pr-3 text-right text-xs text-muted [scrollbar-gutter:stable]">
        <span className="-ml-5 text-left">{t('市场')}</span>
        {[
          ['price', t('最新价格')],
          ['change', t('24h 涨跌')],
          ['volume', t('24h 成交额')],
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
            {t(label)}
            {sort === key ? (descending ? ' ↓' : ' ↑') : ''}
          </button>
        ))}
      </div>
      <div
        ref={scroller}
        className="min-h-0 h-80 overflow-auto [scrollbar-gutter:stable]"
        onScroll={(event) => setOffset(event.currentTarget.scrollTop)}
        role="listbox"
        aria-label={t('市场列表')}
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
                aria-label={`${t(favorites.includes(m.name) ? '取消收藏' : '收藏')} ${marketLabel(m)}`}
                aria-pressed={favorites.includes(m.name)}
                className="group mr-2 flex size-4 shrink-0 items-center justify-center text-muted hover:text-sem-y aria-pressed:text-sem-y"
                onClick={() => {
                  const next = favorites.includes(m.name)
                    ? favorites.filter((v) => v !== m.name)
                    : [...favorites, m.name].slice(-500)
                  saveFavorites(next)
                }}
              >
                <svg
                  aria-hidden="true"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinejoin="round"
                  className="size-3.5 fill-none group-aria-pressed:fill-current"
                >
                  <path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9L12 3Z" />
                </svg>
              </button>
              <button
                type="button"
                role="option"
                aria-selected={model.coin === m.name}
                aria-label={marketLabel(m)}
                onClick={() => select(m.name)}
                className="grid h-full min-w-0 flex-1 grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.2fr)] items-center gap-2 text-right text-xs tabular-nums focus-visible:outline focus-visible:outline-accent"
              >
                <span
                  className="flex min-w-0 items-center gap-2 text-left"
                  title={marketLabel(m)}
                >
                  <CoinIcon coin={m.kind === 'outcome' ? '' : baseName(m)} />
                  <span className="truncate">
                    {marketLabel(m)}
                    <small className="ml-1 text-muted">
                      {m.kind === 'perp'
                        ? `${m.maxLeverage}x${m.dex ? ` · ${m.dex}` : ''}`
                        : m.kind === 'spot'
                          ? t('现货')
                          : t('预测')}
                    </small>
                  </span>
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
          <p className="p-8 text-center text-sm text-muted">
            {t('没有匹配的市场')}
          </p>
        )}
      </div>
      <p className="border-t border-edge px-3 py-2 text-[11px] text-muted">
        {rows.length}{' '}
        {t('个市场 · HIP-3 为独立部署合约，HIP-4 为预测市场 · Esc 关闭')}
      </p>
    </section>
  )
}
