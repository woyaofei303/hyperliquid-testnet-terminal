import { Button } from '@fameex/ui'
import { balanceValues } from '@/features/assets/lib/account-records'
import {
  marketLabel,
  pricePrecision,
} from '@/features/market/lib/market-catalog'
import type { TerminalModel } from '@/features/terminal/hooks/use-terminal'
import { t } from '@/i18n'
import { display } from '@/shared/lib/display'

export function AssetBalances({
  model,
  prediction,
  coinFilter,
}: {
  model: TerminalModel
  prediction: boolean
  coinFilter: string
}) {
  const balances = (model.account.snapshot?.spot.balances ?? []).filter(
    (b) =>
      b.coin.startsWith('+') === prediction &&
      (Number(b.total) !== 0 || Number(b.hold) !== 0) &&
      (coinFilter === 'all' || coinFilter === b.coin),
  )
  const headers = prediction
    ? [
        '市场',
        '数量',
        '可用数量',
        '仓位价值',
        '开仓均价',
        '标记价格',
        '盈亏 / 收益率',
        '操作',
      ]
    : ['资产', '总余额', '可用余额', 'USDC 价值', '盈亏 / 收益率', '操作']
  return (
    <table
      aria-label={t(prediction ? '预测持仓' : '余额')}
      className="w-full whitespace-nowrap text-left text-xs tabular-nums"
    >
      <thead className="sticky top-0 bg-panel text-muted">
        <tr>
          {headers.map((label) => (
            <th key={label} className="px-4 py-3 font-normal">
              {t(label)}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {!prediction &&
          model.account.snapshot &&
          (coinFilter === 'all' || coinFilter === 'USDC') && (
            <tr className="border-t border-edge">
              <td className="px-4 py-3">USDC ({t('合约')})</td>
              <td className="px-4">
                {display(
                  model.account.snapshot.state.marginSummary.accountValue,
                  4,
                )}
              </td>
              <td className="px-4">
                {display(model.account.snapshot.state.withdrawable, 4)}
              </td>
              <td className="px-4">
                {display(
                  model.account.snapshot.state.marginSummary.accountValue,
                  2,
                )}
              </td>
              <td className="px-4">—</td>
              <td className="px-4">
                <Button
                  size="sm"
                  variant="light"
                  isDisabled={model.busy}
                  onPress={() => {
                    model.setTransferToPerp(false)
                    model.setWeb3Panel('transfer')
                  }}
                >
                  {t('转账至现货')}
                </Button>
              </td>
            </tr>
          )}
        {balances.map((b) => {
          const market = model.markets.find((m) =>
            prediction
              ? m.balanceCoin === b.coin
              : m.kind === 'spot' && m.base === b.coin && m.quote === 'USDC',
          )
          const mark =
            b.coin === 'USDC'
              ? '1'
              : model.market?.name === market?.name
                ? (model.market?.context.markPx ?? '')
                : (market?.context.markPx ?? '')
          let values: ReturnType<typeof balanceValues>
          try {
            values = balanceValues(b, mark)
          } catch {
            values = {
              available: '—',
              value: null,
              entryPrice: null,
              pnl: null,
              roe: null,
            }
          }
          const label = market ? marketLabel(market) : b.coin
          return (
            <tr key={b.coin} className="border-t border-edge">
              <td className="max-w-80 truncate px-4 py-3" title={label}>
                {market ? (
                  <button
                    className="text-accent"
                    type="button"
                    onClick={() => model.selectMarket(market.name)}
                  >
                    {prediction ? label : b.coin}
                  </button>
                ) : (
                  b.coin
                )}
                {!prediction && b.coin === 'USDC' && ` (${t('现货')})`}
              </td>
              <td className="px-4">{b.total}</td>
              <td className="px-4">{values.available}</td>
              <td className="px-4">
                {values.value == null
                  ? '—'
                  : `${display(values.value, 4)} ${market?.quote ?? 'USDC'}`}
              </td>
              {prediction && (
                <>
                  <td className="px-4">
                    {values.entryPrice == null
                      ? '—'
                      : display(values.entryPrice, 5)}
                  </td>
                  <td className="px-4">
                    {mark
                      ? display(mark, market ? pricePrecision(market) : 5)
                      : '—'}
                  </td>
                </>
              )}
              <td
                className={`px-4 ${values.pnl == null ? 'text-muted' : Number(values.pnl) >= 0 ? 'text-mint' : 'text-loss'}`}
              >
                {values.pnl == null
                  ? '—'
                  : `${display(values.pnl, 4)} (${display(values.roe, 2)}%)`}
              </td>
              <td className="px-4">
                {b.coin === 'USDC' && !prediction ? (
                  <Button
                    size="sm"
                    variant="light"
                    isDisabled={model.busy}
                    onPress={() => {
                      model.setTransferToPerp(true)
                      model.setWeb3Panel('transfer')
                    }}
                  >
                    {t('转账至合约')}
                  </Button>
                ) : (
                  market && (
                    <Button
                      size="sm"
                      variant="light"
                      isDisabled={
                        model.busy ||
                        Number(values.available) <= 0 ||
                        values.available === '—'
                      }
                      onPress={() =>
                        model.sellCashBalance(market.name, values.available)
                      }
                    >
                      {t('卖出')}
                    </Button>
                  )
                )}
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
