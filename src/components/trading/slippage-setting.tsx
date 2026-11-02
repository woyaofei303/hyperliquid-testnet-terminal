'use client'

import { Button, Input, Modal } from '@fameex/ui'
import { useState } from 'react'
import { slippageBps } from '@/lib/orders'

export function SlippageSetting({
  value,
  onChange,
}: {
  value: string
  onChange: (value: string) => void
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const [error, setError] = useState('')
  function apply() {
    try {
      onChange(String(slippageBps(draft ?? value) / 100))
      setDraft(null)
    } catch (error) {
      setError(error instanceof Error ? error.message : '滑点无效')
    }
  }
  return (
    <>
      <div className="flex items-center justify-between gap-2">
        <dt className="text-muted">滑点</dt>
        <dd>
          <Button
            type="button"
            variant="light"
            aria-label="调整最大滑点"
            className="h-auto min-h-0 min-w-0 rounded-none p-0 text-xs text-accent !bg-transparent"
            onPress={() => {
              setDraft(value)
              setError('')
            }}
          >
            最大：{Number(value).toFixed(2)}%
          </Button>
        </dd>
      </div>
      {draft !== null && (
        <Modal
          title="调整最大滑点"
          closeLabel="关闭滑点设置"
          onClose={() => setDraft(null)}
        >
          <p className="text-xs leading-5 text-muted">
            仅影响当前表单提交的市价单。成交价格超出上限时，剩余数量不会继续成交。
          </p>
          <Input
            label="最大滑点（%）"
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
              {error}
            </p>
          )}
          <Button type="button" className="w-full" onPress={apply}>
            确认
          </Button>
        </Modal>
      )}
    </>
  )
}
