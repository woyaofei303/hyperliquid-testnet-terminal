'use client'
import { Button, FlatSelect, Input, Modal } from '@fameex/ui'
import { useEffect, useState } from 'react'
import { quoteName } from '@/features/market/lib/market-catalog'
import type { TerminalModel } from '@/features/terminal/hooks/use-terminal'
import {
  loadIsolatedMargin,
  marginDelta,
} from '@/features/trading/lib/isolated-margin'
import { t, useLocale } from '@/i18n'
import { errorText } from '@/shared/lib/fameex-testnet'
import { HelpLabel } from '../../../shared/components/help-label'

export function IsolatedMargin({
  coin,
  model,
  onClose,
}: {
  coin: string
  model: TerminalModel
  onClose: () => void
}) {
  useLocale()
  const [direction, setDirection] = useState<'add' | 'remove'>('add')
  const [amount, setAmount] = useState('')
  const [quote, setQuote] = useState<Awaited<
    ReturnType<typeof loadIsolatedMargin>
  > | null>(null)
  const [error, setError] = useState(''),
    [pending, setPending] = useState(false)
  const market = model.markets.find((m) => m.name === coin)
  const user = model.wallet?.address
  useEffect(() => {
    if (!market || !user) return
    let active = true
    const load = async () => {
      try {
        const next = await loadIsolatedMargin(user, market)
        if (active) {
          setQuote(next)
          setError('')
        }
      } catch (e) {
        if (active) {
          setQuote(null)
          setError(errorText(e))
        }
      }
    }
    void load()
    const timer = setInterval(load, 10000)
    return () => {
      active = false
      clearInterval(timer)
    }
  }, [market, user])
  let valid = false
  try {
    if (quote) {
      marginDelta(amount, quote[direction], direction)
      valid = true
    }
  } catch {
    /* 输入未完成时禁用确认。 */
  }
  async function submit() {
    setPending(true)
    try {
      if (await model.submitIsolatedMargin(coin, amount, direction)) onClose()
    } finally {
      setPending(false)
    }
  }
  return (
    <Modal
      title={t('调整逐仓保证金')}
      closeLabel={t('关闭')}
      onClose={onClose}
      busy={pending}
      footer={
        <Button
          className="w-full"
          isDisabled={!valid || pending || model.busy}
          onPress={() => void submit()}
        >
          {t('确认')}
        </Button>
      }
    >
      <p className="text-xs leading-5 text-muted">
        {t(
          '追加保证金可降低该逐仓仓位的清算风险；移除保证金会提高风险，并受到最低保证金要求限制。',
        )}
      </p>
      <Input
        label={t('保证金金额')}
        size="md"
        value={amount}
        onChange={setAmount}
        inputMode="decimal"
        inputClassName="min-w-0"
        isDisabled={pending}
        endContent={
          <div className="flex items-center gap-3">
            <button
              type="button"
              disabled={!quote || pending}
              className="shrink-0 text-xs text-text-2 underline-offset-4 hover:text-ink hover:underline"
              onClick={() => quote && setAmount(quote[direction])}
            >
              {t('最大')}
            </button>
            <FlatSelect
              aria-label={t('保证金调整方向')}
              value={direction}
              onChange={(value) => {
                setDirection(value === 'remove' ? 'remove' : 'add')
                setAmount('')
              }}
              items={[
                { key: 'add', label: t('追加') },
                { key: 'remove', label: t('移除') },
              ]}
              isDisabled={pending}
              placement="bottom-end"
              className="!w-24"
              spanClassName="text-body-regular font-medium text-1"
            />
          </div>
        }
      />
      <dl className="space-y-3 text-xs">
        <div className="flex justify-between">
          <dt className="text-muted">
            <HelpLabel label="保证金" /> · {coin}
          </dt>
          <dd>
            {quote?.position.marginUsed ?? '—'} {quoteName(market)}
          </dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-muted">
            {t(direction === 'add' ? '可追加金额' : '可移除金额')}
          </dt>
          <dd>
            {quote?.[direction] ?? '—'} {quoteName(market)}
          </dd>
        </div>
      </dl>
      {direction === 'remove' && quote?.strict && (
        <p className="text-xs text-muted">
          {t('该市场为严格逐仓，不允许手动移除保证金。')}
        </p>
      )}
      {error && (
        <p role="alert" className="text-xs text-loss">
          {t(error)}
        </p>
      )}
    </Modal>
  )
}
