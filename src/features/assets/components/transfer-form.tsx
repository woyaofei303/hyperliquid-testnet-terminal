'use client'

import { Button, Input, Select } from '@fameex/ui'
import { useCallback, useEffect, useState } from 'react'
import { isFundingPending } from '@/features/assets/lib/funding'
import {
  internalTransferAmount,
  loadTransferCatalog,
  loadTransferQuote,
  type TransferCatalog,
  type TransferQuote,
  type TransferRoute,
} from '@/features/assets/lib/internal-transfer'
import type { TerminalModel } from '@/features/terminal/hooks/use-terminal'
import { Money } from '@/features/trading/lib/orders'
import { t, useLocale } from '@/i18n'
import { display } from '@/shared/lib/display'
import { errorText } from '@/shared/lib/fameex-testnet'
import { FundingRoute } from './withdrawal-form'

export function TransferForm({ model }: { model: TerminalModel }) {
  useLocale()
  const legacy = model.account.snapshot?.mode === 'dexAbstraction'
  const [catalog, setCatalog] = useState<TransferCatalog | null>(null)
  const [route, setRoute] = useState<TransferRoute>(() => ({
    sourceDex: model.transferToPerp
      ? 'spot'
      : legacy
        ? ''
        : (model.market?.dex ?? ''),
    destinationDex: model.transferToPerp
      ? legacy
        ? ''
        : (model.market?.dex ?? '')
      : 'spot',
    token: !legacy && model.market?.dex ? (model.market.quoteToken ?? 0) : 0,
  }))
  const [quote, setQuote] = useState<TransferQuote | null>(null)
  const [amount, setAmount] = useState('')
  const [error, setError] = useState('')
  const [container, setContainer] = useState<HTMLElement | null>(null)
  const attach = useCallback(
    (node: HTMLDivElement | null) =>
      setContainer(node?.closest<HTMLElement>('[role="dialog"]') ?? null),
    [],
  )
  const user = model.wallet?.address
  useEffect(() => {
    if (
      legacy &&
      (route.token !== 0 ||
        !['', 'spot'].includes(route.sourceDex) ||
        !['', 'spot'].includes(route.destinationDex))
    ) {
      setRoute({ sourceDex: '', destinationDex: 'spot', token: 0 })
      setAmount('')
    }
  }, [legacy, route])
  useEffect(() => {
    let active = true
    void loadTransferCatalog()
      .then((data) => {
        if (active) setCatalog(data)
      })
      .catch((e) => {
        if (active) setError(errorText(e))
      })
    return () => {
      active = false
    }
  }, [])
  useEffect(() => {
    if (!user) return
    let active = true
    setQuote(null)
    setError('')
    const load = async () => {
      try {
        const data = await loadTransferQuote(user, route)
        if (active) {
          setQuote(data)
          setError('')
        }
      } catch (e) {
        if (active) {
          setQuote(null)
          setError(errorText(e))
        }
      }
    }
    void load()
    const timer = setInterval(load, 15000)
    return () => {
      active = false
      clearInterval(timer)
    }
  }, [user, route])
  const current =
    quote &&
    quote.user === user &&
    quote.sourceDex === route.sourceDex &&
    quote.destinationDex === route.destinationDex &&
    quote.token === route.token
      ? quote
      : null
  const token = catalog?.tokens.find((item) => item.index === route.token)
  const venues = [
    { dex: 'spot', token: route.token },
    ...(catalog?.venues.filter(
      (item) => item.token === route.token && (!legacy || item.dex === ''),
    ) ?? []),
  ]
  const name = (dex: string) =>
    dex === 'spot'
      ? t('现货账户')
      : dex === ''
        ? t('合约账户')
        : `HIP-3 · ${dex}`
  const pending =
    model.funding.record?.kind === 'transfer' &&
    model.funding.record.nonce != null &&
    isFundingPending(model.funding.record)
  const disabled = model.busy || model.funding.busy || pending
  let validation = ''
  if (amount && current) {
    try {
      internalTransferAmount(amount, current.available, current.asset)
    } catch (e) {
      validation = errorText(e)
    }
  }
  const changeRoute = (next: TransferRoute) => {
    setRoute(next)
    setAmount('')
  }
  return (
    <div ref={attach} className="space-y-4">
      <Select
        label={t('划转币种')}
        aria-label={t('划转币种')}
        selectedKeys={[String(route.token)]}
        items={(catalog?.tokens ?? [])
          .filter((item) => !legacy || item.index === 0)
          .map((item) => ({
            key: String(item.index),
            label: item.name,
          }))}
        isDisabled={disabled || !catalog}
        popoverProps={{ portalContainer: container ?? undefined }}
        onSelectionChange={(keys) => {
          const index = Number(Array.from(keys)[0])
          const venue = catalog?.venues.find((item) => item.token === index)
          if (venue)
            changeRoute({
              token: index,
              sourceDex: 'spot',
              destinationDex: venue.dex,
            })
        }}
      />
      {(['sourceDex', 'destinationDex'] as const).map((field) => (
        <Select
          key={field}
          label={t(field === 'sourceDex' ? '划转来源' : '划转目标')}
          aria-label={t(field === 'sourceDex' ? '划转来源' : '划转目标')}
          selectedKeys={[`dex:${route[field]}`]}
          items={venues.map(({ dex }) => ({
            key: `dex:${dex}`,
            label: name(dex),
          }))}
          isDisabled={disabled || !catalog}
          popoverProps={{ portalContainer: container ?? undefined }}
          onSelectionChange={(keys) => {
            const key = Array.from(keys)[0]
            if (typeof key !== 'string') return
            const other = field === 'sourceDex' ? 'destinationDex' : 'sourceDex'
            const dex = key.slice(4)
            changeRoute({
              ...route,
              [field]: dex,
              [other]: dex === route[other] ? route[field] : route[other],
            })
          }}
        />
      ))}
      <FundingRoute
        from={name(route.sourceDex)}
        to={name(route.destinationDex)}
        disabled={disabled}
        onSwap={() =>
          changeRoute({
            ...route,
            sourceDex: route.destinationDex,
            destinationDex: route.sourceDex,
          })
        }
      />
      <Input
        label={`${t('划转金额（')}${token?.name ?? 'USDC'}）`}
        value={amount}
        onChange={setAmount}
        inputMode="decimal"
        placeholder={t('输入划转金额')}
        isDisabled={disabled || !current}
        isInvalid={!!validation}
        errorMessage={t(validation)}
        endContent={
          <Button
            variant="light"
            size="sm"
            isDisabled={disabled || !current}
            onPress={() =>
              current &&
              setAmount(
                new Money(current.available)
                  .toDecimalPlaces(current.asset.weiDecimals, Money.ROUND_DOWN)
                  .toFixed(),
              )
            }
          >
            {t('最大值：')}
            {display(current?.available, 6)}
          </Button>
        }
      />
      {error && (
        <p role="alert" className="text-xs text-loss">
          {t(error)}
        </p>
      )}
      {pending && (
        <p role="alert" className="text-xs text-loss">
          {t('上一笔划转结果待确认，请先核对资金记录')}
        </p>
      )}
      <Button
        className="w-full"
        isDisabled={disabled || !current || !amount || !!validation}
        onPress={() => current && model.transferFunds(amount, current)}
      >
        {model.busy ? t('等待钱包确认…') : t('确认划转')}
      </Button>
    </div>
  )
}
