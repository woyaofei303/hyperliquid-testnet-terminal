import { parseAccountMode, sharedAccount } from './account-types.ts'
import { spotAvailable } from './funding.ts'
import { info, type MarketContext } from './hyperliquid.ts'
import { quoteName } from './market-catalog.ts'
import { Money, positiveDecimal } from './orders.ts'

export function removableMargin(
  margin: string,
  notional: string,
  leverage: number,
  strict: boolean,
) {
  if (strict) return '0'
  const value = positiveDecimal(notional, '仓位价值')
  if (!Number.isFinite(leverage) || leverage <= 0)
    throw new Error('仓位杠杆无效')
  return Money.max(
    0,
    new Money(margin).minus(Money.max(value.times('0.1'), value.div(leverage))),
  )
    .toDecimalPlaces(2, Money.ROUND_DOWN)
    .toFixed()
}
export function marginDelta(
  amount: string,
  available: string,
  direction: 'add' | 'remove',
) {
  const value = positiveDecimal(amount, '保证金金额')
  if (value.decimalPlaces() > 2) throw new Error('保证金金额最多 2 位小数')
  if (value.gt(available)) throw new Error('保证金金额超过当前可用上限')
  const delta = value
    .times(1000000)
    .times(direction === 'add' ? 1 : -1)
    .toNumber()
  if (!Number.isSafeInteger(delta)) throw new Error('保证金金额过大')
  return delta
}
export async function loadIsolatedMargin(
  user: `0x${string}`,
  market: MarketContext,
) {
  const [state, rawMode, spot] = await Promise.all([
    info.clearinghouseState({ user, dex: market.dex }),
    info.userAbstraction({ user }),
    info.spotClearinghouseState({ user }),
  ])
  const position = state.assetPositions.find(
    (item) => item.position.coin === market.name,
  )?.position
  if (!position || new Money(position.szi).eq(0))
    throw new Error('仓位已关闭，请刷新账户')
  if (position.leverage.type !== 'isolated')
    throw new Error('只有逐仓仓位可以调整保证金')
  const mode = parseAccountMode(rawMode),
    quote = quoteName(market)
  let available = state.withdrawable
  if (sharedAccount(mode)) available = spotAvailable(spot, quote, true)
  else if (mode === 'dexAbstraction')
    available =
      quote === 'USDC'
        ? market.dex
          ? (await info.clearinghouseState({ user })).withdrawable
          : state.withdrawable
        : spotAvailable(spot, quote, false)
  const strict =
    market.marginMode === 'strictIsolated' ||
    (market.onlyIsolated === true && market.marginMode !== 'noCross')
  return {
    position,
    add: Money.max(0, available).toDecimalPlaces(2, Money.ROUND_DOWN).toFixed(),
    remove: removableMargin(
      position.marginUsed,
      position.positionValue,
      position.leverage.value,
      strict,
    ),
    strict,
  }
}
