import { useEffect, useEffectEvent, useRef, useState } from 'react'
import {
  cashBalances,
  cashTicketValue,
  cashTwapPrice,
  loadCashFunds,
  prepareCashTicket,
} from '@/features/trading/lib/cash-order'
import { marketFees } from '@/features/trading/lib/market-fees'
import {
  type BookPriceSelection,
  defaultOrderFields,
  type OrderFormFields,
} from '@/features/trading/lib/order-form-fields'
import {
  amountFromPercent,
  quoteAmount,
  sizeFromAmount,
} from '@/features/trading/lib/order-sizing'
import {
  type OrderKind,
  prepareTicket,
  scalePlan,
  supportedOrderKinds,
} from '@/features/trading/lib/order-ticket'
import {
  Money,
  marketOrderPrice,
  marketReferencePrice,
  positiveDecimal,
  slippageBps,
} from '@/features/trading/lib/orders'
import { predictionEstimate } from '@/features/trading/lib/prediction-order'
import {
  errorText,
  info,
  type MarketContext,
} from '@/shared/lib/fameex-testnet'
import type { TerminalModel } from '../../terminal/hooks/use-terminal'

export function useCashOrderForm(model: TerminalModel, market: MarketContext) {
  const [fields, setFields] = useState(() => defaultOrderFields(market))
  const outcome = market.kind === 'outcome'
  const [fee, setFee] = useState<{
    user: string
    data: Awaited<ReturnType<typeof info.userFees>>
  } | null>(null)
  useEffect(() => {
    const intent = model.cashOrderIntent
    if (intent?.coin === market.name)
      setFields((previous) => ({
        ...previous,
        side: 'sell',
        kind: 'market',
        unit: 'base',
        amount: intent.amount,
      }))
  }, [model.cashOrderIntent, market.name])
  const [error, setError] = useState('')
  const selectedPercent = useRef<number | null>(null)
  const appliedBookPrice = useRef(model.bookPrice)
  const [previewing, setPreviewing] = useState(false)
  const context = useRef({ model, fields, active: true })
  context.current.model = model
  context.current.fields = fields
  const { address, account } = model
  useEffect(() => {
    context.current.active = true
    return () => {
      context.current.active = false
    }
  }, [])
  useEffect(() => {
    let active = true
    if (address)
      void info
        .userFees({ user: address })
        .then((data) => {
          if (active)
            setFee({
              user: address,
              data,
            })
        })
        .catch((e) => {
          if (active) setError(errorText(e))
        })
    return () => {
      active = false
    }
  }, [address])
  function change<K extends keyof OrderFormFields>(
    key: K,
    value: OrderFormFields[K],
  ) {
    if (key === 'amount' || key === 'side' || key === 'kind')
      selectedPercent.current = null
    if (
      !outcome &&
      key === 'price' &&
      typeof value === 'string' &&
      fields.kind === 'limit'
    ) {
      let amount = fields.amount
      try {
        if (
          balances &&
          rate != null &&
          amount &&
          (selectedPercent.current != null ||
            (new Money(max).gt(0) && new Money(size).lte(max)))
        ) {
          const price = positiveDecimal(value, '价格')
          const maximum = (
            fields.side === 'sell'
              ? new Money(balances.base)
              : new Money(balances.quote).div(price)
          )
            .toDecimalPlaces(market.szDecimals, Money.ROUND_DOWN)
            .toFixed()
          amount = amountFromPercent(
            maximum,
            selectedPercent.current ?? percent,
            fields.unit,
            value,
            market.szDecimals,
          )
        }
      } catch {
        // 价格还未输入完整时保留原数量。
      }
      setFields((previous) => ({ ...previous, price: value, amount }))
    } else {
      setFields((previous) => ({ ...previous, [key]: value }))
    }
    if (key === 'twapTrigger') {
      setFields((previous) => ({
        ...previous,
        twapAbove: Number(value) > Number(market.context.markPx),
      }))
    }
    setError('')
  }
  function setKind(kind: OrderKind) {
    if (supportedOrderKinds(market).some(([key]) => key === kind))
      change('kind', kind)
  }
  let balances: ReturnType<typeof cashBalances> | null = null
  let balanceError = ''
  try {
    if (account.snapshot?.spot)
      balances = cashBalances(
        market,
        account.snapshot.spot.balances,
        account.snapshot.mode === 'portfolioMargin'
          ? account.snapshot.borrowReserves
          : undefined,
      )
  } catch (e) {
    balanceError = errorText(e)
  }
  let rates: { taker: string; maker: string } | null = null
  let feeError = ''
  try {
    if (fee?.user === address) rates = marketFees(market, fee.data, fields.side)
  } catch (e) {
    feeError = errorText(e)
  }
  const rate =
    rates && !feeError ? Money.max(0, rates.taker, rates.maker).toFixed() : null
  const effectivePrice =
    fields.kind === 'market'
      ? marketReferencePrice(model.feed.book, market.context.markPx)
      : fields.price
  let sizePrice =
    fields.kind === 'scale'
      ? fields.upperPrice
      : fields.kind === 'twap'
        ? market.context.markPx
        : effectivePrice
  if (fields.kind === 'market' && fields.side === 'buy') {
    try {
      sizePrice = marketOrderPrice(
        effectivePrice,
        market,
        'buy',
        slippageBps(fields.slippage),
      )
    } catch {
      sizePrice = ''
    }
  }
  if (fields.kind === 'scale') {
    try {
      sizePrice = scalePlan(fields, market).average
    } catch {
      sizePrice = ''
    }
  }
  if (fields.kind === 'twap') {
    try {
      sizePrice = cashTwapPrice(
        market.context.markPx,
        fields.side === 'buy',
        fields.twapTrigger,
        fields.twapLimit,
      ).toFixed()
    } catch {
      sizePrice = ''
    }
  }
  let size = ''
  try {
    if (fields.amount)
      size = sizeFromAmount(
        fields.amount,
        fields.unit,
        sizePrice,
        market.szDecimals,
      )
  } catch {
    /* 未完成的金额不转换为数量。 */
  }
  const input = () => ({
    ...fields,
    market,
    mark: market.context.markPx || effectivePrice,
    price: effectivePrice,
    size,
    slippageBps: slippageBps(fields.slippage),
  })
  const prepare = () => prepareTicket(input())
  const latestInput = useRef(input())
  latestInput.current = input()
  let notional = '—',
    estimatedFee = '—',
    max = '0',
    estimatedSlippage = fields.amount ? 'N/A' : '0%'
  try {
    let budgetPrice = new Money(
      fields.kind === 'scale' ? fields.upperPrice : effectivePrice,
    )
    if (fields.kind === 'market' && fields.side === 'buy')
      budgetPrice = new Money(sizePrice)
    if (fields.kind === 'scale')
      budgetPrice =
        fields.unit === 'usdc'
          ? new Money(sizePrice)
          : Money.max(fields.price, fields.upperPrice)
    if (fields.kind === 'twap') budgetPrice = new Money(sizePrice)
    if (balances && rate != null) {
      if (fields.side === 'sell') max = balances.base
      else if (budgetPrice.gt(0))
        max = new Money(balances.quote).div(budgetPrice).toFixed()
      max = new Money(max)
        .toDecimalPlaces(market.szDecimals, Money.ROUND_DOWN)
        .toFixed()
    }
    if (fields.amount) {
      const ticket = prepare()
      size = ticket.size
      const estimate =
        outcome && fields.kind === 'market'
          ? predictionEstimate(
              size,
              model.feed.book?.levels[fields.side === 'buy' ? 1 : 0] ?? [],
            )
          : null
      if (estimate) estimatedSlippage = estimate.slippage
      const value =
        outcome && fields.kind === 'market'
          ? estimate?.value
            ? new Money(estimate.value)
            : new Money(size).times(effectivePrice)
          : cashTicketValue(ticket)
      notional = value.toFixed(4)
      if (rate != null)
        estimatedFee = new Money(
          !outcome && fields.side === 'buy' ? size : value,
        )
          .times(rate)
          .toFixed(8)
    }
  } catch {
    /* 未完成的草稿不产生估算。 */
  }
  const percent =
    size && new Money(max).gt(0)
      ? Math.min(100, new Money(size).div(max).times(100).toNumber())
      : 0
  useEffect(() => {
    if (selectedPercent.current == null) return
    try {
      positiveDecimal(sizePrice, '价格')
      const amount = amountFromPercent(
        max,
        selectedPercent.current,
        fields.unit,
        sizePrice,
        market.szDecimals,
      )
      setFields((previous) =>
        previous.amount === amount ? previous : { ...previous, amount },
      )
    } catch {
      // 价格尚未完整时保留比例草稿。
    }
  }, [max, sizePrice, fields.unit, market.szDecimals])
  const applyBookPrice = useEffectEvent(
    (selection: BookPriceSelection | null) => {
      if (selection?.coin === market.name && fields.kind === 'limit')
        change('price', selection.price)
    },
  )
  useEffect(() => {
    if (appliedBookPrice.current === model.bookPrice) return
    appliedBookPrice.current = model.bookPrice
    applyBookPrice(model.bookPrice)
  }, [model.bookPrice])

  function setUnit(unit: 'base' | 'usdc') {
    if (unit === fields.unit) return
    try {
      const amount = size
        ? unit === 'base'
          ? size
          : quoteAmount(size, sizePrice)
        : ''
      setFields((previous) => ({ ...previous, unit, amount }))
      setError('')
    } catch (e) {
      setError(errorText(e))
    }
  }
  async function preview() {
    if (previewing) return
    setPreviewing(true)
    try {
      if (!model.canTrade || model.feed.stale || !address)
        throw new Error('等待账户、费率和实时行情就绪')
      const funds = await loadCashFunds(market, address)
      const latest = context.current.model
      if (
        !context.current.active ||
        context.current.fields !== fields ||
        latest.address !== address ||
        latest.coin !== market.name ||
        !latest.canTrade ||
        latest.feed.stale
      )
        return
      const ticket = prepareCashTicket(
        latestInput.current,
        funds.balances,
        funds.feeRate,
      )
      latest.previewTicket(ticket)
      setError('')
    } catch (e) {
      if (
        context.current.active &&
        context.current.fields === fields &&
        context.current.model.coin === market.name &&
        context.current.model.address === address
      )
        setError(errorText(e))
    } finally {
      if (context.current.active) setPreviewing(false)
    }
  }
  return {
    fields,
    size,
    change,
    setKind,
    setUnit,
    percent,
    error: error || balanceError || feeError,
    rates,
    notional,
    estimatedFee,
    estimatedSlippage,
    max,
    balances,
    ready: rate != null && balances != null,
    preview,
    previewing,
    setPercent: (value: number) => {
      if (!Number.isFinite(value) || value < 0 || value > 100) return
      try {
        change(
          'amount',
          amountFromPercent(
            max,
            value,
            fields.unit,
            sizePrice,
            market.szDecimals,
          ),
        )
        selectedPercent.current = value
      } catch (e) {
        setError(errorText(e))
      }
    },
  }
}
