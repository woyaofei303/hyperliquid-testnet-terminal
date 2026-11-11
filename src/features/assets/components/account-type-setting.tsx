'use client'

import { Button, ChartIcon, Modal } from '@fameex/ui'
import { useEffect, useState } from 'react'
import {
  type AccountMode,
  type AccountType,
  accountTypeName,
  accountTypes,
} from '@/features/assets/lib/account-types'
import { t, useLocale } from '@/i18n'

export function AccountTypeSetting({
  mode,
  connected,
  busy,
  onApply,
}: {
  mode: AccountMode | null
  connected: boolean
  busy: boolean
  onApply: (next: AccountType, expected: AccountMode) => Promise<void>
}) {
  useLocale()

  const [draft, setDraft] = useState<{
    from: AccountMode | null
    value: AccountType | null
  } | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!mode) return
    setDraft((previous) =>
      previous && !previous.from
        ? {
            from: mode,
            value:
              previous.value ??
              accountTypes.find((type) => type.value === mode)?.value ??
              null,
          }
        : previous,
    )
  }, [mode])
  async function apply() {
    if (!draft?.value || !draft.from) return
    try {
      setError('')
      await onApply(draft.value, draft.from)
      setDraft(null)
    } catch (error) {
      setError(error instanceof Error ? error.message : t('账户类型修改失败'))
    }
  }
  return (
    <>
      <Button
        type="button"
        color="default"
        aria-label={t('账户类型')}
        isDisabled={busy}
        className="h-6 min-h-0 min-w-0 flex-1 rounded-lg bg-cc-2 px-2 text-xs text-ink hover:bg-hover-n"
        onPress={() => {
          setError('')
          setDraft({
            from: mode,
            value:
              accountTypes.find((type) => type.value === mode)?.value ?? null,
          })
        }}
      >
        {t(
          accountTypes.find((type) => type.value === mode)?.label ??
            (mode ? accountTypeName(mode) : '账户类型'),
        )}
        <ChartIcon name="arrow-drop-down" className="ml-1 size-3 text-muted" />
      </Button>
      {draft && (
        <Modal
          title={t('账户类型')}
          closeLabel={t('关闭账户类型')}
          busy={busy}
          onClose={() => setDraft(null)}
        >
          <fieldset
            className="space-y-3"
            aria-label={t('选择账户类型')}
            disabled={busy}
          >
            {accountTypes.map((type) => (
              <label
                key={type.value}
                className={`block cursor-pointer rounded-lg border p-3 ${draft.value === type.value ? 'border-accent' : 'border-edge'}`}
              >
                <span className="flex items-center gap-2 text-sm font-medium">
                  <input
                    type="radio"
                    name="account-type"
                    aria-label={
                      type.value === 'unifiedAccount'
                        ? t('统一账户（推荐）')
                        : t(type.name)
                    }
                    checked={draft.value === type.value}
                    onChange={() => {
                      setDraft({ ...draft, value: type.value })
                      setError('')
                    }}
                    className="size-4 accent-accent"
                  />
                  {t(type.name)}
                  {type.value === 'unifiedAccount' && t('（推荐）')}
                </span>
                <span className="mt-2 block text-xs leading-5 text-muted">
                  {t(type.description)}
                </span>
              </label>
            ))}
          </fieldset>
          <p className="text-xs leading-5 text-muted">
            {draft.value === 'disabled'
              ? t('切回手动前需关闭仓位并撤销挂单。')
              : draft.value === 'portfolioMargin'
                ? t(
                    '投资组合保证金处于测试阶段，账户价值需低于 2,500 万美元；资格与借贷额度由交易所校验。',
                  )
                : t('统一账户的同一资产无需在现货与合约之间划转。')}
            {t('确认后由钱包签名修改整个账户的类型。')}
          </p>
          {!connected && (
            <p className="text-xs text-muted">{t('请先连接钱包。')}</p>
          )}
          {connected && !mode && (
            <p className="text-xs text-muted">
              {t('请等到账户类型读取完成；查询失败时可关闭弹窗后刷新账户。')}
            </p>
          )}
          {error && (
            <p role="alert" className="text-xs text-loss">
              {t(error)}
            </p>
          )}
          <Button
            type="button"
            className="w-full"
            isDisabled={
              !connected ||
              !mode ||
              !draft.from ||
              !draft.value ||
              draft.value === mode ||
              busy
            }
            onPress={() => void apply()}
          >
            {busy ? t('等待钱包确认…') : t('确认账户类型')}
          </Button>
        </Modal>
      )}
    </>
  )
}
