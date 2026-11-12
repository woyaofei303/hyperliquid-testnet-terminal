import { useEffect, useEffectEvent, useRef, useState } from 'react'
import {
  cashBalances,
  cashTicketValue,
  loadCashFunds,
  prepareCashTicket,
  validateCashTicketFunds,
} from '@/features/trading/lib/cash-order'
import {
  type BookPriceSelection,
  defaultOrderFields,
  type OrderFormFields,
} from '@/features/trading/lib/order-form-fields'
import {
  amountFromPercent,
  sizeFromAmount,
} from '@/features/trading/lib/order-sizing'
import {
  type OrderKind,
  prepareTicket,
  supportedOrderKinds,
} from '@/features/trading/lib/order-ticket'
import {
  Money,
  positiveDecimal,
  slippageBps,
} from '@/features/trading/lib/orders'
import {
  predictionEstimate,
  predictionFees,
  predictionScale,
  preparePredictionTicket,
} from '@/features/trading/lib/prediction-order'
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
    rate: string
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
  const context = useRef({ model, active: true })
  context.current.model = model
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
              rate: Money.max(
                0,
                data.userSpotCrossRate,
                data.userSpotAddRate,
              ).toFixed(),
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
              : new Money(balances.quote).div(
                  price.times(new Money(1).plus(rate)),
                )
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
    setError('')
  }
  function setKind(kind: OrderKind) {
    if (supportedOrderKinds(market).some(([key]) => key === kind))
      change('kind', kind)
  }
  const balances = account.snapshot?.spot
    ? cashBalances(market, account.snapshot.spot.balances)
    : null
  let rates: { taker: string; maker: string } | null = null
  let feeError = ''
  try {
    if (fee?.user === address && outcome)
      rates = predictionFees(market, fee.data, fields.side)
  } catch (e) {
    feeError = errorText(e)
  }
  const rate =
    fee?.user === address && !feeError
      ? outcome
        ? fields.side === 'buy'
          ? '0'
          : (rates?.taker ?? null)
        : fee.rate
      : null
  const effectivePrice =
    fields.kind === 'market'
      ? (model.feed.book?.levels[fields.side === 'buy' ? 1 : 0][0]?.px ??
        (outcome ? market.context.markPx : ''))
      : fields.price
  let sizePrice =
    fields.kind === 'scale'
      ? fields.upperPrice
      : fields.kind === 'twap'
        ? market.context.markPx
        : effectivePrice
  if (outcome && fields.kind === 'scale') {
    try {
      sizePrice = predictionScale(fields, market).average
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
  const prepare = () =>
    outcome ? preparePredictionTicket(input()) : prepareTicket(input())
  let notional = '—',
    estimatedFee = '—',
    max = '0',
    estimatedSlippage = fields.amount ? 'N/A' : '0%'
  try {
    let budgetPrice = new Money(
      fields.kind === 'scale' ? fields.upperPrice : effectivePrice,
    )
    if (fields.kind === 'market' && fields.side === 'buy')
      budgetPrice = budgetPrice.times(
        new Money(1).plus(new Money(fields.slippage).div(100)),
      )
    if (outcome && fields.kind === 'market')
      budgetPrice = Money.min('0.99999', budgetPrice)
    if (outcome && fields.kind === 'scale')
      budgetPrice =
        fields.unit === 'usdc'
          ? new Money(sizePrice)
          : Money.max(fields.price, fields.upperPrice)
    if (fields.kind === 'twap')
      budgetPrice = fields.twapLimit
        ? new Money(fields.twapLimit)
        : Money.max(market.context.markPx, fields.twapTrigger || 0).times(
            fields.side === 'buy' ? '1.03' : '0.97',
          )
    if (balances && rate != null) {
      if (fields.side === 'sell') max = balances.base
      else if (budgetPrice.gt(0))
        max = new Money(balances.quote)
          .div(budgetPrice.times(new Money(1).plus(rate)))
          .toFixed()
      max = new Money(max)
        .toDecimalPlaces(market.szDecimals, Money.ROUND_DOWN)
        .toFixed()
    }
    if (fields.amount) {
      const ticket = prepare()
      if (outcome) size = ticket.size
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
      if (rate != null) estimatedFee = value.times(rate).toFixed(4)
    }
  } catch {
    /* 未完成的草稿不产生估算。 */
  }
  const percent =
    size && new Money(max).gt(0)
      ? Math.min(100, new Money(size).div(max).times(100).toNumber())
      : 0
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
    try {
      const amount = size
        ? unit === 'base'
          ? size
          : new Money(size)
              .times(positiveDecimal(sizePrice, '价格'))
              .toFixed(6, Money.ROUND_DOWN)
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
        latest.address !== address ||
        latest.coin !== market.name ||
        !latest.canTrade ||
        latest.feed.stale
      )
        return
      const ticket = outcome
        ? prepare()
        : prepareCashTicket(input(), funds.balances, funds.feeRate)
      if (outcome)
        validateCashTicketFunds(ticket, funds.balances, funds.feeRate)
      latest.previewTicket(ticket)
      setError('')
    } catch (e) {
      if (context.current.active && context.current.model.address === address)
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
    error: error || feeError,
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
