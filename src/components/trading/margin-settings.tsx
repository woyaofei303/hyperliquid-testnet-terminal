'use client'
import { Button, ChartIcon, Input } from '@fameex/ui'
import { type ReactNode, useEffect, useRef } from 'react'
import type { useMarginSettings } from '@/hooks/use-margin-settings'
import type { MarketContext } from '@/lib/hyperliquid'

export function MarginSettings(props: {
  market: MarketContext
  settings: ReturnType<typeof useMarginSettings>
  enabled: boolean
  busy: boolean
  accountType: ReactNode
}) {
  const { settings } = props
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    if (settings.editor) dialog.current?.showModal()
    else dialog.current?.close()
  }, [settings.editor])
  const { market, enabled, busy } = props
  const { current, editor, leverage, cross, isolatedOnly } = settings
  const choices = [...new Set([1, 2, 3, 5, 10, 20, 30, 50, market.maxLeverage])]
    .filter((n) => n <= market.maxLeverage)
    .sort((a, b) => a - b)
  return (
    <>
      <div className="mb-4 flex gap-2 text-xs">
        <button
          type="button"
          aria-label="调整保证金模式"
          onClick={() => settings.open('margin')}
          className="flex h-6 flex-1 items-center justify-center rounded-lg bg-cc-2 px-2 hover:bg-hover-n"
        >
          {current
            ? current.leverage.type === 'cross'
              ? '全仓'
              : '逐仓'
            : '保证金模式'}{' '}
          <ChartIcon
            name="arrow-drop-down"
            className="ml-2 size-3 text-muted"
          />
        </button>
        <button
          type="button"
          aria-label="调整杠杆"
          onClick={() => settings.open('leverage')}
          className="flex h-6 flex-1 items-center justify-center rounded-lg bg-cc-2 px-2 hover:bg-hover-n"
        >
          {current ? `${current.leverage.value}x` : '杠杆'}{' '}
          <ChartIcon
            name="arrow-drop-down"
            className="ml-2 size-3 text-muted"
          />
        </button>
        {props.accountType}
      </div>
      <dialog
        ref={dialog}
        onCancel={settings.close}
        aria-labelledby="margin-editor-title"
        className="m-auto w-[calc(100%-32px)] max-w-md rounded-xl border border-edge bg-panel p-6 text-ink shadow-2xl backdrop:bg-black/65"
      >
        <div className="mb-6 flex items-center justify-between">
          <h2 id="margin-editor-title" className="text-lg font-semibold">
            {editor === 'margin' ? '保证金模式' : '调整杠杆'}{' '}
            <span className="text-sm font-normal text-muted">
              {market.name} / USDC
            </span>
          </h2>
          <button
            type="button"
            onClick={settings.close}
            aria-label="关闭设置"
            className="size-7 rounded text-xl text-muted hover:bg-surface"
          >
            ×
          </button>
        </div>
        {editor === 'margin' ? (
          <>
            <fieldset className="flex gap-3" aria-label="保证金模式">
              {[true, false].map((value) => (
                <label
                  key={String(value)}
                  className={`flex h-14 flex-1 cursor-pointer items-center gap-3 rounded-lg border px-4 text-sm ${cross === value ? 'border-brand' : 'border-cc-1'} ${value && isolatedOnly ? 'cursor-not-allowed opacity-40' : ''}`}
                >
                  <input
                    type="radio"
                    name="margin-mode"
                    value={String(value)}
                    checked={cross === value}
                    disabled={value && isolatedOnly}
                    onChange={() => settings.setCross(value)}
                    className="size-4 accent-brand"
                  />
                  {value ? '全仓' : '逐仓'}
                </label>
              ))}
            </fieldset>
            <p className="mt-4 text-xs leading-6 text-muted">
              {cross
                ? '全仓持仓共享全仓账户保证金，其他全仓持仓的盈亏会影响可用保证金。'
                : '逐仓持仓使用分配给该仓位的保证金。此处只调整模式，不执行追加或移除保证金。'}
            </p>
            {isolatedOnly && (
              <p className="mt-2 text-xs text-muted">
                该 Hyperliquid 市场仅支持逐仓。
              </p>
            )}
          </>
        ) : (
          <>
            <Input
              aria-label="杠杆倍数"
              type="number"
              min={1}
              max={market.maxLeverage}
              step={1}
              size="md"
              value={leverage}
              onChange={settings.setLeverage}
              endContent={<span className="text-muted">x</span>}
            />
            <div className="mt-4 flex flex-wrap gap-1 rounded-lg bg-cc-3 p-1">
              {choices.map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={Number(leverage) === value}
                  onClick={() => settings.setLeverage(String(value))}
                  className={`rounded-full px-3 py-1.5 text-xs ${Number(leverage) === value ? 'bg-ink text-canvas' : 'text-ink hover:bg-cc-2'}`}
                >
                  {value}x
                </button>
              ))}
            </div>
            <p className="mt-4 text-xs leading-6 text-muted">
              当前市场上限 {market.maxLeverage}
              x。提高杠杆会减少开仓所需保证金；最终可用杠杆和订单接受结果以
              Hyperliquid 校验为准。
            </p>
          </>
        )}
        {(settings.error || settings.loadError) && (
          <p role="alert" className="mt-3 text-xs text-loss">
            {settings.error || settings.loadError}
          </p>
        )}
        {!enabled && (
          <p className="mt-3 text-xs text-muted">
            启用交易后可提交调整，无需逐笔钱包确认。
          </p>
        )}
        <div className="mt-6 flex gap-3">
          <Button color="default" className="flex-1" onPress={settings.close}>
            取消
          </Button>
          <Button
            className="flex-1"
            isDisabled={!enabled || busy || !current}
            onPress={settings.apply}
          >
            {editor === 'margin' ? '确认保证金模式' : '应用杠杆设置'}
          </Button>
        </div>
      </dialog>
    </>
  )
}
