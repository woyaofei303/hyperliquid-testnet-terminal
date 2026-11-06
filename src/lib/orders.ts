import type {
  OrderParameters,
  OrderResponse,
} from '@nktkas/hyperliquid/api/exchange'
import { formatPrice } from '@nktkas/hyperliquid/utils'
import Decimal from 'decimal.js'
import { isCash, pricePrecision, quoteName } from './market-catalog.ts'

// 金额始终使用十进制；只有图表坐标和非交易统计才转为 number。
export const Money = Decimal.clone({ precision: 50 })

export interface Market {
  name: string
  kind?: 'perp' | 'spot' | 'outcome'
  base?: string
  quote?: string
  label?: string
  dex?: string
  baseToken?: number
  quoteToken?: number
  balanceCoin?: string
  canonical?: boolean
  outcome?: number
  eventTitle?: string
  outcomeTitle?: string
  category?: string
  venue?: string
  feeScale?: string
  deployerFeeScale?: string
  question?: number
  questionOutcomes?: number[]
  fallback?: boolean
  settled?: boolean
  paired?: string
  description?: string
  asset: number
  szDecimals: number
  maxLeverage: number
}

export interface OrderInput {
  market: Market
  side: 'buy' | 'sell'
  kind: 'limit' | 'market'
  price: string
  size: string
  reduceOnly: boolean
  tif?: 'Gtc' | 'Ioc' | 'Alo'
  slippageBps: number
}

export function formatOrderPrice(
  value: string,
  market: Pick<Market, 'kind' | 'szDecimals'>,
) {
  return market.kind === 'outcome'
    ? new Money(value).toDecimalPlaces(5).toFixed()
    : formatPrice(
        value,
        market.szDecimals,
        market.kind === 'spot' ? 'spot' : 'perp',
      )
}

export const minimumOrderValue = (market: Pick<Market, 'kind'>) =>
  market.kind === 'outcome' ? 1 : 10

export function positiveDecimal(value: string, label: string) {
  if (value.length > 40 || !/^(0|[1-9]\d*)(\.\d+)?$/.test(value.trim()))
    throw new Error(`${label}请输入普通十进制正数`)
  const amount = new Money(value.trim())
  if (!amount.isFinite() || amount.lte(0)) throw new Error(`${label}必须大于零`)
  return amount
}

export function slippageBps(value: string) {
  const bps = positiveDecimal(value, '滑点').times(100)
  if (!bps.isInteger() || bps.lt(1) || bps.gt(1000))
    throw new Error('滑点必须在 0.01% 至 10% 之间，最多两位小数')
  return bps.toNumber()
}

/** 构建开仓和 reduce-only 平仓请求，不静默截断用户输入。 */
export function prepareOrder(input: OrderInput) {
  const { market } = input
  if (input.tif && !['Gtc', 'Ioc', 'Alo'].includes(input.tif))
    throw new Error('订单有效方式无效')
  if (
    !Number.isSafeInteger(market.asset) ||
    market.asset < 0 ||
    !Number.isInteger(market.szDecimals) ||
    market.szDecimals < 0 ||
    market.szDecimals > (market.kind === 'spot' ? 8 : 6)
  )
    throw new Error('市场元数据无效')
  if (isCash(market) && input.reduceOnly)
    throw new Error('现货和预测不支持只减仓参数')
  if (market.kind === 'outcome' && market.szDecimals !== 0)
    throw new Error('预测合约数量必须为整数')
  const size = positiveDecimal(input.size, '数量')
  if (size.decimalPlaces() > market.szDecimals)
    throw new Error('数量精度超过市场允许的小数位')
  let price = positiveDecimal(input.price, '价格')
  if (input.kind === 'market') {
    if (
      !Number.isInteger(input.slippageBps) ||
      input.slippageBps < 1 ||
      input.slippageBps > 1000
    )
      throw new Error('滑点必须在 0.01% 至 10% 之间')
    const rounding =
      input.side === 'buy' ? Decimal.ROUND_FLOOR : Decimal.ROUND_CEIL
    price = price
      .times(
        new Money(10000).plus(
          input.side === 'buy' ? input.slippageBps : -input.slippageBps,
        ),
      )
      .div(10000)
    price = price
      .toSignificantDigits(5, rounding)
      .toDecimalPlaces(pricePrecision(market), rounding)
    if (market.kind === 'outcome')
      price = Money.min('0.99999', Money.max('0.00001', price))
    if (price.lte(0)) throw new Error('滑点价格低于最小报价精度')
  } else if (
    market.kind === 'outcome'
      ? price.decimalPlaces() > 5
      : formatPrice(
          price.toFixed(),
          market.szDecimals,
          market.kind === 'spot' ? 'spot' : 'perp',
        ) !== price.toFixed()
  ) {
    throw new Error(
      '价格不符合市场精度：非整数最多 5 位有效数字，并遵守价格小数位限制',
    )
  }
  if (market.kind === 'outcome' && (price.gte(1) || price.lt('0.00001')))
    throw new Error('预测价格必须在 0.00001 至 0.99999 之间')
  if (!input.reduceOnly && price.times(size).lt(minimumOrderValue(market)))
    throw new Error(
      `订单名义金额至少 ${minimumOrderValue(market)} ${quoteName(market)}`,
    )
  return {
    a: market.asset,
    b: input.side === 'buy',
    p: price.toFixed(),
    s: size.toFixed(),
    r: input.reduceOnly,
    t: {
      limit: { tif: input.kind === 'market' ? 'Ioc' : (input.tif ?? 'Gtc') },
    },
  } satisfies OrderParameters['orders'][number]
}

export function orderResult(
  response: OrderResponse,
  requestedSize: string,
  ioc = true,
) {
  const status = response.response.data.statuses[0]
  if (!status || typeof status === 'string')
    return {
      message: '订单已提交，等待交易所状态确认',
      state: 'pending',
      oid: undefined,
    }
  if ('error' in status)
    return {
      message: `拒单：${status.error}`,
      state: 'rejected',
      oid: undefined,
    }
  if ('resting' in status)
    return {
      message: `委托已挂单 #${status.resting.oid}`,
      state: 'resting',
      oid: status.resting.oid,
    }
  const partial = new Money(status.filled.totalSz).lt(requestedSize)
  return {
    message: `${partial ? (ioc ? '部分成交，剩余 IOC 数量已取消' : '部分成交，请核对剩余委托') : '全部成交'}：${status.filled.totalSz}，均价 ${status.filled.avgPx}`,
    state: partial ? 'partial' : 'filled',
    oid: status.filled.oid,
  }
}
