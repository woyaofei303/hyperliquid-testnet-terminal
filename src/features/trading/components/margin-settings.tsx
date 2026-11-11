'use client'

import { Button, ChartIcon, Input, Modal, Tooltip } from '@fameex/ui'
import type { ReactNode } from 'react'
import type { useMarginSettings } from '@/features/trading/hooks/use-margin-settings'
import { t, useLocale } from '@/i18n'
import type { MarketContext } from '@/shared/lib/hyperliquid'

export function MarginSettings(props: {
  market: MarketContext
  settings: ReturnType<typeof useMarginSettings>
  enabled: boolean
  busy: boolean
  accountType: ReactNode
}) {
  useLocale()

  const { settings } = props
  const { market, enabled, busy } = props
  const { current, editor, leverage, cross, isolatedOnly } = settings
  const choices = [...new Set([1, 2, 3, 5, 10, 20, 30, 50, market.maxLeverage])]
    .filter((n) => n <= market.maxLeverage)
    .sort((a, b) => a - b)
  return (
    <>
      <div className="mb-4 flex gap-2 text-xs">
        <Tooltip
          content={t('全仓共享账户保证金，逐仓仅使用分配给该仓位的保证金。')}
        >
          <button
            type="button"
            aria-label={t('调整保证金模式')}
            onClick={() => settings.open('margin')}
            className="flex h-6 flex-1 items-center justify-center rounded-lg bg-cc-2 px-2 hover:bg-hover-n"
          >
            {current
              ? current.leverage.type === 'cross'
                ? t('全仓')
                : t('逐仓')
              : t('保证金模式')}{' '}
            <ChartIcon
              name="arrow-drop-down"
              className="ml-2 size-3 text-muted"
            />
          </button>
        </Tooltip>
        <Tooltip content={t('杠杆决定初始保证金要求，调整需经交易所校验。')}>
          <button
            type="button"
            aria-label={t('调整杠杆')}
            onClick={() => settings.open('leverage')}
            className="flex h-6 flex-1 items-center justify-center rounded-lg bg-cc-2 px-2 hover:bg-hover-n"
          >
            {current ? `${current.leverage.value}x` : t('杠杆')}{' '}
            <ChartIcon
              name="arrow-drop-down"
              className="ml-2 size-3 text-muted"
            />
          </button>
        </Tooltip>
        {props.accountType}
      </div>
      {editor && (
        <Modal
          title={`${editor === 'margin' ? t('保证金模式') : t('调整杠杆')} · ${market.name}`}
          closeLabel={t('关闭设置')}
          onClose={settings.close}
          busy={busy}
          footer={
            <Button
              className="w-full"
              isDisabled={!enabled || busy || !current}
              onPress={settings.apply}
            >
              {editor === 'margin' ? t('确认保证金模式') : t('应用杠杆设置')}
            </Button>
          }
        >
          {editor === 'margin' ? (
            <>
              <fieldset className="flex gap-3" aria-label={t('保证金模式')}>
                {[true, false].map((value) => (
                  <label
                    key={String(value)}
                    className={`flex h-14 flex-1 cursor-pointer items-center gap-3 rounded-lg border px-4 text-sm ${cross === value ? 'border-brand' : 'border-cc-1'} ${value && isolatedOnly ? 'cursor-not-allowed opacity-40' : ''}`}
                  >
                    <input
                      type="radio"
                      name="margin-mode"
                      value={String(value)}
                      checked={cross === value}
                      disabled={value && isolatedOnly}
                      onChange={() => settings.setCross(value)}
                      className="size-4 accent-brand"
                    />
                    {value ? t('全仓') : t('逐仓')}
                  </label>
                ))}
              </fieldset>
              <p className="mt-4 text-xs leading-6 text-muted">
                {cross
                  ? t(
                      '全仓持仓共享全仓账户保证金，其他全仓持仓的盈亏会影响可用保证金。',
                    )
                  : t(
                      '逐仓持仓使用分配给该仓位的保证金。此处只调整模式，不执行追加或移除保证金。',
                    )}
              </p>
              {isolatedOnly && (
                <p className="mt-2 text-xs text-muted">
                  {t('该 Hyperliquid 市场仅支持逐仓。')}
                </p>
              )}
            </>
          ) : (
            <>
              <Input
                aria-label={t('杠杆倍数')}
                type="number"
                min={1}
                max={market.maxLeverage}
                step={1}
                size="md"
                value={leverage}
                onChange={settings.setLeverage}
                endContent={<span className="text-muted">x</span>}
              />
              <div className="mt-4 flex flex-wrap gap-1 rounded-lg bg-cc-3 p-1">
                {choices.map((value) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={Number(leverage) === value}
                    onClick={() => settings.setLeverage(String(value))}
                    className={`rounded-full px-3 py-1.5 text-xs ${Number(leverage) === value ? 'bg-ink text-canvas' : 'text-ink hover:bg-cc-2'}`}
                  >
                    {value}x
                  </button>
                ))}
              </div>
              <p className="mt-4 text-xs leading-6 text-muted">
                {t('当前市场上限')}
                {market.maxLeverage}
                {t(
                  'x。提高杠杆会减少开仓所需保证金；最终可用杠杆和订单接受结果以 Hyperliquid 校验为准。',
                )}
              </p>
            </>
          )}
          {(settings.error || settings.loadError) && (
            <p role="alert" className="mt-3 text-xs text-loss">
              {settings.error || settings.loadError}
            </p>
          )}
          {!enabled && (
            <p className="mt-3 text-xs text-muted">
              {t('完成钱包连接后可提交调整，无需逐笔钱包确认。')}
            </p>
          )}
        </Modal>
      )}
    </>
  )
}
