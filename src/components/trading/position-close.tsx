import { Button, Checkbox, FlatSelect, Input, Modal } from '@fameex/ui'
import { useState } from 'react'
import type { TerminalModel } from '@/hooks/use-terminal'
import { t, useLocale } from '@/i18n'
import type { AccountState } from '@/lib/hyperliquid'
import { baseName, quoteName } from '@/lib/market-catalog'
import { formatOrderPrice, Money } from '@/lib/orders'
import type { PositionActionKind } from '@/lib/position-actions'
import { HelpLabel } from './help-label'
import { OrderAmount } from './order-amount'

export type Position = AccountState['assetPositions'][number]['position']
export const positionActionLabels = {
  limit: '限价平仓',
  market: '市价平仓',
  trailing: '设置移动止损',
  reverse: '反向仓位',
} as const
export function PositionClose({
  position,
  model,
  onClose,
  kind,
}: {
  position: Position
  model: TerminalModel
  onClose: () => void
  kind: PositionActionKind
}) {
  useLocale()
  const [expected] = useState(position)
  const total = new Money(expected.szi).abs()
  const isLong = Number(expected.szi) > 0
  const reverseTone = isLong ? 'text-loss' : 'text-mint'
  const mark = new Money(position.positionValue)
    .div(new Money(position.szi).abs())
    .toFixed()
  const market = model.markets.find((m) => m.name === position.coin)
  const precision = market?.szDecimals ?? 5
  const [amount, setAmount] = useState(total.toFixed())
  const [unit, setUnit] = useState<'base' | 'usdc'>('base')
  const [price, setPrice] = useState(
    market ? formatOrderPrice(mark, market) : mark,
  )
  const [distance, setDistance] = useState('')
  const [distanceUnit, setDistanceUnit] = useState<'pct' | 'px'>('pct')
  const [activation, setActivation] = useState(false)
  const [activationPrice, setActivationPrice] = useState('')
  const [skip, setSkip] = useState(false)
  const [pending, setPending] = useState(false)
  let size = '',
    percent = 0
  try {
    const value = new Money(amount)
    size = (
      unit === 'base'
        ? value
        : value
            .div(kind === 'limit' ? price : mark)
            .toDecimalPlaces(precision, Money.ROUND_DOWN)
    ).toFixed()
    percent = new Money(size).div(total).times(100).toNumber()
  } catch {
    /* 未完成的输入等待提交校验。 */
  }
  const changed = position.szi !== expected.szi
  const valid =
    !changed &&
    (kind === 'reverse' ||
      (Number(size) > 0 && Number(size) <= total.toNumber())) &&
    (kind !== 'limit' || Number(price) > 0) &&
    (kind !== 'trailing' ||
      (Number(distance) > 0 && (!activation || Number(activationPrice) > 0)))
  async function submit() {
    setPending(true)
    try {
      if (
        await model.submitPosition(
          expected,
          {
            kind,
            size,
            price,
            retracement: distance,
            retracementUnit: distanceUnit,
            activationPrice: activation ? activationPrice : '',
          },
          skip,
        )
      )
        onClose()
    } finally {
      setPending(false)
    }
  }
  return (
    <Modal
      closeLabel={t('关闭')}
      title={t(positionActionLabels[kind])}
      onClose={onClose}
      busy={pending}
      className="max-w-[520px] [&_header]:text-center"
      footer={
        <Button
          className="w-full"
          color={
            kind === 'reverse' ? (isLong ? 'danger' : 'success') : 'primary'
          }
          isDisabled={!valid || pending || model.busy}
          onPress={() => void submit()}
        >
          {t(
            kind === 'reverse'
              ? isLong
                ? '卖出 / 做空'
                : '买入 / 做多'
              : kind === 'market'
                ? '市价平仓'
                : '确认',
          )}
        </Button>
      }
    >
      <PositionSummary position={position} />
      {kind === 'reverse' ? (
        <>
          <div className="flex justify-between text-sm">
            <HelpLabel label="反手" />
            <span className={reverseTone}>
              {t(isLong ? '多头 → 空头' : '空头 → 多头')}
            </span>
          </div>
          <div className="flex justify-between text-sm">
            <span>{t('委托数量')}</span>
            <span className={reverseTone}>
              {total.times(2).toFixed()} {position.coin}
            </span>
          </div>
          <p className="text-xs leading-5 text-muted">
            {t(
              '以市价平掉现有仓位并开立等量反向仓位，需要足够保证金；部分成交时最终仓位可能与目标不同。',
            )}
          </p>
        </>
      ) : (
        <>
          {kind === 'limit' && (
            <div>
              <Input
                label={<HelpLabel label="平仓价格" />}
                value={price}
                onChange={setPrice}
                inputMode="decimal"
              />
              <button
                type="button"
                className="mt-1 text-xs text-text-2 underline-offset-4 hover:text-ink hover:underline"
                onClick={() =>
                  market && setPrice(formatOrderPrice(mark, market))
                }
              >
                {t('使用标记价')}
              </button>
            </div>
          )}
          {kind === 'trailing' && (
            <>
              <Input
                label={<HelpLabel label="回撤距离" />}
                size="md"
                value={distance}
                onChange={setDistance}
                inputMode="decimal"
                inputClassName="min-w-0"
                isDisabled={pending}
                endContent={
                  <FlatSelect
                    aria-label={t('回撤单位')}
                    value={distanceUnit}
                    items={[
                      { key: 'pct', label: '%' },
                      { key: 'px', label: quoteName(market) },
                    ]}
                    onChange={(value) =>
                      setDistanceUnit(value === 'px' ? 'px' : 'pct')
                    }
                    isDisabled={pending}
                    placement="bottom-end"
                    className="!w-24"
                    spanClassName="text-body-regular font-medium text-1"
                  />
                }
              />
              <div className="flex gap-2">
                {[5, 10].map((v) => (
                  <Button
                    key={v}
                    size="sm"
                    variant="bordered"
                    onPress={() => {
                      setDistanceUnit('pct')
                      setDistance(String(v))
                    }}
                  >
                    {v}%
                  </Button>
                ))}
              </div>
            </>
          )}
          <OrderAmount
            base={market ? baseName(market) : position.coin}
            quote={quoteName(market)}
            precision={precision}
            unit={unit}
            amount={amount}
            percent={Math.min(100, Math.max(0, percent))}
            disabled={pending}
            onAmount={setAmount}
            onUnit={(value) => {
              setUnit(value)
              setAmount('')
            }}
            onPercent={(value) =>
              setAmount(
                total
                  .times(value)
                  .div(100)
                  .times(
                    unit === 'usdc' ? (kind === 'limit' ? price : mark) : 1,
                  )
                  .toDecimalPlaces(
                    unit === 'base' ? precision : 2,
                    Money.ROUND_DOWN,
                  )
                  .toFixed(),
              )
            }
          />
          {kind === 'trailing' && (
            <>
              <Checkbox isSelected={activation} onValueChange={setActivation}>
                <HelpLabel label="激活价格" />
              </Checkbox>
              {activation && (
                <Input
                  aria-label={t('激活价格')}
                  value={activationPrice}
                  onChange={setActivationPrice}
                  inputMode="decimal"
                />
              )}
              <p className="text-xs leading-5 text-muted">
                {t(
                  '由交易所跟踪最有利标记价，达到回撤距离后触发只减仓市价单。关闭页面不停止。',
                )}
              </p>
            </>
          )}
          <p className="text-xs text-muted">
            {t('只减仓已启用，不允许反向开仓。')}
          </p>
        </>
      )}
      {changed && (
        <p role="alert" className="text-xs text-loss">
          {t('仓位数量或方向已变化，请关闭后重新确认。')}
        </p>
      )}
      {(kind === 'market' || kind === 'reverse') && (
        <Checkbox isSelected={skip} onValueChange={setSkip}>
          {t('不再显示此消息')}
        </Checkbox>
      )}
    </Modal>
  )
}
export function PositionSummary({ position }: { position: Position }) {
  useLocale()
  return (
    <dl className="space-y-2 text-xs">
      {[
        ['市场', position.coin],
        [
          '当前仓位',
          `${new Money(position.szi).abs().toFixed()} ${position.coin}`,
        ],
        ['开仓均价', position.entryPx],
        [
          '标记价格',
          new Money(position.positionValue)
            .div(new Money(position.szi).abs())
            .toDecimalPlaces(6)
            .toFixed(),
        ],
        ['预估清算价', position.liquidationPx ?? 'N/A'],
      ].map(([label, value]) => (
        <div key={label} className="flex justify-between gap-4">
          <dt className="text-muted">
            <HelpLabel label={label} />
          </dt>
          <dd className="tabular-nums">{value}</dd>
        </div>
      ))}
    </dl>
  )
}
