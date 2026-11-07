import { useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { TerminalModel } from '@/hooks/use-terminal'
import { t, useLocale } from '@/i18n'
import {
  depthAtDistance,
  depthChartScale,
  depthStepPath,
} from '@/lib/depth-chart'
import { display } from '@/lib/display'
import { baseName, pricePrecision, quoteName } from '@/lib/market-catalog'
import { orderBookData } from '@/lib/order-book-data'
import { ChartTradingContext } from './chart-trade-lines'

export function DepthChart() {
  const model = useContext(ChartTradingContext)
  return model ? <DepthPlot key={model.coin} model={model} /> : null
}

function DepthPlot({ model }: { model: TerminalModel }) {
  useLocale()
  const { feed, market, coin } = model
  const base =
    market?.kind === 'outcome' ? t('份') : market ? baseName(market) : coin
  const quote = quoteName(market)
  const priceDecimals = market ? pricePrecision(market) : 1
  const precision = market?.szDecimals ?? 5
  const container = useRef<HTMLElement>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [hover, setHover] = useState<number | null>(null)
  // shortcut: 只绘制现有盘口的最多 20 档，需要更宽价格范围时再接入聚合深度。
  const depth = useMemo(() => orderBookData(feed.book), [feed.book])
  const scale = depthChartScale(depth, priceDecimals)
  useEffect(() => {
    const element = container.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => {
      setSize({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      })
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  const left = 12
  const top = 32
  const width = Math.max(1, size.width - left - 64)
  const bottom = Math.max(top + 1, size.height - 30)
  const height = bottom - top
  const x = (price: number) =>
    left +
    (((price - (scale?.midpoint ?? 0)) / (scale?.radius ?? 1) + 1) * width) / 2
  const y = (total: number) =>
    bottom - (total / (scale?.maxTotal ?? 1)) * height
  const sides = [
    { name: '买盘', rows: depth.bids, color: 'text-mint' },
    { name: '卖盘', rows: depth.asks, color: 'text-loss' },
  ] as const
  const points = sides.map((side) => ({
    ...side,
    row:
      scale && hover !== null
        ? depthAtDistance(side.rows, scale.midpoint, hover * scale.radius)
        : undefined,
  }))
  const compact = (value: number) =>
    value.toLocaleString('en-US', {
      notation: 'compact',
      maximumFractionDigits: 2,
    })
  return (
    <section
      ref={container}
      aria-label={t('市场深度图')}
      className="absolute inset-0 overflow-hidden bg-panel text-xs tabular-nums"
    >
      <div className="pointer-events-none absolute inset-x-3 top-2 flex items-center justify-between gap-2 text-[11px] text-muted">
        <div className="flex gap-3">
          {sides.map((side) => (
            <span key={side.name} className={side.color}>
              ● {t(side.name)}
            </span>
          ))}
        </div>
        <span>
          {t('累计挂单')} ({base})
        </span>
      </div>
      {scale && size.width > 0 ? (
        <>
          <svg
            width={size.width}
            height={size.height}
            role="img"
            aria-label={t('买卖累计深度')}
            className="block text-muted"
          >
            <title>{t('买卖累计深度')}</title>
            {[0, 1, 2, 3, 4].map((index) => {
              const total = (scale.maxTotal * index) / 4
              return (
                <g key={index}>
                  <line
                    x1={left}
                    x2={left + width}
                    y1={y(total)}
                    y2={y(total)}
                    className="stroke-edge"
                    strokeOpacity={index === 0 ? 1 : 0.35}
                  />
                  <text
                    x={left + width + 8}
                    y={y(total)}
                    dominantBaseline="middle"
                    fill="currentColor"
                    className="text-[10px]"
                  >
                    {compact(total)}
                  </text>
                </g>
              )
            })}
            <line
              x1={x(scale.midpoint)}
              x2={x(scale.midpoint)}
              y1={top}
              y2={bottom}
              className="stroke-edge"
            />
            {sides.map((side) => {
              const path = depthStepPath(side.rows, x, y, bottom)
              return (
                <g key={side.name} className={side.color}>
                  <path d={path.area} fill="currentColor" fillOpacity={0.1} />
                  <path
                    data-depth-side={side.name === '买盘' ? 'buy' : 'sell'}
                    d={path.line}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={1.5}
                    strokeLinejoin="round"
                  />
                </g>
              )
            })}
            {(size.width < 600 ? [-1, 0, 1] : [-1, -0.5, 0, 0.5, 1]).map(
              (offset) => {
                const price = scale.midpoint + offset * scale.radius
                return (
                  <text
                    key={offset}
                    x={x(price)}
                    y={bottom + 19}
                    textAnchor={
                      offset === -1 ? 'start' : offset === 1 ? 'end' : 'middle'
                    }
                    fill="currentColor"
                    className="text-[10px]"
                  >
                    {display(price, priceDecimals)}
                  </text>
                )
              },
            )}
            {points.map(
              ({ name, row, color }) =>
                row && (
                  <g key={name} className={color}>
                    <line
                      x1={x(Number(row.px))}
                      x2={x(Number(row.px))}
                      y1={top}
                      y2={bottom}
                      className="stroke-muted"
                      strokeDasharray="4 4"
                    />
                    <circle
                      cx={x(Number(row.px))}
                      cy={y(Number(row.total))}
                      r={4}
                      fill="currentColor"
                    />
                  </g>
                ),
            )}
          </svg>
          <div
            role="slider"
            tabIndex={0}
            aria-label={t('深度图价格范围')}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round((hover ?? 0) * 100)}
            aria-valuetext={points
              .filter(({ row }) => row)
              .map(
                ({ name, row }) =>
                  `${t(name)} ${t('委托价格')} ${display(row?.px, priceDecimals)}, ${t('累计挂单')} ${display(row?.total, precision)} ${base}`,
              )
              .join('; ')}
            className="absolute cursor-crosshair touch-pan-y focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
            style={{ left, top, width, height }}
            onPointerMove={(event) => {
              const bounds = event.currentTarget.getBoundingClientRect()
              setHover(
                Math.min(
                  1,
                  Math.abs(
                    ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
                  ),
                ),
              )
            }}
            onPointerLeave={() => setHover(null)}
            onFocus={() => setHover(0.5)}
            onBlur={() => setHover(null)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setHover(null)
              else if (
                [
                  'ArrowLeft',
                  'ArrowDown',
                  'ArrowRight',
                  'ArrowUp',
                  'Home',
                  'End',
                ].includes(event.key)
              ) {
                event.preventDefault()
                setHover((value) =>
                  event.key === 'Home'
                    ? 0
                    : event.key === 'End'
                      ? 1
                      : Math.max(
                          0,
                          Math.min(
                            1,
                            (value ?? 0.5) +
                              (['ArrowLeft', 'ArrowDown'].includes(event.key)
                                ? -0.05
                                : 0.05),
                          ),
                        ),
                )
              }
            }}
          />
          {points.map(({ name, row, color }, index) => {
            if (!row) return null
            const tooltipWidth = Math.min(184, width / 2 - 12)
            const pointX = x(Number(row.px))
            const minLeft = left + (index * width) / 2
            const tooltipLeft = Math.max(
              minLeft,
              Math.min(
                minLeft + width / 2 - tooltipWidth,
                index === 0 ? pointX + 12 : pointX - tooltipWidth - 12,
              ),
            )
            return (
              <div
                key={name}
                role="tooltip"
                aria-label={t(name)}
                className="pointer-events-none absolute rounded bg-surface/95 p-2 text-[11px] leading-5 text-ink shadow-lg"
                style={{
                  left: tooltipLeft,
                  top: Math.max(
                    top,
                    Math.min(bottom - 80, y(Number(row.total)) - 40),
                  ),
                  width: tooltipWidth,
                }}
              >
                <dl>
                  <div className="flex justify-between gap-1">
                    <dt className="text-muted">{t('价差幅度')}</dt>
                    <dd className={color}>
                      {display(
                        (Math.abs(Number(row.px) - scale.midpoint) /
                          scale.midpoint) *
                          100,
                        2,
                      )}
                      %
                    </dd>
                  </div>
                  <div className="flex justify-between gap-1">
                    <dt className="shrink-0 text-muted">{t('委托价格')}</dt>
                    <dd>{display(row.px, priceDecimals)}</dd>
                  </div>
                  <div className="flex justify-between gap-1">
                    <dt className="shrink-0 text-muted">{t('累计挂单')}</dt>
                    <dd>{display(row.total, precision)}</dd>
                  </div>
                </dl>
              </div>
            )
          })}
          <span className="absolute bottom-1 right-2 text-[10px] text-muted">
            {quote}
          </span>
        </>
      ) : (
        <output className="absolute inset-0 flex items-center justify-center text-muted">
          {feed.book ? t('暂无深度数据') : t('正在加载深度数据…')}
        </output>
      )}
      {feed.stale && feed.book && (
        <output className="pointer-events-none absolute left-3 top-9 rounded bg-panel/95 px-2 py-1 text-[11px] text-amber-200">
          {t('深度数据已过期，等待更新')}
        </output>
      )}
    </section>
  )
}
