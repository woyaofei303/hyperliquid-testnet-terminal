'use client'
import { Button, Checkbox, Modal } from '@fameex/ui'
import { useState } from 'react'
import { marketLabel } from '@/lib/market-catalog'
import { orderConfirmation } from '@/lib/order-confirmation'
import type { Market } from '@/lib/orders'
import type { ConfirmationAction } from '@/lib/trading'
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
  onConfirm: (skip: boolean, persist: boolean) => void
}) {
  const [skip, setSkip] = useState(false)
  const [persist, setPersist] = useState(false)
  if (action.kind === 'approve')
    return (
      <Modal
        title="启用交易"
        onClose={onClose}
        footer={
          <Button className="w-full" onPress={() => onConfirm(false, persist)}>
            建立连接
          </Button>
        }
      >
        <p className="text-sm leading-6 text-muted">
          在钱包中签署一次消息以建立交易连接，即可在 Hyperliquid
          测试网交易。此签名不转移资金，也不收取 Gas。
        </p>
        <div className="rounded-[8px] bg-panel p-3 text-xs leading-5">
          <span className="text-muted">连接账户</span>
          <p className="mt-1 break-all font-mono">{action.account}</p>
        </div>
        <p className="text-xs leading-5 text-muted">
          这是为当前浏览器建立连接，与账户是否曾交易无关。默认在当前标签页保留，刷新可恢复；勾选保持连接后可在重启浏览器后恢复。存款、划转和提款仍需主钱包确认。
        </p>
        <Checkbox isSelected={persist} onValueChange={setPersist}>
          保持连接
        </Checkbox>
        <p className="text-xs text-muted">
          仅在自己的设备保持连接。交易密钥保存在此浏览器，不会读取或保存主钱包私钥。
        </p>
        <details className="text-xs leading-5 text-muted">
          <summary className="cursor-pointer">授权详情</summary>
          <p className="mt-2">
            授权 JulianTerminal API
            钱包代签交易，会替换同名旧会话。断开会清除本地连接；交易所端需在官方
            API 钱包页撤销。
          </p>
        </details>
      </Modal>
    )
  const details = orderConfirmation(action, market)
  const tone = details.protection
    ? 'text-ink'
    : details.buy
      ? 'text-mint'
      : 'text-loss'
  return (
    <Modal
      title={details.title}
      onClose={onClose}
      className="max-w-[520px] [&_header]:px-12 [&_header]:text-center"
    >
      <dl className="space-y-2 text-xs">
        {market && (details.cash || !details.basic) && (
          <div className="flex justify-between gap-6">
            <dt className="shrink-0 text-muted">市场</dt>
            <dd className="text-right">{marketLabel(market)}</dd>
          </div>
        )}
        <div className="flex justify-between gap-6">
          <dt className="text-muted">操作</dt>
          <dd className={tone}>{details.operation}</dd>
        </div>
        <div className="flex justify-between gap-6">
          <dt className="text-muted">数量</dt>
          <dd className={`text-right tabular-nums ${tone}`}>
            {details.quantity}
          </dd>
        </div>
        {details.price && (
          <div className="flex justify-between gap-6">
            <dt className="text-muted">价格</dt>
            <dd className="text-right tabular-nums">{details.price}</dd>
          </div>
        )}
        {!details.cash && !details.reduceOnly && (
          <div className="flex justify-between gap-6">
            <dt
              className="text-muted"
              title="尚无成交后保证金与仓位的可靠估算，不能沿用现有仓位强平价"
            >
              预估强平价格
            </dt>
            <dd>N/A</dd>
          </div>
        )}
      </dl>
      {action.kind === 'ticket' && !details.basic && (
        <TicketPreview ticket={action.ticket} />
      )}
      {details.reduceOnly && (
        <p className="text-xs text-muted">只减仓已启用，不允许反向开仓。</p>
      )}
      <p className="mt-2 text-xs leading-5 text-muted">
        您无需支付燃气费，订单通常在几秒内确认。
      </p>
      <Checkbox
        isSelected={skip}
        onValueChange={setSkip}
        classNames={{ label: 'text-xs text-muted' }}
      >
        不再显示此消息
      </Checkbox>
      <Button
        color={details.buy || details.protection ? 'primary' : 'danger'}
        type="button"
        onPress={() => onConfirm(skip, false)}
        className="mt-2 h-10 w-full shrink-0 rounded-md text-sm"
      >
        {details.buttonLabel}
      </Button>
    </Modal>
  )
}
