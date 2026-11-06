import { Button, FlatSelect, Modal } from '@fameex/ui'
import { useEffect, useState } from 'react'
import type { TerminalModel } from '@/hooks/use-terminal'
import { t, useLocale } from '@/i18n'
import { display } from '@/lib/display'
import { isCash, pricePrecision, quoteName } from '@/lib/market-catalog'
import { fundingCountdown, marketSummary } from '@/lib/market-summary'
import { HelpLabel } from './help-label'
import { MarketSelector } from './market-selector'
export function MarketHeader({ model }: { model: TerminalModel }) {
  useLocale()

  const [rules, setRules] = useState(false)
  const { coin, market } = model
  const summary = marketSummary(market?.context)
  const priceDecimals = market ? pricePrecision(market) : 1
  return (
    <section
      id="market-panel"
      aria-label={t('市场概览')}
      className="flex h-16 shrink-0 items-center gap-5 overflow-x-auto border-b border-edge px-3"
    >
      <div className="flex shrink-0 items-center gap-2">
        <MarketSelector model={model} />
      </div>
      {market?.kind === 'outcome' && (
        <>
          {market.question != null && (
            <FlatSelect
              aria-label={t('预测结果')}
              className="!w-44 shrink-0"
              value={`#${(market.outcome ?? 0) * 10}`}
              onChange={(name) =>
                model.selectMarket(
                  `#${Number(name.slice(1)) + ((market.asset - 100000000) % 10)}`,
                )
              }
              items={model.markets
                .filter(
                  (m) =>
                    m.question === market.question &&
                    m.kind === 'outcome' &&
                    (m.asset - 100000000) % 10 === 0 &&
                    !m.settled,
                )
                .map((m) => ({ key: m.name, label: m.outcomeTitle ?? m.name }))}
            />
          )}
          <Button size="sm" variant="bordered" onPress={() => setRules(true)}>
            {t('详情')}
          </Button>
          {rules && (
            <Modal
              title={t('结算规则')}
              onClose={() => setRules(false)}
              closeLabel={t('关闭')}
            >
              <p className="text-sm">{market.eventTitle ?? market.label}</p>
              <p className="max-h-80 overflow-auto whitespace-pre-wrap break-words text-sm leading-6 text-muted">
                {market.description}
              </p>
            </Modal>
          )}
        </>
      )}
      <Metric
        label={isCash(market) ? t('市场价格') : t('标记价格')}
        value={
          market?.context.markPx
            ? display(market.context.markPx, priceDecimals)
            : '—'
        }
        description={
          isCash(market)
            ? t('交易所返回的市场参考价格')
            : t('用于未实现盈亏与清算计算的标记价格')
        }
      />
      {!isCash(market) && (
        <Metric
          label={t('预言机价格')}
          value={display(market?.context.oraclePx, priceDecimals)}
          description={t('验证者汇总的外部现货参考价格')}
        />
      )}
      <Metric
        label={t('24h 涨跌')}
        value={
          summary?.changePercent != null
            ? `${Number(summary.change) >= 0 ? '+' : ''}${display(summary.change, priceDecimals)} / ${Number(summary.changePercent) >= 0 ? '+' : ''}${summary.changePercent ?? '—'}%`
            : '—'
        }
        tone={summary && Number(summary.change) < 0 ? 'text-loss' : 'text-mint'}
        description={t('当前标记价格相对 24 小时前价格的变化')}
      />
      <Metric
        label={t('24h 成交额')}
        value={
          market?.context.dayNtlVlm
            ? `${display(market.context.dayNtlVlm, 0)} ${quoteName(market)}`
            : '—'
        }
      />
      {!isCash(market) && (
        <>
          <Metric
            label={t('持仓量')}
            value={
              summary?.interestUsd
                ? `${display(summary.interestUsd, 0)} ${quoteName(market)}`
                : '—'
            }
            description={
              market
                ? '' +
                  display(market.context.openInterest, market.szDecimals) +
                  ' ' +
                  coin +
                  t(' · 按标记价格折算')
                : undefined
            }
          />
          <Metric
            label={t('资金费率 / 倒计时')}
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
            description={t(
              '每小时结算；正费率多方支付空方，负费率空方支付多方',
            )}
          />
        </>
      )}
    </section>
  )
}
function FundingClock() {
  useLocale()

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
  useLocale()

  return (
    <dl className="shrink-0 whitespace-nowrap">
      <dt
        className={`mb-1 text-[11px] text-muted ${description ? 'cursor-help decoration-muted/40 underline decoration-dotted underline-offset-4' : ''}`}
      >
        <HelpLabel
          label={label}
          description={description ? t(description) : undefined}
        />
      </dt>
      <dd className={`text-xs font-medium tabular-nums ${tone}`}>{value}</dd>
    </dl>
  )
}
