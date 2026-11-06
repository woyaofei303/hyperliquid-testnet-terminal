import { Button, FlatSelect, Input, Tab, Tabs } from '@fameex/ui'
import { useState } from 'react'
import { useCashOrderForm } from '@/hooks/use-cash-order-form'
import type { TerminalModel } from '@/hooks/use-terminal'
import { t, useLocale } from '@/i18n'
import { display } from '@/lib/display'
import type { MarketContext } from '@/lib/hyperliquid'
import { Money } from '@/lib/orders'
import { HelpLabel } from './help-label'
import { OrderAmount } from './order-amount'
import { OutcomeConversion } from './outcome-conversion'
import { SlippageSetting } from './slippage-setting'

export function PredictionOrderForm({
  model,
  market,
}: {
  model: TerminalModel
  market: MarketContext
}) {
  useLocale()
  const form = useCashOrderForm(model, market)
  const { fields: f, change } = form
  const [converting, setConverting] = useState(false)
  const quote = market.quote ?? 'USDC'
  const selected = (market.asset - 100000000) % 10
  const base = market.base ?? (selected === 0 ? 'Yes' : 'No')
  const outcomes = [
    market,
    ...model.markets.filter((m) => m.name === market.paired),
  ].sort((a, b) => a.asset - b.asset)
  const onboarding = model.onboarding
  return (
    <section
      aria-label={t('下单面板')}
      className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto rounded-sm bg-panel p-3 [&>*]:shrink-0"
    >
      <div className="flex items-center justify-between border-b border-edge">
        <Tabs
          aria-label={t('交易方向')}
          selectedKey={f.side}
          onSelectionChange={(key) =>
            change('side', key === 'sell' ? 'sell' : 'buy')
          }
        >
          <Tab key="buy" title={t('买入')} />
          <Tab key="sell" title={t('卖出')} />
        </Tabs>
        <FlatSelect
          aria-label={t('预测订单类型')}
          value={f.kind}
          className="!w-28"
          onChange={(key) => {
            if (key === 'convert') setConverting(true)
            else if (key === 'market' || key === 'limit' || key === 'scale')
              form.setKind(key)
          }}
          items={[
            { key: 'market', label: t('市价') },
            { key: 'limit', label: t('限价') },
            { key: 'scale', label: t('分段订单') },
            { key: 'convert', label: t('转换') },
          ]}
        />
      </div>
      <fieldset
        aria-label={t('预测方向')}
        className="grid grid-cols-2 gap-1 rounded-lg bg-cc-3 p-1"
      >
        {outcomes.map((item) => {
          const side =
            item.base ?? ((item.asset - 100000000) % 10 === 0 ? 'Yes' : 'No')
          const price = new Money(
            item.context.markPx ||
              (market.context.markPx
                ? new Money(1).minus(market.context.markPx).toFixed()
                : 0),
          )
          const multiplier =
            price.gt(0) && price.lt(1)
              ? new Money(1).div(price).toFixed(2)
              : '—'
          return (
            <button
              type="button"
              key={item.name}
              aria-label={side}
              aria-pressed={item.name === market.name}
              className={`h-8 rounded-m text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-accent ${item.name === market.name ? 'bg-accent text-white' : 'text-muted hover:text-ink'}`}
              onClick={() => {
                if (item.name !== market.name) model.selectMarket(item.name)
              }}
            >
              {side} {multiplier}x
            </button>
          )
        })}
      </fieldset>
      <div className="flex justify-between text-xs">
        <span className="text-muted">
          <HelpLabel label="可用" />
        </span>
        <span>
          {form.balances
            ? display(
                f.side === 'buy' ? form.balances.quote : form.balances.base,
                6,
              )
            : '—'}{' '}
          {f.side === 'buy' ? quote : base}
        </span>
      </div>
      {f.kind === 'limit' && (
        <Input
          label={`${t('价格（')}${quote}${t('）')}`}
          value={f.price}
          onChange={(v) => change('price', v)}
          inputMode="decimal"
          endContent={
            <button
              type="button"
              className="text-xs text-accent"
              onClick={() => {
                const book = model.feed.book
                const bid = book?.levels[0][0]?.px,
                  ask = book?.levels[1][0]?.px
                const mid =
                  bid && ask
                    ? new Money(bid)
                        .plus(ask)
                        .div(2)
                        .toDecimalPlaces(5)
                        .toFixed()
                    : market.context.markPx
                if (mid) change('price', mid)
              }}
            >
              Mid
            </button>
          }
        />
      )}
      <OrderAmount
        base={base}
        quote={quote}
        precision={0}
        unit={f.unit}
        amount={f.amount}
        percent={form.percent}
        editablePercent
        disabled={!form.ready || form.max === '0'}
        onAmount={(v) => change('amount', v)}
        onUnit={form.setUnit}
        onPercent={form.setPercent}
      />
      {f.kind === 'scale' && (
        <div className="grid grid-cols-2 gap-3">
          <Input
            label={t('开始价格（USDC）')}
            value={f.price}
            onChange={(v) => change('price', v)}
            inputMode="decimal"
          />
          <Input
            label={t('结束价格（USDC）')}
            value={f.upperPrice}
            onChange={(v) => change('upperPrice', v)}
            inputMode="decimal"
          />
          <Input
            label={t('总订单数（2–50）')}
            value={f.levels}
            onChange={(v) => change('levels', v)}
            inputMode="numeric"
          />
          <Input
            label={
              <HelpLabel
                label="数量偏差"
                description={t(
                  '1 表示等量；2 表示最后一单的目标数量为第一单的 2 倍，份额按整数取整。',
                )}
              />
            }
            value={f.sizeSkew}
            onChange={(v) => change('sizeSkew', v)}
            inputMode="decimal"
          />
        </div>
      )}
      {f.kind !== 'market' && (
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted">
            <HelpLabel label="订单有效方式" />
          </span>
          <FlatSelect
            aria-label={t('订单有效方式')}
            value={f.tif}
            className="!w-36"
            items={[
              { key: 'Gtc', label: 'GTC' },
              { key: 'Ioc', label: 'IOC' },
              { key: 'Alo', label: 'Post-only' },
            ]}
            onChange={(key) =>
              change(
                'tif',
                key === 'Ioc' ? 'Ioc' : key === 'Alo' ? 'Alo' : 'Gtc',
              )
            }
          />
        </div>
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
            (!f.amount ||
              !model.canTrade ||
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
            : t('下单')}
      </Button>
      <dl
        aria-label={t('订单摘要')}
        className="space-y-2 border-t border-edge pt-3 text-xs"
      >
        <div className="flex justify-between">
          <dt className="text-muted">
            <HelpLabel label="订单价值" />
          </dt>
          <dd>{form.notional === '—' ? 'N/A' : `${form.notional} ${quote}`}</dd>
        </div>
        {f.kind === 'market' && (
          <SlippageSetting
            value={f.slippage}
            estimate={model.feed.stale ? 'N/A' : form.estimatedSlippage}
            onChange={(v) => change('slippage', v)}
          />
        )}
        {f.side === 'buy' && (
          <div className="flex justify-between">
            <dt className="text-muted">
              {t('若为')} {base} {t('的派付')}
            </dt>
            <dd>
              {form.notional !== '—' && form.size
                ? `${form.size} ${quote}`
                : t('不适用')}
            </dd>
          </div>
        )}
        <div className="flex justify-between">
          <dt className="text-muted">
            <HelpLabel
              label="费用"
              description={t(
                '吃单 / 挂单费率。买入预测份额不收费；卖出和结算按市场及账户费率扣费。派付显示扣除结算费用前的金额。',
              )}
            />
          </dt>
          <dd>
            {form.rates
              ? `${new Money(form.rates.taker).times(100).toFixed(4)}% / ${new Money(form.rates.maker).times(100).toFixed(4)}%`
              : '— / —'}
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
