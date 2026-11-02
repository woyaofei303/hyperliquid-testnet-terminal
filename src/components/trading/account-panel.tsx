import { Button } from '@fameex/ui'
import type { TerminalModel } from '@/hooks/use-terminal'
import { t, useLocale } from '@/i18n'
import { accountTypeName, sharedAccount } from '@/lib/account-types'
import { cashBalances } from '@/lib/cash-order'
import { display } from '@/lib/display'
import { spotAvailable } from '@/lib/funding'
import { isCash, quoteName } from '@/lib/market-catalog'

/** FameEX FuturesAssetPanel 的纵向资产行；数值均取自 Hyperliquid 主账户。 */
export function AccountPanel({ model }: { model: TerminalModel }) {
  useLocale()

  const { account, wallet, busy } = model
  const cash = isCash(model.market)
  const balances =
    model.market && account.snapshot?.spot
      ? cashBalances(model.market, account.snapshot.spot.balances)
      : null
  const state = account.snapshot?.state
  const shared = sharedAccount(account.snapshot?.mode)
  const quote = quoteName(model.market)
  const collateral = account.snapshot?.spot.balances.find(
    (item) => item.coin === quote,
  )
  const mode = wallet
    ? account.error || model.connectionError
      ? t('账户核验失败 · 请重试')
      : model.checkingAccount
        ? account.snapshot
          ? t('正在核验交易连接')
          : t('正在读取余额')
        : model.tradingReady
          ? t('交易已启用')
          : t('已连接 · 待启用交易')
    : t('未连接')
  return (
    <section
      id="account-panel"
      aria-label={t('账户概览')}
      className="min-h-0 overflow-auto rounded-sm bg-panel"
    >
      <h2 className="border-b border-edge px-3 py-3 text-sm font-medium">
        {cash
          ? t('可用余额')
          : shared
            ? t(accountTypeName(account.snapshot?.mode))
            : t('账户权益')}{' '}
        <span className="ml-2 text-xs font-normal text-muted">
          {quoteName(model.market)}
        </span>
      </h2>
      <dl className="space-y-2.5 px-3 py-3 text-xs">
        {(cash
          ? [
              [t('报价资产'), display(balances?.quote, 6)],
              [
                t('持有数量'),
                display(balances?.base, model.market?.szDecimals ?? 5),
              ],
            ]
          : shared
            ? [
                [t('结算资产余额'), display(collateral?.total)],
                [t('已占用'), display(collateral?.hold)],
                [
                  t('可提余额'),
                  display(
                    account.snapshot
                      ? spotAvailable(account.snapshot.spot, quote, true)
                      : undefined,
                  ),
                ],
              ]
            : [
                [t('账户权益'), display(state?.marginSummary.accountValue)],
                [
                  t('已用保证金'),
                  display(state?.marginSummary.totalMarginUsed),
                ],
                [t('可提余额'), display(state?.withdrawable)],
                [
                  t('现货 USDC 余额'),
                  display(
                    account.snapshot?.spot.balances.find(
                      (item) => item.coin === 'USDC',
                    )?.total ?? (account.snapshot ? '0' : undefined),
                  ),
                ],
              ]
        )
          .concat([
            [t('账户类型'), t(accountTypeName(account.snapshot?.mode))],
            [t('连接状态'), mode],
          ])
          .map(([label, value]) => (
            <div key={t(label)} className="flex justify-between gap-4">
              <dt className="text-muted">{t(label)}</dt>
              <dd className="text-right tabular-nums">{value}</dd>
            </div>
          ))}
      </dl>
      <div className="grid grid-cols-2 gap-2 border-t border-edge p-3">
        <Button
          className="col-span-2"
          size="sm"
          isDisabled={busy}
          onPress={() => model.setWeb3Panel('deposit')}
        >
          {t('存款')}
        </Button>
        <Button
          className="flex-1"
          size="sm"
          variant="bordered"
          isDisabled={busy}
          onPress={() => model.setWeb3Panel('transfer')}
        >
          {t('划转')}
        </Button>
        <Button
          className="flex-1"
          size="sm"
          variant="bordered"
          isDisabled={busy}
          onPress={() => model.setWeb3Panel('withdraw')}
        >
          {t('提款')}
        </Button>
      </div>
    </section>
  )
}
