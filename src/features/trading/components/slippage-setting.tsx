'use client'

import { Button, Input, Modal } from '@fameex/ui'
import { useState } from 'react'
import { slippageBps } from '@/features/trading/lib/orders'
import { t, useLocale } from '@/i18n'
import { HelpLabel } from '../../../shared/components/help-label'

export function SlippageSetting({
  value,
  estimate,
  onChange,
}: {
  estimate?: string
  value: string
  onChange: (value: string) => void
}) {
  useLocale()

  const [draft, setDraft] = useState<string | null>(null)
  const [error, setError] = useState('')
  function apply() {
    try {
      onChange(String(slippageBps(draft ?? value) / 100))
      setDraft(null)
    } catch (error) {
      setError(error instanceof Error ? error.message : t('滑点无效'))
    }
  }
  return (
    <>
      <div className="flex items-center justify-between gap-2">
        <dt className="text-muted">
          <HelpLabel
            label={estimate === undefined ? '最大滑点' : '滑点'}
            helpKey="最大滑点"
          />
        </dt>
        <dd>
          <Button
            type="button"
            variant="light"
            aria-label={t('调整最大滑点')}
            className="h-auto min-h-0 min-w-0 rounded-none p-0 text-xs text-accent !bg-transparent"
            onPress={() => {
              setDraft(value)
              setError('')
            }}
          >
            {estimate === undefined ? t('最大：') : `Est: ${estimate} / Max: `}
            {Number(value).toFixed(2)}%
          </Button>
        </dd>
      </div>
      {draft !== null && (
        <Modal
          title={t('调整最大滑点')}
          closeLabel={t('关闭滑点设置')}
          onClose={() => setDraft(null)}
        >
          <p className="text-xs leading-5 text-muted">
            {t(
              '仅影响当前表单提交的市价单。成交价格超出上限时，剩余数量不会继续成交。',
            )}
          </p>
          <Input
            label={t('最大滑点（%）')}
            value={draft}
            onChange={(value) => {
              setDraft(value)
              setError('')
            }}
            inputMode="decimal"
            endContent="%"
          />
          {error && (
            <p role="alert" className="text-xs text-loss">
              {t(error)}
            </p>
          )}
          <Button type="button" className="w-full" onPress={apply}>
            {t('确认')}
          </Button>
        </Modal>
      )}
    </>
  )
}
