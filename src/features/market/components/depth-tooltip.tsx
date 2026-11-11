import { createPortal } from 'react-dom'
import type { orderBookData } from '@/features/market/lib/order-book-data'
import { Money } from '@/features/trading/lib/orders'
import { t, useLocale } from '@/i18n'
import { display } from '@/shared/lib/display'
export function DepthTooltip({
  id,
  row,
  midpoint,
  coin,
  quote,
  priceDecimals,
  precision,
  left,
  top,
}: {
  id: string
  row: ReturnType<typeof orderBookData>['bids'][number]
  midpoint: string | null
  coin: string
  quote: string
  priceDecimals: number
  precision: number
  left: number
  top: number
}) {
  useLocale()

  const distance = midpoint
    ? `${new Money(row.px)
        .minus(midpoint)
        .abs()
        .div(midpoint)
        .times(100)
        .toFixed(4)}%`
    : '—'
  return createPortal(
    <div
      id={id}
      role="tooltip"
      aria-label={t('档位详情')}
      className="pointer-events-none fixed left-0 top-0 z-50 w-[228px] max-w-[calc(100vw-16px)] rounded bg-surface p-3 text-xs shadow-xl transition-transform duration-150 ease-out motion-reduce:transition-none"
      style={{ transform: `translate3d(${left}px, ${top}px, 0)` }}
    >
      <dl className="grid grid-cols-2 gap-y-2 tabular-nums">
        <dt>{t('距中间价')}</dt>
        <dd className="text-right font-medium">{distance}</dd>
        <dt>{t('平均价格')}</dt>
        <dd className="text-right font-medium">
          {display(row.average, priceDecimals)}
        </dd>
        <dt>
          {t('合计（')}
          {coin}）
        </dt>
        <dd className="text-right font-medium">
          {display(row.total, precision)}
        </dd>
        <dt>
          {t('合计（')}
          {quote}）
        </dt>
        <dd className="text-right font-medium">{display(row.totalQuote, 2)}</dd>
      </dl>
    </div>,
    document.body,
  )
}
