'use client'
import { formatPrice } from '@nktkas/hyperliquid/utils'
import { useEffect, useRef, useState } from 'react'
import {
  type Book,
  errorText,
  info,
  type MarketContext,
} from '@/lib/hyperliquid'
import {
  defaultOrderFields,
  type OrderFormFields,
} from '@/lib/order-form-fields'
import { maximumOrderSize, sizeFromAmount } from '@/lib/order-sizing'
import { type OrderKind, prepareTicket, type Ticket } from '@/lib/order-ticket'
import { Money, positiveDecimal, slippageBps } from '@/lib/orders'
import type { useMarginSettings } from './use-margin-settings'

export function useOrderForm({
  market,
  book,
  stale,
  current,
  position,
  onTicket,
}: {
  market: MarketContext
  book: Book | null
  stale: boolean
  current: ReturnType<typeof useMarginSettings>['current']
  position: string
  onTicket: (ticket: Ticket) => void
}) {
  const [fields, setFields] = useState(() => defaultOrderFields(market))
  const [error, setError] = useState('')
  const [feeData, setFeeData] = useState<{
    user: string
    maker: string
    taker: string
  } | null>(null)
  const [feeError, setFeeError] = useState('')
  const user = current?.user
  useEffect(() => {
    if (!user) return
    let active = true
    const load = async () => {
      try {
        const fees = await info.userFees({ user })
        if (active) {
          setFeeData({
            user,
            maker: fees.userAddRate,
            taker: fees.userCrossRate,
          })
          setFeeError('')
        }
      } catch (error) {
        if (active) setFeeError(errorText(error))
      }
    }
    void load()
    const timer = setInterval(load, 300000)
    return () => {
      active = false
      clearInterval(timer)
    }
  }, [user])
  const previousMarket = useRef(market.name)
  useEffect(() => {
    if (previousMarket.current === market.name) return
    previousMarket.current = market.name
    setFields((previous) => ({
      ...defaultOrderFields(market),
      side: previous.side,
      kind: previous.kind,
      tif: previous.tif,
      unit: previous.unit,
    }))
    setError('')
  }, [market])
  function change<K extends keyof OrderFormFields>(
    key: K,
    value: OrderFormFields[K],
  ) {
    setFields((previous) => ({ ...previous, [key]: value }))
    setError('')
  }
  const index = fields.side === 'buy' ? 0 : 1
  const marketPrice = book?.levels[fields.side === 'buy' ? 1 : 0][0]?.px ?? ''
  const price =
    fields.kind === 'market'
      ? marketPrice
      : fields.kind.endsWith('-market')
        ? fields.trigger
        : ['twap', 'trailing'].includes(fields.kind)
          ? market.context.markPx
          : fields.kind === 'scale'
            ? fields.upperPrice
            : fields.price
  let size = ''
  let maxSize = '0'
  let notional = '—'
  let margin = '—'
  let fee = '—'
  let percent = 0
  try {
    if (current)
      maxSize = maximumOrderSize({
        maxTradeSize: current.maxTradeSzs[index],
        position,
        side: fields.side,
        reduceOnly: fields.reduceOnly,
        markPrice: current.markPx,
        orderPrice: price,
        precision: market.szDecimals,
      })
    if (fields.amount) {
      size = sizeFromAmount(
        fields.amount,
        fields.unit,
        price,
        market.szDecimals,
      )
      let value = new Money(size).times(price)
      if (fields.kind === 'scale') {
        const scale = prepareTicket({
          ...fields,
          market,
          mark: market.context.markPx,
          size,
          slippageBps: 50,
        })
        if (scale.kind === 'orders')
          value = scale.orders.reduce(
            (sum, order) => sum.plus(new Money(order.p).times(order.s)),
            new Money(0),
          )
      }
      notional = value.toFixed(2)
      margin = fields.reduceOnly
        ? '0.00'
        : current
          ? value.div(current.leverage.value).toFixed(2)
          : '—'
      if (feeData && feeData.user === user) {
        const maker = value.times(feeData.maker).toFixed(4)
        const taker = value.times(feeData.taker).toFixed(4)
        fee =
          (fields.tif === 'Alo' && fields.kind === 'limit') ||
          fields.kind === 'chase'
            ? maker
            : fields.kind === 'limit' || fields.kind === 'scale'
              ? `${maker} – ${taker}`
              : taker
      }
      if (new Money(maxSize).gt(0))
        percent = Math.min(
          100,
          new Money(size).div(maxSize).times(100).toNumber(),
        )
    }
  } catch {
    /* 未完整的草稿不产生估算。 */
  }
  const reduceOnlyError =
    fields.reduceOnly && current
      ? maxSize === '0'
        ? '当前方向没有可减仓位'
        : new Money(size || 0).gt(maxSize)
          ? '只减仓数量超过可平仓位'
          : ''
      : ''
  function setPercent(value: number) {
    if (!Number.isFinite(value) || value < 0 || value > 100) return
    const quantity = new Money(maxSize)
      .times(value)
      .div(100)
      .toDecimalPlaces(market.szDecimals, Money.ROUND_DOWN)
    change(
      'amount',
      fields.unit === 'base'
        ? quantity.toFixed()
        : quantity.times(price).toFixed(6, Money.ROUND_DOWN),
    )
  }
  function setUnit(unit: 'base' | 'usdc') {
    let amount = ''
    try {
      if (size)
        amount =
          unit === 'base'
            ? size
            : new Money(size).times(price).toFixed(6, Money.ROUND_DOWN)
    } catch {
      /* 无效草稿切单位时清空。 */
    }
    setFields((previous) => ({ ...previous, unit, amount }))
  }
  function setKind(kind: OrderKind) {
    setFields((previous) => ({
      ...previous,
      kind,
    }))
    setError('')
  }
  function preview() {
    try {
      if (stale) throw new Error('行情已过期，等待恢复后再下单')
      if (!current) throw new Error('请等待账户下单额度读取完成')
      if (reduceOnlyError) throw new Error(reduceOnlyError)
      const quantity = sizeFromAmount(
        fields.amount,
        fields.unit,
        price,
        market.szDecimals,
      )
      if (positiveDecimal(quantity, '数量').gt(maxSize))
        throw new Error(
          fields.reduceOnly
            ? '只减仓数量超过可平仓位'
            : '数量超过当前最大可下数量',
        )
      const ticket = prepareTicket({
        ...fields,
        takeProfit:
          fields.protection && !fields.reduceOnly ? fields.takeProfit : '',
        stopLoss:
          fields.protection && !fields.reduceOnly ? fields.stopLoss : '',
        market,
        mark: market.context.markPx,
        price: fields.kind === 'market' ? marketPrice : fields.price,
        size: quantity,
        slippageBps: fields.kind.endsWith('-market')
          ? 1000
          : slippageBps(fields.slippage),
      })
      setError('')
      onTicket(ticket)
    } catch (error) {
      setError(errorText(error))
    }
  }
  return {
    fields,
    change,
    setKind,
    setUnit,
    setPercent,
    preview,
    error,
    reduceOnlyError,
    feeError,
    notional,
    margin,
    fee,
    size,
    maxSize,
    percent,
    available: current?.availableToTrade[index] ?? null,
    applyMarkPrice: () =>
      change(
        'price',
        market.context.markPx
          ? formatPrice(market.context.markPx, market.szDecimals)
          : '',
      ),
  }
}
