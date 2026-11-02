import { Button, SmartPopover } from '@fameex/ui'
import type { TerminalModel } from '@/hooks/use-terminal'
import { setLocale, t, useLocale } from '@/i18n'
export function Header({ model }: { model: TerminalModel }) {
  const locale = useLocale()

  const { wallet, busy, connect, previewApproval } = model
  return (
    <header className="flex min-h-14 shrink-0 flex-wrap items-center justify-between gap-x-6 gap-y-2 border-b border-edge bg-panel px-4 py-2">
      <div className="flex items-center gap-3">
        <div
          aria-hidden="true"
          className="flex size-8 items-center justify-center rounded-lg bg-brand text-lg font-bold italic text-white"
        >
          H
        </div>
        <div>
          <h1 className="text-lg font-semibold tracking-tight">
            Hyperliquid{' '}
            <span className="hidden font-normal text-muted sm:inline">
              Terminal
            </span>
          </h1>
        </div>
        <span className="rounded border border-amber-300/20 bg-amber-300/5 px-1.5 py-0.5 text-[10px] font-medium tracking-wide text-amber-200">
          TESTNET
        </span>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-3">
        <a
          href="https://app.hyperliquid-testnet.xyz/drip"
          target="_blank"
          rel="noreferrer"
          className="text-xs text-muted hover:text-ink"
        >
          {t('测试币水龙头 ↗')}
        </a>
        <SmartPopover
          placement="bottom-end"
          trigger="click"
          triggerLabel={t('语言')}
          contentClassName="min-w-40 rounded-lg border border-edge bg-surface p-2 text-ink shadow-xl"
          content={({ closePopover }) => (
            <div role="menu" aria-label={t('语言')}>
              {(['zh-CN', 'en-US'] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  role="menuitemradio"
                  aria-checked={locale === value}
                  className={`flex w-full items-center justify-between rounded px-3 py-2 text-sm hover:bg-panel ${locale === value ? 'text-accent' : 'text-ink'}`}
                  onClick={() => {
                    setLocale(value)
                    closePopover()
                  }}
                >
                  {value === 'zh-CN' ? '简体中文' : 'English'}{' '}
                  <span>{locale === value ? '✓' : ''}</span>
                </button>
              ))}
            </div>
          )}
        >
          <span className="flex h-9 items-center gap-1.5 text-sm text-muted hover:text-ink">
            <svg
              aria-hidden="true"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <circle cx="12" cy="12" r="9" />
              <ellipse cx="12" cy="12" rx="4" ry="9" />
              <path d="M3 12h18M5 6h14M5 18h14" />
            </svg>
            {locale === 'zh-CN' ? '中文' : 'EN'}
          </span>
        </SmartPopover>
        {model.needsTradingConnection && (
          <Button
            variant="bordered"
            color="default"
            size="sm"
            type="button"
            className="shrink-0"
            isDisabled={busy}
            onClick={previewApproval}
          >
            {t('启用交易')}
          </Button>
        )}
        {wallet && (
          <Button
            size="sm"
            className="px-5"
            isDisabled={busy}
            onPress={() => model.setWeb3Panel('deposit')}
          >
            {t('存款')}
          </Button>
        )}
        {wallet ? (
          <Button
            variant="bordered"
            color="default"
            size="sm"
            type="button"
            className="shrink-0"
            onClick={() => model.setWeb3Panel('wallet')}
            isDisabled={busy}
          >
            {wallet.address.slice(0, 6)}…{wallet.address.slice(-4)} ▾
          </Button>
        ) : (
          <Button
            variant="solid"
            size="lg"
            type="button"
            onClick={connect}
            className="h-9 min-w-24 rounded-md px-4 text-sm"
          >
            {t('连接钱包')}
          </Button>
        )}
      </div>
    </header>
  )
}
