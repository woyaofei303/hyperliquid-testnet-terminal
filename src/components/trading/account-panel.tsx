import { Button, Input } from '@fameex/ui'
import type { TerminalModel } from '@/hooks/use-terminal'
import { accountTypeName, sharedAccount } from '@/lib/account-types'
import { cashBalances } from '@/lib/cash-order'
import { display } from '@/lib/display'
import { spotAvailable } from '@/lib/funding'
import { isCash, quoteName } from '@/lib/market-catalog'

/** FameEX FuturesAssetPanel 的纵向资产行；数值均取自 Hyperliquid 主账户。 */
export function AccountPanel({ model }: { model: TerminalModel }) {
  const {
    account,
    wallet,
    watchAddress,
    addressInput,
    setAddressInput,
    busy,
    watch,
  } = model
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
      ? '账户核验失败 · 请重试'
      : model.checkingAccount
        ? account.snapshot
          ? '正在核验交易连接'
          : '正在读取余额'
        : model.tradingReady
          ? '交易已启用'
          : '已连接 · 待启用交易'
    : watchAddress
      ? '只读观察'
      : '未连接'
  return (
    <section
      id="account-panel"
      aria-label="账户概览"
      className="min-h-0 overflow-auto rounded-sm bg-panel"
    >
      <h2 className="border-b border-edge px-3 py-3 text-sm font-medium">
        {cash
          ? '可用余额'
          : shared
            ? accountTypeName(account.snapshot?.mode)
            : '账户权益'}{' '}
        <span className="ml-2 text-xs font-normal text-muted">
          {quoteName(model.market)}
        </span>
      </h2>
      <dl className="space-y-2.5 px-3 py-3 text-xs">
        {(cash
          ? [
              ['报价资产', display(balances?.quote, 6)],
              [
                '持有数量',
                display(balances?.base, model.market?.szDecimals ?? 5),
              ],
            ]
          : shared
            ? [
                ['结算资产余额', display(collateral?.total)],
                ['已占用', display(collateral?.hold)],
                [
                  '可提余额',
                  display(
                    account.snapshot
                      ? spotAvailable(account.snapshot.spot, quote, true)
                      : undefined,
                  ),
                ],
              ]
            : [
                ['账户权益', display(state?.marginSummary.accountValue)],
                ['已用保证金', display(state?.marginSummary.totalMarginUsed)],
                ['可提余额', display(state?.withdrawable)],
                [
                  '现货 USDC 余额',
                  display(
                    account.snapshot?.spot.balances.find(
                      (item) => item.coin === 'USDC',
                    )?.total ?? (account.snapshot ? '0' : undefined),
                  ),
                ],
              ]
        )
          .concat([
            ['账户类型', accountTypeName(account.snapshot?.mode)],
            ['连接状态', mode],
          ])
          .map(([label, value]) => (
            <div key={label} className="flex justify-between gap-4">
              <dt className="text-muted">{label}</dt>
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
          存款
        </Button>
        <Button
          className="flex-1"
          size="sm"
          variant="bordered"
          isDisabled={busy}
          onPress={() => model.setWeb3Panel('transfer')}
        >
          划转
        </Button>
        <Button
          className="flex-1"
          size="sm"
          variant="bordered"
          isDisabled={busy}
          onPress={() => model.setWeb3Panel('withdraw')}
        >
          提款
        </Button>
      </div>
      <form
        className="flex items-end gap-2 border-t border-edge p-3"
        onSubmit={(event) => {
          event.preventDefault()
          watch()
        }}
      >
        <Input
          aria-label="只读钱包地址"
          value={addressInput}
          onChange={setAddressInput}
          placeholder="0x… 只读钱包地址"
          className="min-w-0 flex-1"
        />
        <Button
          type="submit"
          color="default"
          size="sm"
          className="h-10 min-w-12 px-3"
          isDisabled={busy}
        >
          查看
        </Button>
      </form>
    </section>
  )
}
