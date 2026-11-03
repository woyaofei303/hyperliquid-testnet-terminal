import { FlatSelect, Input, Slider } from '@fameex/ui'
import { t, useLocale } from '@/i18n'
import { HelpLabel } from './help-label'

/** 沿用 FameEX Amount / Slider 的输入框内单位选择和百分比刻度。 */
export function OrderAmount({
  base,
  quote,
  precision,
  unit,
  amount,
  percent,
  disabled,
  onAmount,
  onUnit,
  onPercent,
}: {
  base: string
  quote: string
  precision: number
  unit: 'base' | 'usdc'
  amount: string
  percent: number
  disabled: boolean
  onAmount: (value: string) => void
  onUnit: (value: 'base' | 'usdc') => void
  onPercent: (value: number) => void
}) {
  useLocale()

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <Input
        label={
          <HelpLabel
            label={
              unit === 'base'
                ? t('数量（') + base + t('）')
                : t('金额（') + quote + t('）')
            }
            description={t(
              '按所选单位输入数量或订单金额；金额会按参考价格换算并向下取整到市场允许精度。',
            )}
          />
        }
        size="md"
        value={amount}
        onChange={onAmount}
        placeholder={
          unit === 'usdc'
            ? t('输入订单金额')
            : precision === 0
              ? t('整数份数')
              : t('最多 ') + precision + t(' 位小数')
        }
        inputMode="decimal"
        autoComplete="off"
        inputClassName="min-w-0"
        endContent={
          <FlatSelect
            aria-label={t('数量单位')}
            value={unit}
            onChange={(value) => onUnit(value === 'usdc' ? 'usdc' : 'base')}
            items={[
              { key: 'base', label: base },
              { key: 'usdc', label: quote },
            ]}
            placement="bottom-end"
            className="!w-24"
            spanClassName="text-body-regular font-medium text-1"
          />
        }
      />
      <div className="relative h-8 w-full pt-1">
        <Slider
          label={t('下单比例')}
          minValue={0}
          maxValue={100}
          step={1}
          value={percent}
          onChange={(value) =>
            onPercent(Array.isArray(value) ? value[0] : value)
          }
          isDisabled={disabled}
          marks={[0, 25, 50, 75, 100].map((value) => ({
            value,
            label: value === 0 || value === 100 ? `${value}%` : '',
          }))}
          showTooltip
          tooltipContentFormat={(value) => `${Math.round(value)}%`}
        />
      </div>
    </div>
  )
}
