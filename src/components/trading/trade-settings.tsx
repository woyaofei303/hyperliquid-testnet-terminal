'use client'
import { SmartPopover, Switch, Tooltip } from '@fameex/ui'
import { t, useLocale } from '@/i18n'
import { tradePreferences } from '@/lib/trade-preferences'
import { HelpLabel } from './help-label'

export function TradeSettings() {
  const locale = useLocale()
  const skipOrder = tradePreferences.skipOrder.useValue()
  const skipClose = tradePreferences.skipClose.useValue()
  return (
    <SmartPopover
      placement="bottom-end"
      trigger="click"
      closeOnContentClick={false}
      triggerLabel={t('交易设置')}
      triggerClassName="flex size-9 items-center justify-center rounded-md text-muted hover:bg-surface hover:text-ink aria-expanded:bg-surface aria-expanded:text-ink"
      contentClassName="w-72 rounded-lg border border-edge bg-surface p-4 text-ink shadow-xl"
      content={
        <section aria-label={t('交易设置')}>
          <h2 className="mb-3 text-sm font-medium">{t('交易')}</h2>
          <div className="flex flex-col gap-4">
            {(
              [
                ['下单确认', skipOrder, tradePreferences.skipOrder],
                ['平仓确认', skipClose, tradePreferences.skipClose],
              ] as const
            ).map(([label, skipped, preference]) => (
              <Switch
                key={label}
                aria-label={t(label)}
                size="sm"
                isSelected={!skipped}
                onValueChange={(enabled) => preference.set(!enabled)}
                classNames={{
                  base: 'm-0 flex min-h-8 max-w-none flex-row-reverse items-center justify-between gap-4 p-0',
                  label: 'ml-0 text-xs text-muted',
                  wrapper: 'mr-0 group-data-[selected=true]:bg-brand',
                  thumb: 'bg-ink',
                }}
              >
                <HelpLabel label={label} />
              </Switch>
            ))}
          </div>
          <p className="mt-4 border-t border-edge pt-3 text-xs leading-5 text-muted">
            {locale === 'en-US'
              ? 'Saved in this browser. Turning confirmations off submits orders immediately. Wallet signatures and validation still apply.'
              : '保存在当前浏览器。关闭确认后点击下单将直接提交；钱包签名和交易校验仍然保留。'}
          </p>
        </section>
      }
    >
      <span className="flex size-full items-center justify-center">
        <Tooltip content={t('交易设置')}>
          <span className="flex items-center" aria-hidden="true">
            <svg
              aria-hidden="true"
              className="size-5 shrink-0"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="m9 3-.6 2.3-2 .9L4.3 6l-2 3.5L4 11v2l-1.7 1.5 2 3.5 2.1-.2 2 .9L9 21h6l.6-2.3 2-.9 2.1.2 2-3.5L20 13v-2l1.7-1.5-2-3.5-2.1.2-2-.9L15 3Z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          </span>
        </Tooltip>
      </span>
    </SmartPopover>
  )
}
