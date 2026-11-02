import { useEffect, useState } from 'react'
import type { TerminalModel } from '@/hooks/use-terminal'
import { display } from '@/lib/display'
import { isCash, pricePrecision, quoteName } from '@/lib/market-catalog'
import { fundingCountdown, marketSummary } from '@/lib/market-summary'
import { MarketSelector } from './market-selector'
export function MarketHeader({ model }: { model: TerminalModel }) {
  const { coin, market } = model
  const summary = marketSummary(market?.context)
  const priceDecimals = market ? pricePrecision(market) : 1
  return (
    <section
      id="market-panel"
      aria-label="市场概览"
      className="flex h-16 shrink-0 items-center gap-5 overflow-x-auto border-b border-edge px-3"
    >
      <div className="flex shrink-0 items-center gap-2">
        <span
          aria-hidden="true"
          className="flex size-7 shrink-0 items-center justify-center rounded-full border border-accent/25 bg-brand/15 text-base font-semibold text-accent"
        >
          {coin.slice(0, 1)}
        </span>
        <MarketSelector model={model} />
      </div>
      <Metric
        label={isCash(market) ? '市场价格' : '标记价格'}
        value={
          market?.context.markPx
            ? display(market.context.markPx, priceDecimals)
            : '—'
        }
        description={
          isCash(market)
            ? '交易所返回的市场参考价格'
            : '用于未实现盈亏与清算计算的标记价格'
        }
      />
      {!isCash(market) && (
        <Metric
          label="预言机价格"
          value={display(market?.context.oraclePx, priceDecimals)}
          description="验证者汇总的外部现货参考价格"
        />
      )}
      <Metric
        label="24h 涨跌"
        value={
          summary?.changePercent != null
            ? `${Number(summary.change) >= 0 ? '+' : ''}${display(summary.change, priceDecimals)} / ${Number(summary.changePercent) >= 0 ? '+' : ''}${summary.changePercent ?? '—'}%`
            : '—'
        }
        tone={summary && Number(summary.change) < 0 ? 'text-loss' : 'text-mint'}
        description="当前标记价格相对 24 小时前价格的变化"
      />
      <Metric
        label="24h 成交额"
        value={
          market?.context.dayNtlVlm
            ? `${display(market.context.dayNtlVlm, 0)} ${quoteName(market)}`
            : '—'
        }
      />
      {!isCash(market) && (
        <>
          <Metric
            label="持仓量"
            value={
              summary?.interestUsd
                ? `${display(summary.interestUsd, 0)} ${quoteName(market)}`
                : '—'
            }
            description={
              market
                ? `${display(market.context.openInterest, market.szDecimals)} ${coin} · 按标记价格折算`
                : undefined
            }
          />
          <Metric
            label="资金费率 / 倒计时"
            value={
              <>
                <span
                  className={
                    summary && Number(summary.funding) < 0
                      ? 'text-loss'
                      : 'text-mint'
                  }
                >
                  {summary?.funding != null ? `${summary.funding}%` : '—'}
                </span>
                <span className="text-muted">
                  {' '}
                  / <FundingClock />
                </span>
              </>
            }
            description="每小时结算；正费率多方支付空方，负费率空方支付多方"
          />
        </>
      )}
    </section>
  )
}
function FundingClock() {
  const [time, setTime] = useState<number | null>(null)
  useEffect(() => {
    setTime(Date.now())
    const timer = window.setInterval(() => setTime(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])
  return <span>{time === null ? '—' : fundingCountdown(time)}</span>
}
function Metric({
  label,
  value,
  tone = 'text-ink',
  description,
}: {
  label: string
  value: React.ReactNode
  tone?: string
  description?: string
}) {
  return (
    <dl className="shrink-0 whitespace-nowrap" title={description}>
      <dt
        className={`mb-1 text-[11px] text-muted ${description ? 'cursor-help decoration-muted/40 underline decoration-dotted underline-offset-4' : ''}`}
      >
        {label}
      </dt>
      <dd className={`text-xs font-medium tabular-nums ${tone}`}>{value}</dd>
    </dl>
  )
}
