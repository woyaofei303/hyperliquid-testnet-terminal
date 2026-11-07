import { Button, Input, Modal, Tab, Tabs } from '@fameex/ui'
import { useState } from 'react'
import type { TerminalModel } from '@/hooks/use-terminal'
import { t } from '@/i18n'
import { errorText } from '@/lib/hyperliquid'
import type { Market } from '@/lib/orders'
import {
  type ConversionKind,
  conversionKinds,
  conversionMaximum,
  prepareConversion,
} from '@/lib/outcome-conversion'
import type { Action } from '@/lib/trading'

export function OutcomeConversion({
  model,
  market,
  onClose,
}: {
  model: TerminalModel
  market: Market
  onClose: () => void
}) {
  const [kind, setKind] = useState<ConversionKind>('splitOutcome')
  const [amount, setAmount] = useState('')
  const [error, setError] = useState('')
  const [preview, setPreview] = useState<Extract<
    Action,
    { kind: 'outcome' }
  > | null>(null)
  const balances = model.account.snapshot?.spot.balances ?? []
  let maximum = '0'
  try {
    maximum = conversionMaximum(kind, market, balances)
  } catch {
    /* 未关联问题时不开放相关转换。 */
  }
  const label = conversionKinds.find(([id]) => id === kind)?.[1] ?? '转换结果'
  const quote = market.quote ?? 'USDC'
  const description =
    kind === 'splitOutcome'
      ? '每 1 {quote} 拆分为该结果的 1 份 Yes 和 1 份 No。'
      : kind === 'mergeOutcome'
        ? '该结果各 1 份 Yes 和 No 合并为 1 {quote}。'
        : kind === 'mergeQuestion'
          ? '问题内每个未结算结果（含后备结果）各 1 份 Yes 合并为 1 {quote}。'
          : '将当前结果的 1 份 No 转换为问题内其他结果（含后备结果）各 1 份 Yes。'
  return (
    <Modal
      title={t(preview ? '确认预测转换' : '转换结果')}
      onClose={model.busy ? () => {} : onClose}
      closeLabel={t('关闭')}
    >
      <p className="text-sm">{market.eventTitle ?? market.label}</p>
      {market.question != null && kind !== 'mergeQuestion' && (
        <p className="text-xs text-muted">{market.outcomeTitle}</p>
      )}
      {!preview && (
        <Tabs
          aria-label={t('转换类型')}
          selectedKey={kind}
          disabledKeys={
            market.question == null ? ['mergeQuestion', 'negateOutcome'] : []
          }
          classNames={{ tabList: 'w-full gap-3', tab: 'text-xs' }}
          onSelectionChange={(value) => {
            const next = conversionKinds.find(([id]) => id === value)?.[0]
            if (next) {
              setKind(next)
              setError('')
              setAmount('')
            }
          }}
        >
          {conversionKinds.map(([id, label]) => (
            <Tab key={id} title={t(label)} />
          ))}
        </Tabs>
      )}
      <p className="text-sm leading-6 text-muted">
        {t(description).replace('{quote}', quote)}
      </p>
      {preview ? (
        <dl className="space-y-2 text-sm">
          <div className="flex justify-between">
            <dt>{t('操作')}</dt>
            <dd>{t(label)}</dd>
          </div>
          <div className="flex justify-between">
            <dt>{t('数量')}</dt>
            <dd>
              {preview.amount} {t('份')}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt>{t('账户')}</dt>
            <dd>
              {preview.account.slice(0, 6)}…{preview.account.slice(-4)}
            </dd>
          </div>
        </dl>
      ) : (
        <>
          <Input
            label={t('转换数量')}
            value={amount}
            onChange={setAmount}
            placeholder={t('输入整数份额')}
          />
          <button
            type="button"
            className="text-left text-xs text-text-2 underline-offset-4 hover:text-ink hover:underline"
            onClick={() => setAmount(maximum)}
          >
            {t('最大可转换')}：{maximum}{' '}
            {kind === 'splitOutcome' ? quote : t('份')}
          </button>
        </>
      )}
      {error && (
        <p role="alert" className="text-xs text-loss">
          {t(error)}
        </p>
      )}
      <Button
        isDisabled={model.busy || (!model.onboarding && !model.canTrade)}
        onPress={async () => {
          if (model.onboarding) {
            if (!model.wallet) model.connect()
            else model.continueConnection()
            return
          }
          if (preview) {
            const success = await model.convertOutcome(preview)
            if (success) onClose()
            else {
              setPreview(null)
              setError('转换未完成，请查看交易提示并核对余额。')
            }
            return
          }
          try {
            if (!model.address) throw new Error('请先连接钱包')
            prepareConversion(kind, market, amount, balances)
            setPreview({
              kind: 'outcome',
              account: model.address,
              coin: market.name,
              market,
              conversion: kind,
              amount,
              at: Date.now(),
            })
            setError('')
          } catch (e) {
            setError(errorText(e))
          }
        }}
      >
        {model.onboarding
          ? t(model.onboarding)
          : t(preview ? '确认转换' : '预览转换')}
      </Button>
      {preview && (
        <Button
          variant="light"
          isDisabled={model.busy}
          onPress={() => setPreview(null)}
        >
          {t('返回修改')}
        </Button>
      )}
    </Modal>
  )
}
