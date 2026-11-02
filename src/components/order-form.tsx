'use client'
import { Button, Checkbox, Input, Tab, Tabs } from '@fameex/ui'
import type { ReactNode } from 'react'
import { useMarginSettings } from '@/hooks/use-margin-settings'
import { useOrderForm } from '@/hooks/use-order-form'
import { display } from '@/lib/display'
import type { Book, MarketContext } from '@/lib/hyperliquid'
import { baseName, quoteName } from '@/lib/market-catalog'
import type { Ticket } from '@/lib/order-ticket'
import { MarginSettings } from './trading/margin-settings'
import { OrderAmount } from './trading/order-amount'
import { OrderOptions } from './trading/order-options'
import { OrderTypeSelector } from './trading/order-type-selector'
import { SlippageSetting } from './trading/slippage-setting'

interface Props {
  market: MarketContext
  book: Book | null
  stale: boolean
  enabled: boolean
  onboarding: string | null
  onOnboarding: () => void
  busy: boolean
  address: `0x${string}` | null
  refreshAt: number
  position: string
  onTicket: (ticket: Ticket) => void
  onLeverage: (value: number, isCross: boolean) => void
  accountType: ReactNode
}
export function OrderForm({
  market,
  book,
  stale,
  enabled,
  onboarding,
  onOnboarding,
  busy,
  address,
  refreshAt,
  position,
  onTicket,
  onLeverage,
  accountType,
}: Props) {
  const quote = quoteName(market)
  const base = baseName(market)
  const settings = useMarginSettings({
    market,
    address,
    refreshAt,
    onApply: onLeverage,
  })
  const form = useOrderForm({
    market,
    book,
    stale,
    current: settings.current,
    position,
    onTicket,
  })
  const { fields: f, change } = form
  const basic = f.kind === 'limit' || f.kind === 'market'
  const showPrice =
    f.kind === 'limit' ||
    f.kind.endsWith('-limit') ||
    f.kind === 'chase' ||
    f.kind === 'scale'
  return (
    <section
      className="flex h-full min-h-0 flex-col overflow-y-auto rounded-sm bg-panel p-3 [&>*]:shrink-0"
      aria-label="下单面板"
    >
      <h2 className="sr-only">交易 {base}</h2>
      <MarginSettings
        market={market}
        settings={settings}
        enabled={enabled}
        busy={busy}
        accountType={accountType}
      />
      <div className="mb-3">
        <OrderTypeSelector
          market={market}
          value={f.kind}
          onChange={form.setKind}
        />
      </div>
      <Tabs
        disableAnimation={false}
        aria-label="交易方向"
        variant="solid"
        selectedKey={f.side}
        onSelectionChange={(key) =>
          change('side', key === 'sell' ? 'sell' : 'buy')
        }
        classNames={{
          base: 'mb-3 w-full',
          tabList: 'h-9 w-full gap-1 rounded-lg bg-cc-3 p-1',
          tab: 'h-7 max-w-none flex-1 rounded-m p-0',
          cursor: `w-full rounded-m shadow-none ${f.side === 'buy' ? 'bg-sem-g dark:bg-sem-g' : 'bg-sem-r dark:bg-sem-r'}`,
          tabContent: `px-0 py-0 text-body-regular text-3 group-data-[selected=true]:font-semibold ${f.side === 'sell' ? 'group-data-[selected=true]:text-white' : 'group-data-[selected=true]:text-6'}`,
        }}
      >
        <Tab key="buy" title="买入 / 做多" />
        <Tab key="sell" title="卖出 / 做空" />
      </Tabs>
      <div className="mb-3 space-y-1 text-xs">
        <div className="flex justify-between">
          <span className="text-muted">可用保证金</span>
          <span>
            {display(form.available)} {quote}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted">当前仓位</span>
          <span>
            {position} {base}
          </span>
        </div>
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          form.preview()
        }}
        className="flex flex-1 flex-col gap-3"
      >
        {(f.kind.startsWith('stop-') || f.kind.startsWith('take-')) && (
          <Input
            label={`触发价格（${quote}）`}
            value={f.trigger}
            onChange={(value) => change('trigger', value)}
            inputMode="decimal"
          />
        )}
        {showPrice && (
          <div className="grid gap-1.5">
            <div className="flex items-center justify-between text-xs">
              <label htmlFor="order-price" className="text-muted">
                {f.kind === 'scale'
                  ? `最低价格（${quote}）`
                  : f.kind === 'chase'
                    ? f.side === 'buy'
                      ? `最高买入价（${quote}）`
                      : `最低卖出价（${quote}）`
                    : `价格（${quote}）`}
              </label>
              <Button
                variant="light"
                type="button"
                onPress={form.applyMarkPrice}
                className="text-accent hover:text-ink"
              >
                使用标记价
              </Button>
            </div>
            <Input
              id="order-price"
              aria-label={`价格（${quote}）`}
              size="md"
              value={f.price}
              onChange={(value) => change('price', value)}
              endContent={<span className="text-xs text-muted">{quote}</span>}
              inputMode="decimal"
              autoComplete="off"
            />
          </div>
        )}
        <OrderAmount
          base={base}
          quote={quote}
          precision={market.szDecimals}
          unit={f.unit}
          amount={f.amount}
          percent={form.percent}
          disabled={!settings.current || form.maxSize === '0'}
          onAmount={(value) => change('amount', value)}
          onUnit={form.setUnit}
          onPercent={form.setPercent}
        />
        <p className="flex justify-between text-[11px] text-muted">
          <span>{f.reduceOnly ? '可减仓数量' : '最大可下'}</span>
          <span>{settings.current ? `${form.maxSize} ${base}` : '—'}</span>
        </p>
        <OrderOptions form={form} quote={quote} />
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          <Checkbox
            isSelected={f.reduceOnly}
            onValueChange={(value) => change('reduceOnly', value)}
          >
            <span className="text-xs text-muted">只减仓 Reduce-only</span>
          </Checkbox>
          {basic && !f.reduceOnly && (
            <Checkbox
              isSelected={f.protection}
              onValueChange={(value) => change('protection', value)}
            >
              <span className="text-xs text-muted">止盈 / 止损</span>
            </Checkbox>
          )}
        </div>
        {basic && f.protection && !f.reduceOnly && (
          <div className="grid gap-2">
            <Input
              label={`止盈触发价（${quote}，可选）`}
              value={f.takeProfit}
              onChange={(value) => change('takeProfit', value)}
              inputMode="decimal"
            />
            <Input
              label={`止损触发价（${quote}，可选）`}
              value={f.stopLoss}
              onChange={(value) => change('stopLoss', value)}
              inputMode="decimal"
            />
          </div>
        )}
        {form.error && (
          <p role="alert" className="text-xs leading-5 text-loss">
            {form.error}
          </p>
        )}
        <Button
          variant="solid"
          color={!enabled ? 'primary' : f.side === 'buy' ? 'success' : 'danger'}
          type={onboarding ? 'button' : 'submit'}
          onPress={onboarding ? onOnboarding : undefined}
          isDisabled={
            busy ||
            (!onboarding &&
              (!enabled ||
                stale ||
                !settings.current ||
                !!form.reduceOnlyError))
          }
          className="mt-auto min-h-9 w-full text-sm font-semibold"
        >
          {busy
            ? '操作处理中…'
            : onboarding
              ? onboarding
              : !enabled
                ? '等待账户数据 / 核对未确认订单'
                : stale
                  ? '等待实时行情'
                  : !settings.current
                    ? '读取下单额度…'
                    : form.reduceOnlyError || '下单'}
        </Button>
        <dl
          aria-label="订单摘要"
          className="space-y-2 border-t border-edge pt-3 text-xs"
        >
          {[
            ['订单价值', form.notional],
            ['预计初始保证金', form.margin],
          ].map(([label, value]) => (
            <div key={label} className="flex justify-between gap-2">
              <dt className="text-muted">{label}</dt>
              <dd className="text-right tabular-nums">
                {value} {quote}
              </dd>
            </div>
          ))}
          {f.kind === 'market' && (
            <SlippageSetting
              value={f.slippage}
              onChange={(value) => change('slippage', value)}
            />
          )}
          {f.kind.endsWith('-market') && (
            <div className="flex justify-between gap-2">
              <dt className="text-muted">最大滑点</dt>
              <dd>10%</dd>
            </div>
          )}
          <div className="flex justify-between gap-2">
            <dt className="text-muted">预计手续费</dt>
            <dd className="text-right tabular-nums">
              {form.fee} {quote}
            </dd>
          </div>
        </dl>
        {form.feeError && <p className="text-xs text-muted">费率暂不可用。</p>}
      </form>
    </section>
  )
}
