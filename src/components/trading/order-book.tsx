import { ChartIcon, Select, Tab, Tabs } from '@fameex/ui'
import { useId, useMemo, useState } from 'react'
import { useBookRows } from '@/hooks/use-book-rows'
import { useDepthHover } from '@/hooks/use-depth-hover'
import type { TerminalModel } from '@/hooks/use-terminal'
import { t, useLocale } from '@/i18n'
import { display } from '@/lib/display'
import { transactionUrl } from '@/lib/explorer'
import { baseName, pricePrecision, quoteName } from '@/lib/market-catalog'
import { orderBookData } from '@/lib/order-book-data'
import { Money } from '@/lib/orders'
import { DepthTooltip } from './depth-tooltip'
import { HelpLabel } from './help-label'

export function OrderBook({ model }: { model: TerminalModel }) {
  useLocale()

  const { feed, coin, market } = model
  const rawDepth = useMemo(() => orderBookData(feed.book), [feed.book])
  const base =
    market?.kind === 'outcome' ? t('份') : market ? baseName(market) : coin
  const quote = quoteName(market)
  const priceDecimals = market ? pricePrecision(market) : 1
  const precision = market?.szDecimals ?? 5
  const [selectedStep, setSelectedStep] = useState({ coin: '', value: '' })
  const minimumPrice = rawDepth.bids.at(-1)?.px ?? rawDepth.asks[0]?.px
  const steps = Array.from({ length: 5 }, (_, index) =>
    new Money(10).pow(index - priceDecimals).toFixed(),
  ).filter((value) => !minimumPrice || new Money(value).lte(minimumPrice))
  const step =
    selectedStep.coin === coin && steps.includes(selectedStep.value)
      ? selectedStep.value
      : steps[0]
  // shortcut: 仅合并已接收的深度，需要更多流动性档位时再接入协议端聚合快照。
  const depth = useMemo(
    () =>
      step && step !== steps[0] ? orderBookData(feed.book, step) : rawDepth,
    [feed.book, step, steps[0], rawDepth],
  )
  const displayDecimals = step ? new Money(step).decimalPlaces() : priceDecimals
  const detail = useDepthHover(depth, coin)
  const tooltipId = useId()
  const hovered = (detail.hover?.side === 'buy' ? depth.bids : depth.asks).find(
    (row) => row.px === detail.hover?.price,
  )
  return (
    <section
      ref={detail.container}
      {...detail.events}
      className="flex h-[376px] min-h-0 flex-col overflow-hidden rounded-sm bg-panel md:h-[540px] lg:h-auto"
      aria-label={t('订单簿')}
    >
      <Tabs
        disableAnimation={false}
        onSelectionChange={detail.close}
        aria-label={t('盘口数据')}
        classNames={{
          base: 'shrink-0 border-b border-edge px-4',
          tabList: 'gap-4',
          tab: 'h-10',
          panel: 'flex min-h-0 flex-1 flex-col p-0',
        }}
      >
        <Tab key="book" title={t('订单簿')}>
          <div className="flex h-8 shrink-0 items-center justify-between gap-2 px-3">
            <span className="text-[11px] text-muted">{t('价格精度')}</span>
            <Select
              aria-label={t('订单簿价格精度')}
              items={steps.map((value) => ({ key: value, label: value }))}
              selectedKeys={step ? [step] : []}
              disallowEmptySelection
              isDisabled={!steps.length || !feed.book}
              selectorIcon={
                <ChartIcon name="arrow-drop-down" className="size-3" />
              }
              onSelectionChange={(keys) => {
                const value = steps.find(
                  (item) => keys !== 'all' && keys.has(item),
                )
                if (value) {
                  detail.close()
                  setSelectedStep({ coin, value })
                }
              }}
              className="w-28 shrink-0"
              classNames={{
                trigger: 'h-6 min-h-6 rounded px-2 !bg-surface',
                value: 'text-right text-xs text-ink',
                innerWrapper: 'pr-4',
                selectorIcon: 'right-1',
              }}
            />
          </div>
          <div className="grid h-8 shrink-0 grid-cols-3 items-center px-3 text-right text-[10px] text-muted">
            <span className="text-left">
              {t('价格 (')}
              {quote})
            </span>
            <span>
              <HelpLabel label="数量" /> ({base})
            </span>
            <span>
              <HelpLabel label="合计" /> ({base})
            </span>
          </div>
          <BookSide
            rows={depth.asks}
            opposite={depth.bids}
            side="sell"
            precision={precision}
            priceDecimals={displayDecimals}
            hovered={detail.hover}
            tooltipId={tooltipId}
            onPrice={model.selectBookPrice}
          />
          <div className="grid h-7 shrink-0 grid-cols-3 items-center bg-surface px-3 text-right text-[11px] tabular-nums">
            <span className="text-left text-muted">
              <HelpLabel label="价差" />
            </span>
            <span>
              {depth.spread == null
                ? '—'
                : Number(depth.spread).toLocaleString('en-US', {
                    maximumFractionDigits: priceDecimals,
                  })}
            </span>
            <span>{depth.percent == null ? '—' : `${depth.percent}%`}</span>
          </div>
          <BookSide
            rows={depth.bids}
            opposite={depth.asks}
            side="buy"
            precision={precision}
            priceDecimals={displayDecimals}
            hovered={detail.hover}
            tooltipId={tooltipId}
            onPrice={model.selectBookPrice}
          />
          <div className="flex shrink-0 items-center justify-between border-t border-edge px-4 py-2.5 text-[11px] text-muted">
            <span>
              <span className="text-mint">{t('买盘')}</span> /{' '}
              <span className="text-loss">{t('卖盘')}</span>
            </span>
            <span>
              {feed.stale ? t('等待深度更新') : t('快速前 5 档 · 深档快照')}
            </span>
          </div>
        </Tab>
        <Tab key="trades" title={t('最新成交')}>
          {feed.tradesError && (
            <p role="alert" className="px-4 py-2 text-xs text-loss">
              {t('成交数据异常：')}
              {feed.tradesError}
            </p>
          )}
          {/* 限制 sr-only 的绝对定位范围，避免长列表撑大整页。 */}
          <div className="relative min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain [scrollbar-gutter:stable]">
            <table
              aria-label={`${coin} ${t('最新成交')}`}
              className="w-full table-fixed whitespace-nowrap text-right text-[11px]"
            >
              <thead className="sticky top-0 z-10 bg-panel text-[10px] text-muted">
                <tr>
                  <th
                    title={`${t('价格')} (${quote})`}
                    className="truncate py-3 pl-3 text-left font-normal"
                  >
                    {t('价格（')}
                    {quote}）
                  </th>
                  <th
                    title={`${t('数量')} (${base})`}
                    className="truncate pl-1 pr-3 font-normal"
                  >
                    {t('数量（')}
                    {base}）
                  </th>
                  <th className="w-[30%] pr-1 font-normal">
                    {t('时间 (UTC)')}
                  </th>
                  <th className="w-6 pr-1">
                    <span className="sr-only">{t('链上交易')}</span>
                  </th>
                </tr>
              </thead>
              <tbody className="font-mono tabular-nums">
                {feed.trades.map((trade) => (
                  <tr key={trade.tid} className="h-6 hover:bg-surface">
                    <td
                      title={trade.px}
                      className={`truncate pl-3 text-left ${trade.side === 'B' ? 'text-mint' : 'text-loss'}`}
                    >
                      {trade.px}
                    </td>
                    <td title={trade.sz} className="truncate pl-1 pr-3">
                      {trade.sz}
                    </td>
                    <td className="pr-1 text-muted">
                      <time dateTime={new Date(trade.time).toISOString()}>
                        {new Date(trade.time).toISOString().slice(11, 19)}
                      </time>
                    </td>
                    <td className="pr-1">
                      {transactionUrl(trade.hash) && (
                        <a
                          href={transactionUrl(trade.hash) ?? undefined}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label={`${t('查看成交')} ${trade.tid} ${t('的链上交易（新窗口）')}`}
                          title={t('在浏览器查看交易')}
                          className="inline-flex size-5 items-center justify-center rounded text-muted hover:text-accent focus-visible:outline focus-visible:outline-accent"
                        >
                          <span className="sr-only">{t('链上交易')}</span>
                          <ChartIcon name="link-light" className="size-3.5" />
                        </a>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!feed.trades.length && (
              <p className="px-4 py-8 text-center text-xs text-muted">
                {feed.tradesLoading ? t('正在加载成交…') : t('暂无成交')}
              </p>
            )}
          </div>
          <div className="shrink-0 border-t border-edge px-4 py-2.5 text-[11px] text-muted">
            {feed.status === '实时连接'
              ? t('公开市场成交 · 最近 100 笔')
              : t('连接中断，正在恢复成交推送')}
          </div>
        </Tab>
      </Tabs>
      {detail.hover && hovered && (
        <DepthTooltip
          id={tooltipId}
          row={hovered}
          midpoint={depth.midpoint}
          coin={base}
          quote={quote}
          precision={precision}
          priceDecimals={priceDecimals}
          left={detail.hover.left}
          top={detail.hover.top}
        />
      )}
    </section>
  )
}
function BookSide({
  rows,
  opposite,
  side,
  precision,
  priceDecimals,
  hovered,
  tooltipId,
  onPrice,
}: {
  rows: ReturnType<typeof orderBookData>['bids']
  opposite: ReturnType<typeof orderBookData>['bids']
  side: 'buy' | 'sell'
  precision: number
  priceDecimals: number
  hovered: { side: string; price: string } | null
  tooltipId: string
  onPrice: (price: string) => void
}) {
  useLocale()

  const { container, count } = useBookRows()
  const visible = rows.slice(0, count)
  const maxTotal = Money.max(
    visible.at(-1)?.total ?? 0,
    opposite.slice(0, count).at(-1)?.total ?? 0,
    '0.00000001',
  )
  if (side === 'sell') visible.reverse()
  return (
    <div
      ref={container}
      className={`flex min-h-0 flex-1 flex-col overflow-hidden ${side === 'sell' ? 'justify-end' : ''}`}
      data-side={side}
    >
      {visible.map((row) => (
        <button
          type="button"
          aria-label={`${t(side === 'buy' ? '买盘' : '卖盘')} ${row.px} ${t('档位详情')}`}
          aria-describedby={
            hovered?.side === side && hovered.price === row.px
              ? tooltipId
              : undefined
          }
          key={row.px}
          data-price={row.px}
          onClick={() => onPrice(row.px)}
          data-in-range={
            hovered?.side === side &&
            (side === 'sell'
              ? new Money(row.px).lte(hovered.price)
              : new Money(row.px).gte(hovered.price))
          }
          data-hovered={hovered?.side === side && hovered.price === row.px}
          className={`relative grid grid-cols-3 items-center px-3 text-right font-mono text-xs tabular-nums data-[in-range=true]:bg-ink/5 focus-visible:outline focus-visible:outline-accent ${rows.length >= count ? 'min-h-6 flex-1' : 'h-6 shrink-0'}`}
        >
          {hovered?.side === side && hovered.price === row.px && (
            <span
              aria-hidden="true"
              data-hover-boundary={side}
              className={`pointer-events-none absolute inset-x-0 z-10 border-t border-dotted border-muted ${side === 'sell' ? 'top-0' : 'bottom-0'}`}
            />
          )}
          <span
            aria-hidden="true"
            className={`pointer-events-none absolute inset-y-px left-0 ${side === 'buy' ? 'bg-mint/15' : 'bg-loss/15'}`}
            style={{
              width: `${new Money(row.total).div(maxTotal).times(100).toNumber()}%`,
            }}
          />
          <span
            className={`relative text-left ${side === 'buy' ? 'text-mint' : 'text-loss'}`}
          >
            {Number(row.px).toLocaleString('en-US', {
              maximumFractionDigits: priceDecimals,
            })}
          </span>
          <span className="relative text-ink">
            {display(row.sz, precision)}
          </span>
          <span className="relative text-ink">
            {display(row.total, precision)}
          </span>
        </button>
      ))}
      {!visible.length && (
        <span className="m-auto text-xs text-muted">{t('暂无深度')}</span>
      )}
    </div>
  )
}
