import { info } from '../../../shared/lib/fameex-testnet.ts'
import { availableBalance } from '../../trading/lib/cash-order.ts'
import { Money, positiveDecimal } from '../../trading/lib/orders.ts'
import { parseAccountMode } from './account-types.ts'

export type TransferRoute = {
  sourceDex: string
  destinationDex: string
  token: number
}
type Token = {
  index: number
  name: string
  tokenId: string
  weiDecimals: number
}
export type TransferCatalog = {
  tokens: Token[]
  venues: { dex: string; token: number }[]
}

export async function loadTransferCatalog(): Promise<TransferCatalog> {
  const [metas, dexes, spot] = await Promise.all([
    info.allPerpMetas(),
    info.perpDexs(),
    info.spotMeta(),
  ])
  const venues = metas.flatMap((meta, index) => {
    const dex = index === 0 ? '' : dexes[index]?.name
    return dex == null ? [] : [{ dex, token: meta.collateralToken ?? 0 }]
  })
  return {
    venues,
    tokens: spot.tokens.filter((token) =>
      venues.some((venue) => venue.token === token.index),
    ),
  }
}

export function transferToken(catalog: TransferCatalog, route: TransferRoute) {
  if (route.sourceDex === route.destinationDex)
    throw new Error('划转来源与目标不能相同')
  const token = catalog.tokens.find((item) => item.index === route.token)
  if (
    !token ||
    !/^0x[0-9a-f]{32}$/i.test(token.tokenId) ||
    !Number.isInteger(token.weiDecimals) ||
    token.weiDecimals < 0 ||
    token.weiDecimals > 18
  )
    throw new Error('划转币种元数据无效')
  for (const dex of [route.sourceDex, route.destinationDex]) {
    if (dex === 'spot') continue
    const venue = catalog.venues.find((item) => item.dex === dex)
    if (!venue) throw new Error('划转 DEX 不存在')
    if (venue.token !== route.token)
      throw new Error('划转币种与 DEX 抵押币不匹配')
  }
  return token
}

export function internalTransferAmount(
  value: string,
  available: string,
  token: Pick<Token, 'name' | 'weiDecimals'>,
) {
  const amount = positiveDecimal(value, '金额')
  if (amount.decimalPlaces() > token.weiDecimals)
    throw new Error(`${token.name} 金额精度最多 ${token.weiDecimals} 位小数`)
  const balance = new Money(available)
  if (!balance.isFinite() || balance.lt(0))
    throw new Error('可用余额无效，请刷新后重试')
  if (amount.gt(balance)) throw new Error('划转金额超过可用余额')
  return amount.toFixed()
}

export async function loadTransferQuote(
  user: `0x${string}`,
  route: TransferRoute,
) {
  const [catalog, rawMode] = await Promise.all([
    loadTransferCatalog(),
    info.userAbstraction({ user }),
  ])
  const mode = parseAccountMode(rawMode)
  if (!['disabled', 'default', 'dexAbstraction'].includes(mode))
    throw new Error('独立账户划转仅适用于手动模式；共享账户无需在 DEX 之间划转')
  if (
    mode === 'dexAbstraction' &&
    (route.token !== 0 ||
      !['', 'spot'].includes(route.sourceDex) ||
      !['', 'spot'].includes(route.destinationDex))
  )
    throw new Error('旧版 DEX 模式仅支持原生合约与现货之间划转 USDC')
  const token = transferToken(catalog, route)
  const available =
    route.sourceDex === 'spot'
      ? availableBalance(
          (await info.spotClearinghouseState({ user })).balances,
          token.name,
          token.index,
        )
      : (await info.clearinghouseState({ user, dex: route.sourceDex }))
          .withdrawable
  if (!new Money(available).isFinite() || new Money(available).lt(0))
    throw new Error('可用余额无效，请刷新后重试')
  return { ...route, user, asset: token, available }
}
export type TransferQuote = Awaited<ReturnType<typeof loadTransferQuote>>
