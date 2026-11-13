import { Button, ChartIcon, SmartPopover } from '@fameex/ui'
import Image from 'next/image'
import Link from 'next/link'
import type { TerminalModel } from '@/features/terminal/hooks/use-terminal'
import { setLocale, t, useLocale } from '@/i18n'
import { TradeSettings } from '../../trading/components/trade-settings'
export function Header({
  model,
  view = 'trade',
}: {
  model: TerminalModel
  view?: 'trade' | 'outcomes'
}) {
  const locale = useLocale()

  const { wallet, busy, connect } = model
  return (
    <header className="flex min-h-14 shrink-0 flex-wrap items-center justify-between gap-x-6 gap-y-2 border-b border-edge bg-panel px-4 py-2">
      <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2 sm:gap-x-8">
        <h1 className="flex shrink-0 items-center gap-2">
          <Image
            src="/fameex-logo.svg"
            alt="FameEX"
            width={91}
            height={20}
            className="h-6 w-auto"
          />
          <span className="rounded border border-accent/30 bg-accent/10 px-1.5 py-0.5 text-xs font-medium leading-4 text-accent">
            testnet
          </span>
        </h1>
        <nav
          aria-label={t('产品导航')}
          className="flex items-center gap-3 text-sm sm:gap-6"
        >
          <Link
            href="/"
            aria-current={view === 'trade' ? 'page' : undefined}
            className="flex h-10 items-center border-b-2 border-transparent px-1 text-muted transition-colors hover:text-ink aria-[current=page]:border-accent aria-[current=page]:font-semibold aria-[current=page]:text-ink motion-reduce:transition-none"
          >
            {t('交易')}
          </Link>
          <Link
            href="/outcomes"
            aria-current={view === 'outcomes' ? 'page' : undefined}
            className="flex h-10 items-center border-b-2 border-transparent px-1 text-muted transition-colors hover:text-ink aria-[current=page]:border-accent aria-[current=page]:font-semibold aria-[current=page]:text-ink motion-reduce:transition-none"
          >
            {t('预测')}
          </Link>
          <Link
            href="/connect"
            className="flex h-10 items-center px-1 text-muted hover:text-ink"
          >
            连接手机 App
          </Link>
        </nav>
        <a
          href="https://app.hyperliquid-testnet.xyz/drip"
          target="_blank"
          rel="noreferrer"
          className="text-xs text-muted hover:text-ink"
        >
          {t('水龙头')}
        </a>
      </div>
      <div className="ml-auto flex shrink-0 flex-wrap items-center gap-2">
        {wallet && (
          <Button
            size="sm"
            className="h-9 rounded-md px-4 text-sm"
            isDisabled={busy}
            onPress={() => model.setWeb3Panel('deposit')}
          >
            {t('存款')}
          </Button>
        )}
        {wallet ? (
          <Button
            color="default"
            size="sm"
            type="button"
            className="h-9 shrink-0 gap-2 rounded-md px-3 text-sm"
            onClick={() => model.setWeb3Panel('wallet')}
            isDisabled={busy}
          >
            {wallet.address.slice(0, 6)}…{wallet.address.slice(-4)}
            <ChartIcon name="arrow-drop-down" className="size-4 shrink-0" />
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
        <SmartPopover
          placement="bottom-end"
          trigger="click"
          triggerLabel={t('语言')}
          triggerClassName="flex h-9 min-w-9 items-center justify-center gap-1.5 rounded-md px-2 text-sm text-muted hover:bg-surface hover:text-ink aria-expanded:bg-surface aria-expanded:text-ink"
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
                  {locale === value && (
                    <ChartIcon name="check-2" className="size-4" />
                  )}
                </button>
              ))}
            </div>
          )}
        >
          <ChartIcon name="language" className="size-5 shrink-0" />
          <span className="hidden sm:inline">
            {locale === 'zh-CN' ? '中文' : 'EN'}
          </span>
        </SmartPopover>
        <TradeSettings />
      </div>
    </header>
  )
}
