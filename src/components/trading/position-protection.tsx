import { Button, Input } from '@fameex/ui'
import { useEffect, useRef, useState } from 'react'
import { t, useLocale } from '@/i18n'
import { errorText } from '@/lib/hyperliquid'
export function PositionProtection({
  coin,
  onClose,
  onPreview,
}: {
  coin: string
  onClose: () => void
  onPreview: (coin: string, tp: string, sl: string) => Promise<void>
}) {
  useLocale()

  const dialog = useRef<HTMLDialogElement>(null)
  const [tp, setTp] = useState('')
  const [sl, setSl] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    dialog.current?.showModal()
  }, [])
  async function preview() {
    setBusy(true)
    try {
      await onPreview(coin, tp, sl)
      onClose()
    } catch (error) {
      setError(errorText(error))
    } finally {
      setBusy(false)
    }
  }
  return (
    <dialog
      ref={dialog}
      onCancel={onClose}
      aria-label={t('仓位保护')}
      className="m-auto w-[calc(100%-32px)] max-w-sm space-y-5 rounded-lg border border-edge bg-panel p-5 text-ink backdrop:bg-black/70"
    >
      <h2 className="font-semibold">
        {coin} {t('仓位止盈 / 止损')}
      </h2>
      <Input
        label={t('止盈触发价（可选）')}
        aria-label={t('仓位止盈价')}
        value={tp}
        onChange={setTp}
        inputMode="decimal"
      />
      <Input
        label={t('止损触发价（可选）')}
        aria-label={t('仓位止损价')}
        value={sl}
        onChange={setSl}
        inputMode="decimal"
      />
      <p className="text-xs leading-5 text-muted">
        {t(
          '按最新仓位数量设置只减仓市价保护单，触发后价格保护为 10%。新增仓位不会自动扩大本次保护数量；已有保护单可在当前委托撤销。',
        )}
      </p>
      {error && (
        <p role="alert" className="text-xs text-loss">
          {t(error)}
        </p>
      )}
      <div className="flex justify-end gap-3">
        <Button
          variant="bordered"
          size="sm"
          onPress={onClose}
          isDisabled={busy}
        >
          {t('返回')}
        </Button>
        <Button size="sm" onPress={() => void preview()} isDisabled={busy}>
          {t('预览保护单')}
        </Button>
      </div>
    </dialog>
  )
}
