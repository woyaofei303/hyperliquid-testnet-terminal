import { Button } from '@fameex/ui'
import type { TerminalModel } from '@/hooks/use-terminal'
export function Header({ model }: { model: TerminalModel }) {
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
        <nav
          aria-label="交易导航"
          className="ml-5 hidden items-center gap-6 text-sm lg:flex"
        >
          <a href="#market-panel" className="font-semibold text-ink">
            交易
          </a>
          <a href="#trading-records" className="text-muted hover:text-ink">
            投资组合
          </a>
          <a href="#account-panel" className="text-muted hover:text-ink">
            账户
          </a>
          <a
            href="https://app.hyperliquid-testnet.xyz/explorer"
            target="_blank"
            rel="noopener noreferrer"
            className="text-muted hover:text-ink"
          >
            浏览器 ↗
          </a>
        </nav>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-3">
        <a
          href="https://app.hyperliquid-testnet.xyz/drip"
          target="_blank"
          rel="noreferrer"
          className="text-xs text-muted hover:text-ink"
        >
          测试币水龙头 ↗
        </a>
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
            启用交易
          </Button>
        )}
        {wallet && (
          <Button
            size="sm"
            className="px-5"
            isDisabled={busy}
            onPress={() => model.setWeb3Panel('deposit')}
          >
            存款
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
            连接钱包
          </Button>
        )}
      </div>
    </header>
  )
}
