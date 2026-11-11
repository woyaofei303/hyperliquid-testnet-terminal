'use client'

import { Button, Checkbox, Modal } from '@fameex/ui'
import { useState } from 'react'
import { marketLabel } from '@/features/market/lib/market-catalog'
import { orderConfirmation } from '@/features/trading/lib/order-confirmation'
import type { Market } from '@/features/trading/lib/orders'
import type { ConfirmationAction } from '@/features/trading/lib/trading'
import { t, useLocale } from '@/i18n'
import { TicketPreview } from './ticket-preview'
export function ConfirmDialog({
  action,
  market,
  onClose,
  onConfirm,
}: {
  action: ConfirmationAction
  market?: Market
  onClose: () => void
  onConfirm: (skip: boolean) => void
}) {
  useLocale()

  const [skip, setSkip] = useState(false)
  const details = orderConfirmation(action, market)
  const tone = details.protection
    ? 'text-ink'
    : details.buy
      ? 'text-mint'
      : 'text-loss'
  return (
    <Modal
      closeLabel={t('关闭')}
      title={t(details.title)}
      onClose={onClose}
      className="max-w-[520px] [&_header]:px-12 [&_header]:text-center"
    >
      <dl className="space-y-2 text-xs">
        {market && (details.cash || !details.basic) && (
          <div className="flex justify-between gap-6">
            <dt className="shrink-0 text-muted">{t('市场')}</dt>
            <dd className="text-right">{marketLabel(market)}</dd>
          </div>
        )}
        <div className="flex justify-between gap-6">
          <dt className="text-muted">{t('操作')}</dt>
          <dd className={tone}>{t(details.operation)}</dd>
        </div>
        <div className="flex justify-between gap-6">
          <dt className="text-muted">{t('数量')}</dt>
          <dd className={`text-right tabular-nums ${tone}`}>
            {details.quantity}
          </dd>
        </div>
        {details.price && (
          <div className="flex justify-between gap-6">
            <dt className="text-muted">{t('价格')}</dt>
            <dd className="text-right tabular-nums">{t(details.price)}</dd>
          </div>
        )}
        {!details.cash && !details.reduceOnly && (
          <div className="flex justify-between gap-6">
            <dt
              className="text-muted"
              title={t(
                '尚无成交后保证金与仓位的可靠估算，不能沿用现有仓位强平价',
              )}
            >
              {t('预估强平价格')}
            </dt>
            <dd>N/A</dd>
          </div>
        )}
      </dl>
      {action.kind === 'ticket' && !details.basic && (
        <TicketPreview ticket={action.ticket} />
      )}
      {details.reduceOnly && (
        <p className="text-xs text-muted">
          {t('只减仓已启用，不允许反向开仓。')}
        </p>
      )}
      <p className="mt-2 text-xs leading-5 text-muted">
        {t('您无需支付燃气费，订单通常在几秒内确认。')}
      </p>
      <Checkbox
        isSelected={skip}
        onValueChange={setSkip}
        classNames={{ label: 'text-xs text-muted' }}
      >
        {t('不再显示此消息')}
      </Checkbox>
      <Button
        color={details.buy || details.protection ? 'primary' : 'danger'}
        type="button"
        onPress={() => onConfirm(skip)}
        className="mt-2 h-10 w-full shrink-0 rounded-md text-sm"
      >
        {t(details.buttonLabel)}
      </Button>
    </Modal>
  )
}
