import { Button, FlatSelect, Input, Tab, Tabs } from '@fameex/ui'
import { useState } from 'react'
import { useCashOrderForm } from '@/hooks/use-cash-order-form'
import type { TerminalModel } from '@/hooks/use-terminal'
import { t, useLocale } from '@/i18n'
import { display } from '@/lib/display'
import type { MarketContext } from '@/lib/hyperliquid'
import { baseName, quoteName } from '@/lib/market-catalog'
import { AccountTypeSetting } from './account-type-setting'
import { HelpLabel } from './help-label'
import { OrderAmount } from './order-amount'
import { OrderOptions } from './order-options'
import { OrderTypeSelector } from './order-type-selector'
import { OutcomeConversion } from './outcome-conversion'
import { SlippageSetting } from './slippage-setting'

export function CashOrderForm({
  model,
  market,
}: {
  model: TerminalModel
  market: MarketContext
}) {
  useLocale()
  const [converting, setConverting] = useState(false)

  const form = useCashOrderForm(model, market)
  const { fields: f, change } = form
  const onboarding = model.onboarding
  const outcome = market.kind === 'outcome'
  const base = outcome ? t('份') : baseName(market),
    quote = quoteName(market)
  const pair = model.markets.find((m) => m.name === market.paired)
  return (
    <section
      aria-label={t('下单面板')}
      className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto rounded-sm bg-panel p-3 [&>*]:shrink-0"
    >
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-sm font-medium">
          {outcome ? t('预测交易') : t('现货交易')}
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
          {market.question != null && (
            <FlatSelect
              aria-label={t('预测结果')}
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
            <summary className="cursor-pointer">{t('结算规则')}</summary>
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
      {outcome && (
        <Button
          size="sm"
          variant="bordered"
          onPress={() => setConverting(true)}
        >
          {t('转换结果')}
        </Button>
      )}
      <Tabs
        disableAnimation={false}
        aria-label={t('交易方向')}
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
        <Tab key="buy" title={t('买入')} />
        <Tab key="sell" title={t('卖出')} />
      </Tabs>
      <div className="flex justify-between text-xs text-muted">
        <span>
          <HelpLabel label="可用" />
        </span>
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
          label={
            <HelpLabel
              helpKey={
                f.kind === 'scale'
                  ? '最低价格'
                  : f.kind === 'chase'
                    ? '追价边界'
                    : '价格'
              }
              label={`${t(f.kind === 'scale' ? '最低价格' : f.kind === 'chase' ? (f.side === 'buy' ? '最高买入价' : '最低卖出价') : '价格')}${t('（')}${quote}${t('）')}`}
            />
          }
          value={f.price}
          onChange={(v) => change('price', v)}
          placeholder={outcome ? '0.00001 – 0.99999' : t('输入价格')}
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
        <span>
          <HelpLabel label="最大可下" />
        </span>
        <span>
          {form.max} {base}
        </span>
      </p>
      <OrderOptions form={form} quote={quote} />
      {f.kind === 'twap' && f.side === 'buy' && !f.twapLimit && (
        <p className="text-xs leading-5 text-muted">
          {t(
            '预算按当前价与触发价较高者加 3% 估算；后续价格上涨或余额变化时可能无法全部成交。可设置最高成交价。',
          )}
        </p>
      )}
      {outcome && (
        <p className="text-xs leading-5 text-muted">
          {t('每份结算价值范围为 0–1')}
          {quote}
          {t('，按该事件规则结算。卖出仅使用已持有份额。')}
        </p>
      )}
      {form.error && (
        <p role="alert" className="text-xs text-loss">
          {t(form.error)}
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
              : model.continueConnection()
            : void form.preview()
        }
      >
        {onboarding
          ? t(onboarding)
          : form.previewing
            ? t('核对可用余额…')
            : model.canTrade
              ? t('下单')
              : t('等待账户数据 / 核对未确认订单')}
      </Button>
      <dl
        aria-label={t('订单摘要')}
        className="space-y-2 border-t border-edge pt-3 text-xs"
      >
        <div className="flex justify-between gap-2">
          <dt className="text-muted">
            <HelpLabel label="订单金额" />
          </dt>
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
        {outcome && f.side === 'buy' && (
          <div className="flex justify-between gap-2">
            <dt className="text-muted">{t('若所选结果结算为 1')}</dt>
            <dd>
              {form.size || '—'} {quote}
            </dd>
          </div>
        )}
        <div className="flex justify-between gap-2">
          <dt className="text-muted">
            <HelpLabel label="预计手续费上限" />
          </dt>
          <dd>
            {form.estimatedFee} {quote}
          </dd>
        </div>
      </dl>
      {converting && (
        <OutcomeConversion
          key={model.address}
          model={model}
          market={market}
          onClose={() => setConverting(false)}
        />
      )}
    </section>
  )
}
