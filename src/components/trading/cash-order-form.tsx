import { Button, Input, Tab, Tabs } from '@fameex/ui'
import { useCashOrderForm } from '@/hooks/use-cash-order-form'
import type { TerminalModel } from '@/hooks/use-terminal'
import { display } from '@/lib/display'
import type { MarketContext } from '@/lib/hyperliquid'
import { baseName, quoteName } from '@/lib/market-catalog'
import { AccountTypeSetting } from './account-type-setting'
import { OrderAmount } from './order-amount'
import { OrderOptions } from './order-options'
import { OrderTypeSelector } from './order-type-selector'
import { SlippageSetting } from './slippage-setting'

export function CashOrderForm({
  model,
  market,
}: {
  model: TerminalModel
  market: MarketContext
}) {
  const form = useCashOrderForm(model, market)
  const { fields: f, change } = form
  const onboarding = model.onboarding
  const outcome = market.kind === 'outcome'
  const base = outcome ? '份' : baseName(market),
    quote = quoteName(market)
  const pair = model.markets.find((m) => m.name === market.paired)
  return (
    <section
      aria-label="下单面板"
      className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto rounded-sm bg-panel p-3 [&>*]:shrink-0"
    >
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-sm font-medium">
          {outcome ? '预测交易' : '现货交易'}
        </h2>
        <div className="flex w-24">
          <AccountTypeSetting
            key={model.address}
            mode={model.account.snapshot?.mode ?? null}
            connected={!!model.wallet}
            busy={model.busy}
            onApply={model.changeAccountType}
          />
        </div>
      </div>
      {outcome && (
        <>
          <p className="text-sm leading-5">{market.label}</p>
          <div className="flex gap-2">
            <Button size="sm" className="flex-1" isDisabled>
              {market.base}
            </Button>
            {pair && (
              <Button
                size="sm"
                variant="bordered"
                className="flex-1"
                onPress={() => model.selectMarket(pair.name)}
              >
                {pair.base}
              </Button>
            )}
          </div>
          <details className="text-xs text-muted">
            <summary className="cursor-pointer">结算规则</summary>
            <p className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words leading-5">
              {market.description}
            </p>
          </details>
        </>
      )}
      <OrderTypeSelector
        market={market}
        value={f.kind}
        onChange={form.setKind}
      />
      <Tabs
        disableAnimation={false}
        aria-label="交易方向"
        variant="solid"
        selectedKey={f.side}
        onSelectionChange={(key) =>
          change('side', key === 'sell' ? 'sell' : 'buy')
        }
        classNames={{
          base: 'w-full',
          tabList: 'h-9 w-full gap-1 rounded-lg bg-cc-3 p-1',
          tab: 'h-7 max-w-none flex-1 rounded-m p-0',
          cursor: `w-full rounded-m shadow-none ${f.side === 'buy' ? 'bg-sem-g dark:bg-sem-g' : 'bg-sem-r dark:bg-sem-r'}`,
          tabContent: `px-0 py-0 text-body-regular text-3 group-data-[selected=true]:font-semibold ${f.side === 'sell' ? 'group-data-[selected=true]:text-white' : 'group-data-[selected=true]:text-6'}`,
        }}
      >
        <Tab key="buy" title="买入" />
        <Tab key="sell" title="卖出" />
      </Tabs>
      <div className="flex justify-between text-xs text-muted">
        <span>可用</span>
        <span className="text-ink">
          {form.balances
            ? display(
                f.side === 'buy' ? form.balances.quote : form.balances.base,
                6,
              )
            : '—'}{' '}
          {f.side === 'buy' ? quote : base}
        </span>
      </div>
      {['limit', 'scale', 'chase'].includes(f.kind) && (
        <Input
          label={`${f.kind === 'scale' ? '最低价格' : f.kind === 'chase' ? (f.side === 'buy' ? '最高买入价' : '最低卖出价') : '价格'}（${quote}）`}
          value={f.price}
          onChange={(v) => change('price', v)}
          placeholder={outcome ? '0.00001 – 0.99999' : '输入价格'}
          endContent={quote}
        />
      )}
      <OrderAmount
        base={base}
        quote={quote}
        precision={market.szDecimals}
        unit={f.unit}
        amount={f.amount}
        percent={form.percent}
        disabled={!form.ready || form.max === '0'}
        onAmount={(value) => change('amount', value)}
        onUnit={form.setUnit}
        onPercent={form.setPercent}
      />
      <p className="flex justify-between text-xs text-muted">
        <span>最大可下</span>
        <span>
          {form.max} {base}
        </span>
      </p>
      <OrderOptions form={form} quote={quote} />
      {f.kind === 'twap' && f.side === 'buy' && !f.twapLimit && (
        <p className="text-xs leading-5 text-muted">
          预算按当前价与触发价较高者加 3%
          估算；后续价格上涨或余额变化时可能无法全部成交。可设置最高成交价。
        </p>
      )}
      {outcome && (
        <p className="text-xs leading-5 text-muted">
          每份结算价值范围为 0–1 {quote}
          ，按该事件规则结算。卖出仅使用已持有份额。
        </p>
      )}
      {form.error && (
        <p role="alert" className="text-xs text-loss">
          {form.error}
        </p>
      )}
      <Button
        className="mt-auto w-full"
        isDisabled={
          model.busy ||
          (!onboarding &&
            (!model.canTrade ||
              !form.ready ||
              model.feed.stale ||
              form.previewing))
        }
        onPress={() =>
          onboarding
            ? !model.wallet
              ? model.connect()
              : model.previewApproval()
            : void form.preview()
        }
      >
        {onboarding ??
          (form.previewing
            ? '核对可用余额…'
            : model.canTrade
              ? '下单'
              : '等待账户数据 / 核对未确认订单')}
      </Button>
      <dl
        aria-label="订单摘要"
        className="space-y-2 border-t border-edge pt-3 text-xs"
      >
        <div className="flex justify-between gap-2">
          <dt className="text-muted">订单金额</dt>
          <dd>
            {form.notional} {quote}
          </dd>
        </div>
        {f.kind === 'market' && (
          <SlippageSetting
            value={f.slippage}
            onChange={(value) => change('slippage', value)}
          />
        )}
        <div className="flex justify-between gap-2">
          <dt className="text-muted">预计手续费上限</dt>
          <dd>
            {form.estimatedFee} {quote}
          </dd>
        </div>
      </dl>
    </section>
  )
}
