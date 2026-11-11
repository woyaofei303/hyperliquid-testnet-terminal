'use client'
import { ApiRequestError } from '@nktkas/hyperliquid/api/exchange'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  creditedDeposit,
  readCctpMessage,
  withdrawalMessageAmount,
} from '@/features/assets/lib/cctp'
import {
  depositBalances,
  depositClient,
  depositRejectionMessage,
  evmClient,
  type FundingRecord,
  type FundingWrite,
  fundingAmount,
  fundingKey,
  isFundingPending,
  parseFundingRecord,
  receivedWithdrawal,
  sendDeposit,
  spotAvailable,
  switchDepositChain,
  transferAmount,
  type WithdrawalQuote,
  withdrawalAmount,
  withdrawalParameters,
  withdrawalQuote,
  withdrawalTransaction,
} from '@/features/assets/lib/funding'
import { Money } from '@/features/trading/lib/orders'
import {
  assertSession,
  errorText,
  info,
  isUserRejection,
  masterExchange,
  type WalletSession,
} from '@/shared/lib/hyperliquid'

export function useFunding(
  wallet: WalletSession | null,
  refreshAccount: () => void,
  visible: boolean,
) {
  const [balances, setBalances] = useState<Awaited<
    ReturnType<typeof depositBalances>
  > | null>(null)
  const [core, setCore] = useState<{
    perp: string
    spot: string
    mode: string
  } | null>(null)
  const [record, setRecord] = useState<FundingRecord | null>(null)
  const [notification, setNotification] = useState<FundingRecord | null>(null)
  const [withdrawQuote, setWithdrawQuote] = useState<WithdrawalQuote | null>(
    null,
  )
  const [chain, setChain] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(false)
  const quoteRequest = useRef(0)
  const [quoteLoading, setQuoteLoading] = useState(false)
  const lock = useRef(false)
  const checking = useRef(false)
  const current = useRef(wallet)
  current.current = wallet
  const owner = wallet?.address
  useEffect(() => {
    setBalances(null)
    setCore(null)
    setChain(null)
    setError('')
    setRecord(null)
    setNotification(null)
    setWithdrawQuote(null)
    if (!owner) return
    try {
      setRecord(
        parseFundingRecord(localStorage.getItem(fundingKey(owner)), owner),
      )
    } catch (e) {
      setError(errorText(e))
    }
  }, [owner])
  const save = useCallback((next: FundingRecord) => {
    // 本地记录只用于展示进度，不作为后续资金操作的锁。
    let stored: FundingRecord | null = null
    try {
      stored = parseFundingRecord(
        localStorage.getItem(fundingKey(next.account)),
        next.account,
      )
    } catch {
      // 损坏的历史记录不能阻止用户发起新的钱包操作。
    }
    if (
      stored &&
      (stored.at > next.at ||
        (stored.at === next.at && stored.status === 'credited'))
    )
      return
    if (JSON.stringify(stored) === JSON.stringify(next)) return
    localStorage.setItem(fundingKey(next.account), JSON.stringify(next))
    if (current.current?.address === next.account) {
      // 仅新提交或核对后发生变化的记录触发通知，读取历史记录保持静默。
      if (
        next.status === 'credited' ||
        (next.kind === 'transfer' && next.status === 'confirmed')
      )
        setNotification(next)
      setRecord((previous) =>
        JSON.stringify(previous) === JSON.stringify(next) ? previous : next,
      )
    }
  }, [])
  const refresh = useCallback(async () => {
    if (!wallet) return
    setLoading(true)
    try {
      const results = await Promise.allSettled([
        depositBalances(wallet.address),
        Promise.all([
          info.clearinghouseState({ user: wallet.address }),
          info.spotClearinghouseState({ user: wallet.address }),
          info.userAbstraction({ user: wallet.address }),
        ]),
        wallet.provider.request({ method: 'eth_chainId' }),
      ])
      if (current.current?.lifecycle !== wallet.lifecycle) return
      const [source, destination, network] = results
      if (source.status === 'fulfilled') setBalances(source.value)
      else setBalances(null)
      if (destination.status === 'fulfilled') {
        const [perp, spot, mode] = destination.value
        setCore({
          perp: perp.withdrawable,
          spot: spotAvailable(
            spot,
            'USDC',
            ['unifiedAccount', 'portfolioMargin'].includes(mode),
          ),
          mode,
        })
      } else setCore(null)
      if (network.status === 'fulfilled') setChain(Number(network.value))
      const failed = results.find((item) => item.status === 'rejected')
      setError(
        failed?.status === 'rejected'
          ? `余额查询失败：${errorText(failed.reason)}`
          : '',
      )
      refreshAccount()
    } finally {
      setLoading(false)
    }
  }, [wallet, refreshAccount])
  useEffect(() => {
    if (!visible || !wallet) return
    void refresh()
    const changed = () => {
      void refresh()
    }
    wallet.provider.on('chainChanged', changed)
    const timer = setInterval(changed, 15000)
    return () => {
      clearInterval(timer)
      wallet.provider.removeListener('chainChanged', changed)
    }
  }, [visible, wallet, refresh])

  const check = useCallback(async () => {
    if (
      lock.current ||
      checking.current ||
      record?.account !== current.current?.address
    )
      return
    if (
      !record ||
      record.kind === 'transfer' ||
      (!record.hash && record.kind !== 'withdraw')
    ) {
      refreshAccount()
      return
    }
    checking.current = true
    try {
      if (record.kind === 'withdraw') {
        const response = await fetch(
          `https://dev.indexer.api.across.to/hyperliquid-transfers?direction=out&user=${record.account.toLowerCase()}`,
          { signal: AbortSignal.timeout(10000) },
        )
        if (!response.ok) throw new Error('提款跨链状态暂不可用，请稍后核对')
        const hash = withdrawalTransaction(await response.json(), record)
        if (!hash) return
        const next: FundingRecord = { ...record, hash, status: 'confirmed' }
        save(next)
        const receipt = await depositClient.getTransactionReceipt({ hash })
        const amount = withdrawalMessageAmount(receipt.logs, record)
        if (
          receipt.status === 'success' &&
          amount != null &&
          receivedWithdrawal(receipt.logs, record, amount)
        )
          save({ ...next, status: 'credited' })
        await refresh()
        return
      }
      if (!record.hash) return
      const receipt = await depositClient.getTransactionReceipt({
        hash: record.hash,
      })
      const next: FundingRecord = {
        ...record,
        status: receipt.status === 'reverted' ? 'reverted' : 'confirmed',
      }
      save(next)
      if (receipt.status === 'success' && record.kind === 'deposit') {
        const message = await readCctpMessage(record.hash, record)
        if (message) {
          const target = await evmClient.getTransactionReceipt({
            hash: message.hash,
          })
          if (target.status === 'success') {
            const block = await evmClient.getBlock({
              blockNumber: target.blockNumber,
            })
            const ledger = await info.userNonFundingLedgerUpdates({
              user: record.account,
              startTime: Number(block.timestamp) * 1000,
              endTime: Number(block.timestamp) * 1000 + 999,
            })
            if (
              creditedDeposit(
                target.logs,
                block.timestamp,
                message,
                ledger,
                record,
              )
            )
              next.status = 'credited'
          }
        }
      }
      save(next)
      await refresh()
    } catch (e) {
      if (current.current?.address === record.account)
        setError(`资金结果待核对：${errorText(e)}`)
    } finally {
      checking.current = false
    }
  }, [record, refresh, refreshAccount, save])
  useEffect(() => {
    if (
      !record ||
      !isFundingPending(record) ||
      (!record.hash && record.kind !== 'withdraw')
    )
      return
    void check()
    const timer = setInterval(() => void check(), 10000)
    return () => clearInterval(timer)
  }, [record, check])

  async function run(action: () => Promise<void>) {
    if (lock.current || !wallet) return
    lock.current = true
    setBusy(true)
    setError('')
    setNotification(null)
    try {
      await action()
      return true
    } catch (e) {
      setError(
        isUserRejection(e)
          ? '已取消钱包操作，未自动重试。'
          : (depositRejectionMessage(e) ?? errorText(e)),
      )
    } finally {
      lock.current = false
      setBusy(false)
    }
  }
  async function deposit(amount: string) {
    if (!wallet) return
    const completed = await run(async () => {
      const units = fundingAmount(amount)
      const fresh = await depositBalances(wallet.address)
      const steps: FundingWrite[] =
        fresh.allowance < units ? ['approve', 'deposit'] : ['deposit']
      for (const kind of steps) {
        let next: FundingRecord = {
          account: wallet.address,
          amount,
          kind,
          at: Date.now(),
          status: 'unknown',
        }
        let submitted = false
        try {
          const hash = await sendDeposit(wallet, amount, kind, () => {
            save(next)
            submitted = true
          })
          next = { ...next, hash, status: 'submitted' }
          save(next)
          if (kind === 'approve') {
            const receipt = await depositClient.waitForTransactionReceipt({
              hash,
              timeout: 120000,
              checkReplacement: false,
            })
            save({
              ...next,
              status: receipt.status === 'success' ? 'confirmed' : 'reverted',
            })
            if (receipt.status !== 'success')
              throw new Error('USDC 授权失败，未发起存款。请重新确认。')
            // 每个写入都会再次检查钱包、链、余额及授权额度；切换账户即停止后续步骤。
          }
        } catch (e) {
          if (
            submitted &&
            !next.hash &&
            (isUserRejection(e) || depositRejectionMessage(e))
          )
            save({ ...next, status: 'reverted' })
          throw e
        }
      }
    })
    if (completed) void refresh()
  }
  async function transfer(amount: string, toPerp: boolean) {
    if (!wallet) return
    return run(async () => {
      let next: FundingRecord | null = null
      try {
        const mode = await info.userAbstraction({ user: wallet.address })
        if (mode === 'unifiedAccount' || mode === 'portfolioMargin')
          throw new Error('统一账户使用共享抵押品，请在官方页面管理资金')
        const [perp, spot] = await Promise.all([
          info.clearinghouseState({ user: wallet.address }),
          info.spotClearinghouseState({ user: wallet.address }),
        ])
        const available = toPerp
          ? spotAvailable(spot, 'USDC', false)
          : perp.withdrawable
        const value = transferAmount(amount, available)
        await assertSession(wallet)
        next = {
          account: wallet.address,
          amount: value,
          kind: 'transfer',
          toPerp,
          at: Date.now(),
          status: 'unknown',
        }
        save(next)
        await masterExchange(wallet).usdClassTransfer({ amount: value, toPerp })
        save({ ...next, status: 'confirmed' })
        await refresh()
      } catch (e) {
        if (next && (isUserRejection(e) || e instanceof ApiRequestError))
          save({ ...next, status: 'reverted' })
        throw e
      }
    })
  }
  const cancelWithdrawal = useCallback(() => {
    quoteRequest.current++
    setWithdrawQuote(null)
    setQuoteLoading(false)
  }, [])
  const loadWithdrawalQuote = useCallback(async () => {
    if (!wallet) return
    const request = ++quoteRequest.current
    setQuoteLoading(true)
    setError('')
    try {
      const quote = await withdrawalQuote(wallet.address)
      if (
        request === quoteRequest.current &&
        current.current?.lifecycle === wallet.lifecycle
      )
        setWithdrawQuote(quote)
    } catch (e) {
      if (
        request === quoteRequest.current &&
        current.current?.lifecycle === wallet.lifecycle
      )
        setError(errorText(e))
    } finally {
      if (request === quoteRequest.current) setQuoteLoading(false)
    }
  }, [wallet])
  async function withdraw(value: string) {
    if (!wallet || !withdrawQuote) return
    const preview = withdrawQuote
    await run(async () => {
      let next: FundingRecord | null = null
      try {
        if (preview.account !== wallet.address)
          throw new Error('钱包已变化，请重新打开提款')
        const fresh = await withdrawalQuote(wallet.address, preview.sourceDex)
        const amount = withdrawalAmount(value, fresh.available)
        await assertSession(wallet)
        setWithdrawQuote(fresh)
        if (
          new Money(fresh.gasUsdc).gt(preview.gasUsdc) ||
          new Money(fresh.gasHype).gt(preview.gasHype) ||
          new Money(fresh.activationFee).gt(preview.activationFee) ||
          fresh.gasInHype !== preview.gasInHype
        ) {
          throw new Error('费用已更新，请重新核对后确认提款')
        }
        const nonce = Date.now()
        next = {
          account: wallet.address,
          amount,
          kind: 'withdraw',
          sourceDex: preview.sourceDex,
          nonce,
          at: nonce,
          status: 'unknown',
        }
        save(next)
        await masterExchange(wallet, nonce).sendToEvmWithData(
          withdrawalParameters(wallet.address, amount, preview.sourceDex),
        )
        save({ ...next, status: 'submitted' })
        setWithdrawQuote(null)
        await refresh()
      } catch (e) {
        if (next && (isUserRejection(e) || e instanceof ApiRequestError))
          save({ ...next, status: 'reverted' })
        else if (next) setWithdrawQuote(null)
        throw e
      }
    })
  }
  return {
    balances,
    core,
    withdrawQuote,
    loadWithdrawalQuote,
    quoteLoading,
    withdraw,
    cancelWithdrawal,
    record,
    notification,
    chain,
    error,
    busy,
    loading,
    refresh,
    check,
    deposit,
    transfer,
    switchChain: () =>
      run(async () => {
        if (wallet) {
          await switchDepositChain(wallet)
          await refresh()
        }
      }),
  }
}
