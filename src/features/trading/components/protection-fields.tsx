'use client'
import { FlatSelect, Input } from '@fameex/ui'
import { useEffect, useRef, useState } from 'react'
import { quoteName } from '@/features/market/lib/market-catalog'
import {
  formatOrderPrice,
  type Market,
  Money,
} from '@/features/trading/lib/orders'
import {
  protectionPrice,
  protectionReturn,
} from '@/features/trading/lib/position-actions'
import { t, useLocale } from '@/i18n'
import { HelpLabel } from '../../../shared/components/help-label'

export function ProtectionFields(props: {
  only?: 'tp' | 'sl'
  market: Market
  entry: string
  size: string
  leverage: number
  takeProfit: string
  stopLoss: string
  onTakeProfit: (value: string) => void
  onStopLoss: (value: string) => void
  onValidityChange?: (valid: boolean) => void
}) {
  const [validity, setValidity] = useState({ tp: true, sl: true })
  const callback = useRef(props.onValidityChange)
  callback.current = props.onValidityChange
  useEffect(() => callback.current?.(validity.tp && validity.sl), [validity])
  return (
    <div className="space-y-3">
      {(['tp', 'sl'] as const)
        .filter((kind) => !props.only || props.only === kind)
        .map((kind) => (
          <ProtectionRow
            key={kind}
            {...props}
            kind={kind}
            onValidityChange={(valid) =>
              setValidity((previous) =>
                previous[kind] === valid
                  ? previous
                  : { ...previous, [kind]: valid },
              )
            }
            price={kind === 'tp' ? props.takeProfit : props.stopLoss}
            onPrice={kind === 'tp' ? props.onTakeProfit : props.onStopLoss}
          />
        ))}
    </div>
  )
}
function ProtectionRow({
  market,
  entry,
  size,
  leverage,
  kind,
  price,
  onPrice,
  onValidityChange,
}: Parameters<typeof ProtectionFields>[0] & {
  kind: 'tp' | 'sl'
  price: string
  onPrice: (value: string) => void
}) {
  useLocale()
  const [unit, setUnit] = useState<'roe' | 'usd'>('roe')
  const [source, setSource] = useState<'price' | 'return'>('price')
  const [target, setTarget] = useState('')
  const change = useRef(onPrice)
  change.current = onPrice
  const loss = kind === 'sl'
  const calculationSize =
    unit === 'roe' ? (size.startsWith('-') ? '-1' : '1') : size
  const invalidTarget =
    source === 'return' &&
    target !== '' &&
    (!/^(\d+)(\.\d*)?$/.test(target) ||
      !Number.isFinite(Number(target)) ||
      Number(target) < 0)
  const invalidPrice =
    price !== '' &&
    (!/^(0|[1-9]\d*)(\.\d+)?$/.test(price) ||
      !Number.isFinite(Number(price)) ||
      Number(price) <= 0)
  let nextPrice = ''
  let invalidResult = false
  if (source === 'return' && target && !invalidTarget) {
    try {
      const value = protectionPrice(
        entry,
        calculationSize,
        leverage,
        new Money(target).times(loss ? -1 : 1).toFixed(),
        unit,
      )
      invalidResult = !new Money(value).isFinite() || new Money(value).lte(0)
      if (!invalidResult) nextPrice = formatOrderPrice(value, market)
    } catch {
      invalidResult = true
    }
  }
  const validity = useRef(onValidityChange)
  validity.current = onValidityChange
  useEffect(
    () => validity.current?.(!invalidTarget && !invalidPrice && !invalidResult),
    [invalidTarget, invalidPrice, invalidResult],
  )
  let calculated = ''
  try {
    if (
      price &&
      new Money(calculationSize).abs().gt(0) &&
      new Money(entry).gt(0)
    )
      calculated = new Money(
        protectionReturn(entry, calculationSize, leverage, price, unit),
      )
        .times(loss ? -1 : 1)
        .toFixed()
  } catch {
    /* 未完成输入时不显示估算。 */
  }
  useEffect(() => {
    if (
      source === 'return' &&
      !invalidTarget &&
      !invalidResult &&
      price !== nextPrice
    )
      change.current(nextPrice)
  }, [source, invalidTarget, invalidResult, price, nextPrice])
  const label = loss ? '止损价格' : '止盈价格'
  return (
    <div className="grid grid-cols-2 gap-2">
      <Input
        label={<HelpLabel label={label} />}
        size="md"
        inputMode="decimal"
        isInvalid={invalidPrice}
        errorMessage={t('请输入有效价格')}
        value={price}
        onChange={(value) => {
          setSource('price')
          onPrice(value)
        }}
      />
      <Input
        label={<HelpLabel label={loss ? '亏损' : '收益'} />}
        size="md"
        inputClassName="min-w-0"
        isDisabled={
          unit === 'roe'
            ? leverage <= 0
            : !Number.isFinite(Number(size)) || Number(size) === 0
        }
        isInvalid={invalidTarget || invalidResult}
        errorMessage={t(
          invalidResult ? '目标收益无法换算为有效价格' : '请输入非负数',
        )}
        inputMode="decimal"
        value={source === 'return' ? target : calculated}
        onChange={(value) => {
          setSource('return')
          setTarget(value)
        }}
        endContent={
          <FlatSelect
            aria-label={t(loss ? '亏损单位' : '收益单位')}
            value={unit}
            items={[
              { key: 'roe', label: '%' },
              { key: 'usd', label: quoteName(market) },
            ]}
            onChange={(value) => {
              setSource('price')
              setUnit(value === 'usd' ? 'usd' : 'roe')
            }}
            placement="bottom-end"
            className="!w-24"
            spanClassName="text-body-regular font-medium text-1"
          />
        }
      />
    </div>
  )
}
