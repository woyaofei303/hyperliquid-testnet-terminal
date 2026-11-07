'use client'

import { Button, Input } from '@fameex/ui'
import { useEffect, useState } from 'react'
import type { TerminalModel } from '@/hooks/use-terminal'
import { t, useLocale } from '@/i18n'
import { sharedAccount } from '@/lib/account-types'
import { display } from '@/lib/display'
import { WITHDRAWAL_FEE, withdrawalAmount } from '@/lib/funding'
import { Money } from '@/lib/orders'

// FameEX Transfer/ModeSelect 的双账户卡片与 Transfer2 图标。
export function FundingRoute({
  from,
  to,
  onSwap,
  disabled,
}: {
  from: string
  to: string
  onSwap?: () => void
  disabled?: boolean
}) {
  useLocale()

  return (
    <div className="flex items-center gap-3 rounded-[8px] bg-panel p-3">
      <fieldset
        aria-label={t('划转方向')}
        className="min-w-0 flex-1 space-y-2 text-sm"
      >
        <p>
          <span className="mr-4 text-xs text-muted">{t('从')}</span>
          {from}
        </p>
        <p>
          <span className="mr-4 text-xs text-muted">{t('到')}</span>
          {to}
        </p>
      </fieldset>
      {onSwap && (
        <Button
          aria-label={t('交换划转方向')}
          variant="light"
          className="h-9 min-w-9 p-2"
          isDisabled={disabled}
          onPress={onSwap}
        >
          <svg
            viewBox="0 0 24 24"
            className="size-6"
            fill="currentColor"
            aria-hidden="true"
          >
            <path
              fillRule="evenodd"
              clipRule="evenodd"
              d="M4 10.2454V9.5C4 9.22386 4.22386 9 4.5 9H15.0443L14.0553 6.31257C14.0464 6.28846 14.0355 6.2653 14.0246 6.24225L14.0246 6.24223L14.0217 6.23615C13.8136 5.79503 14.2636 5.30795 14.6589 5.57722L19.7832 10.0676C20.1722 10.3326 20.0037 11 19.5478 11H16.5H4.67705H4.5C4.22386 11 4 10.7761 4 10.5V10.2454ZM9.94472 17.6874L8.95569 15H19.5C19.7761 15 20 14.7761 20 14.5V13.7546V13.5C20 13.2239 19.7761 13 19.5 13H19.3229H7.5L4.45216 13C3.9963 13 3.82782 13.6674 4.21679 13.9324L9.3411 18.4228C9.73643 18.6921 10.1864 18.205 9.97831 17.7639L9.97543 17.7578C9.96454 17.7347 9.9536 17.7115 9.94472 17.6874Z"
            />
          </svg>
        </Button>
      )}
    </div>
  )
}

export function WithdrawalForm({ model }: { model: TerminalModel }) {
  useLocale()

  const { wallet, funding: f, busy } = model
  const [amount, setAmount] = useState('')
  const { loadWithdrawalQuote, cancelWithdrawal } = f
  useEffect(() => {
    void loadWithdrawalQuote()
    const timer = setInterval(() => void loadWithdrawalQuote(), 15000)
    return () => {
      clearInterval(timer)
      cancelWithdrawal()
    }
  }, [loadWithdrawalQuote, cancelWithdrawal])
  if (!wallet) return null
  const quote = f.withdrawQuote
  const mode = model.account.snapshot?.mode
  const canTransfer = !!mode && !sharedAccount(mode)
  let validation = ''
  let received = '—'
  if (amount && quote) {
    try {
      const value = withdrawalAmount(amount, quote.available)
      received = new Money(value).minus(WITHDRAWAL_FEE).toFixed()
    } catch (e) {
      validation = e instanceof Error ? e.message : t('金额无效')
    }
  }
  return (
    <div className="space-y-4">
      <p className="break-all text-xs leading-5 text-muted">
        {t('收款地址 · 当前连接钱包')}
        <br />
        <span className="font-mono text-ink">{wallet.address}</span>
      </p>
      <Input
        label={t('提款金额（USDC）')}
        value={amount}
        onChange={setAmount}
        inputMode="decimal"
        placeholder={t('至少 0.4 USDC')}
        isDisabled={busy}
        endContent={
          <Button
            variant="light"
            size="sm"
            className="whitespace-nowrap px-0"
            isDisabled={busy || !quote || f.quoteLoading}
            onPress={() => {
              if (quote) setAmount(quote.available)
            }}
          >
            {t('最大值')}
          </Button>
        }
      />
      <p className="flex justify-between text-xs">
        <span className="text-muted">{t('最大可提（已预留 Gas）')}</span>
        <span>{display(quote?.available, 6)} USDC</span>
      </p>
      {validation && (
        <p role="alert" className="text-xs text-loss">
          {validation}
        </p>
      )}
      <dl className="space-y-2 border-t border-edge pt-3 text-xs">
        <div className="flex justify-between">
          <dt className="text-muted">{t('跨链手续费')}</dt>
          <dd>{WITHDRAWAL_FEE} USDC</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-muted">{t('预计 HyperEVM Gas')}</dt>
          <dd className="text-right">
            {quote?.gasInHype === false
              ? `${display(quote.gasUsdc, 6)} USDC`
              : `${display(quote?.gasHype, 8)} HYPE`}
          </dd>
        </div>
        {quote && new Money(quote.activationFee).gt(0) && (
          <div className="flex justify-between">
            <dt className="text-muted">{t('账户激活费')}</dt>
            <dd>{quote.activationFee} USDC</dd>
          </div>
        )}
        <div className="flex justify-between pt-1">
          <dt className="text-muted">{t('预计到账')}</dt>
          <dd className="font-medium text-ink">{received} USDC</dd>
        </div>
      </dl>
      {!quote && !f.quoteLoading && (
        <Button
          variant="light"
          size="sm"
          onPress={() => void loadWithdrawalQuote()}
        >
          {t('重新查询提款费用')}
        </Button>
      )}
      <Button
        className="w-full"
        isDisabled={busy || f.quoteLoading || !quote || !amount || !!validation}
        onPress={() => void f.withdraw(amount)}
      >
        {busy
          ? t('等待钱包确认…')
          : f.quoteLoading
            ? t('正在查询费用…')
            : t('提现至 Arbitrum Sepolia')}
      </Button>
      {canTransfer && (
        <Button
          variant="light"
          size="sm"
          className="w-full text-xs"
          isDisabled={busy}
          onPress={() => {
            model.setTransferToPerp(true)
            model.setWeb3Panel('transfer')
          }}
        >
          {t('现货转入合约')}
        </Button>
      )}
    </div>
  )
}
