import { Checkbox, Input, Select } from '@fameex/ui'
import { t, useLocale } from '@/i18n'
import type { OrderFormFields } from '@/lib/order-form-fields'

export function OrderOptions({
  form,
  quote,
}: {
  form: {
    fields: OrderFormFields
    change: <K extends keyof OrderFormFields>(
      key: K,
      value: OrderFormFields[K],
    ) => void
  }
  quote: string
}) {
  useLocale()

  const { fields: f, change } = form
  return (
    <>
      {(f.kind === 'limit' || f.kind === 'scale') && (
        <Select
          label={t('订单有效方式')}
          aria-label={t('订单有效方式')}
          selectedKeys={[f.tif]}
          items={[
            { key: 'Gtc', label: t('GTC · 撤销前有效') },
            { key: 'Ioc', label: t('IOC · 立即成交或取消') },
            { key: 'Alo', label: t('Post-only · 只挂单') },
          ]}
          onSelectionChange={(keys) => {
            const key = Array.from(keys)[0]
            change('tif', key === 'Alo' ? 'Alo' : key === 'Ioc' ? 'Ioc' : 'Gtc')
          }}
        />
      )}
      {f.kind === 'scale' && (
        <>
          <Input
            label={t('最高价格（') + quote + t('）')}
            value={f.upperPrice}
            onChange={(value) => change('upperPrice', value)}
            inputMode="decimal"
          />
          <Input
            label={t('阶梯档数（2–50）')}
            value={f.levels}
            onChange={(value) => change('levels', value)}
            inputMode="numeric"
          />
          <Select
            label={t('数量分配')}
            selectedKeys={[f.distribution]}
            items={[
              { key: 'equal', label: t('平均分配') },
              { key: 'increasing', label: t('随价格递增') },
              { key: 'decreasing', label: t('随价格递减') },
            ]}
            onSelectionChange={(keys) => {
              const key = Array.from(keys)[0]
              change(
                'distribution',
                key === 'increasing'
                  ? 'increasing'
                  : key === 'decreasing'
                    ? 'decreasing'
                    : 'equal',
              )
            }}
          />
        </>
      )}
      {f.kind === 'twap' && (
        <>
          <Input
            label={t('执行时长（分钟，5–10080）')}
            value={f.minutes}
            onChange={(value) => change('minutes', value)}
            inputMode="numeric"
          />
          <Checkbox
            isSelected={f.randomize}
            onValueChange={(value) => change('randomize', value)}
          >
            {t('随机执行')}
          </Checkbox>
          <Input
            label={t('TWAP 触发价（可选）')}
            value={f.twapTrigger}
            onChange={(value) => change('twapTrigger', value)}
            inputMode="decimal"
          />
          {f.twapTrigger && (
            <Select
              aria-label={t('TWAP 触发方向')}
              selectedKeys={[f.twapAbove ? 'above' : 'below']}
              items={[
                { key: 'above', label: t('标记价高于触发价') },
                { key: 'below', label: t('标记价低于触发价') },
              ]}
              onSelectionChange={(keys) =>
                change('twapAbove', Array.from(keys)[0] !== 'below')
              }
            />
          )}
          <Input
            label={
              f.side === 'buy'
                ? t('TWAP 最高成交价（可选）')
                : t('TWAP 最低成交价（可选）')
            }
            value={f.twapLimit}
            onChange={(value) => change('twapLimit', value)}
            inputMode="decimal"
          />
          <p className="text-[11px] leading-5 text-muted">
            {t('至少 100')}
            {quote}
            {t('；交易所执行，子单滑点上限 3%，可在 TWAP 列表停止。')}
          </p>
        </>
      )}
      {f.kind === 'trailing' && (
        <>
          <div className="flex items-end gap-2">
            <Input
              label={t('回撤距离')}
              value={f.retracement}
              onChange={(value) => change('retracement', value)}
              inputMode="decimal"
            />
            <Select
              aria-label={t('回撤单位')}
              selectedKeys={[f.retracementUnit]}
              items={[
                { key: 'pct', label: '%' },
                { key: 'px', label: quote },
              ]}
              onSelectionChange={(keys) =>
                change(
                  'retracementUnit',
                  Array.from(keys)[0] === 'px' ? 'px' : 'pct',
                )
              }
              className="w-24 shrink-0"
            />
          </div>
          <Input
            label={t('激活价格（可选）')}
            value={f.activationPrice}
            onChange={(value) => change('activationPrice', value)}
            inputMode="decimal"
          />
          <p className="text-[11px] leading-5 text-muted">
            {t('由交易所单向跟踪标记价，达到回撤距离后触发市价单。')}
          </p>
        </>
      )}
      {f.kind === 'chase' && (
        <p className="text-[11px] leading-5 text-muted">
          {t(
            '仅挂单并跟随最优报价。需要保持页面打开；数量和限价不会自动扩大。',
          )}
        </p>
      )}
    </>
  )
}
