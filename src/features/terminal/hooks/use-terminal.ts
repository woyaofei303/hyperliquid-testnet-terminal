'use client'
import { ApiRequestError } from '@nktkas/hyperliquid/api/exchange'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { EIP1193Provider } from 'viem'
import { useAccount } from '@/features/assets/hooks/use-account'
import {
  type AccountMode,
  type AccountType,
  accountTypeName,
  accountTypes,
  parseAccountMode,
} from '@/features/assets/lib/account-types'
import { assertProtectionUnchanged } from '@/features/chart/lib/chart-trading'
import {
  type Interval,
  useMarket,
  useMarkets,
} from '@/features/market/hooks/use-market'
import { isCash } from '@/features/market/lib/market-catalog'
import {
  loadCashFunds,
  validateCashTicketFunds,
} from '@/features/trading/lib/cash-order'
import {
  loadIsolatedMargin,
  marginDelta,
} from '@/features/trading/lib/isolated-margin'
import { orderConfirmation } from '@/features/trading/lib/order-confirmation'
import {
  type PositionProtectionOptions,
  preparePositionProtection,
  type Ticket,
} from '@/features/trading/lib/order-ticket'
import { Money } from '@/features/trading/lib/orders'
import {
  type PositionActionOptions,
  preparePositionAction,
} from '@/features/trading/lib/position-actions'
import {
  type Action,
  type ConfirmationAction,
  type JournalEntry,
  loadPending,
  type PendingOrder,
  type PreparedOrder,
  pendingKey,
  submitTrade,
} from '@/features/trading/lib/trading'
import {
  clearTradingConnection,
  loadTradingConnection,
  rememberOrderConfirmation,
  setTradingConnectionDisconnected,
  skipOrderConfirmation,
} from '@/features/wallet/lib/trading-connection'
import {
  dismissNotification,
  type FeedbackTone,
  notify,
} from '@/shared/components/notifications'
import {
  assertSession,
  authorizeTrading,
  connectWallet,
  DEPOSIT_REQUIRED_MESSAGE,
  errorText,
  info,
  isDepositRequired,
  isUserRejection,
  masterExchange,
  type OpenOrder,
  restoreTrading,
  type WalletSession,
} from '@/shared/lib/fameex-testnet'
import { fundingFeedback, tradeFeedbackTone } from '@/shared/lib/feedback'
import { useFunding } from '../../assets/hooks/use-funding'
import { useChaseOrders } from '../../trading/hooks/use-chase-orders'
import { useWalletProviders } from '../../wallet/hooks/use-wallet-providers'

export function useTerminal() {
  const {
    markets,
    error: marketsError,
    catalogError,
    catalogLoading,
  } = useMarkets()
  const [coin, setCoin] = useState('BTC')
  const initialMarketApplied = useRef(false)
  useEffect(() => {
    if (initialMarketApplied.current) return
    const requested = new URLSearchParams(window.location.search).get('market')
    if (!requested) {
      initialMarketApplied.current = true
      return
    }
    if (markets.some((m) => m.name === requested)) {
      initialMarketApplied.current = true
      setCoin(requested)
    }
  }, [markets])
  const [interval, setIntervalValue] = useState<Interval>('5m')
  const selectedMarket = markets.find((m) => m.name === coin)
  const feed = useMarket(coin, interval)
  const market = useMemo(
    () =>
      selectedMarket && feed.context
        ? {
            ...selectedMarket,
            context: { ...selectedMarket.context, ...feed.context },
          }
        : selectedMarket,
    [selectedMarket, feed.context],
  )
  const [web3Panel, setWeb3Panel] = useState<
    'wallet' | 'deposit' | 'transfer' | 'withdraw' | null
  >(null)
  const [transferToPerp, setTransferToPerp] = useState(false)
  const [cashOrderIntent, setCashOrderIntent] = useState<{
    coin: string
    amount: string
    at: number
  } | null>(null)
  const [bookPrice, setBookPrice] = useState<{
    coin: string
    price: string
  } | null>(null)
  const [connecting, setConnecting] = useState<string | null>(null)
  const [connectionError, setConnectionError] = useState('')
  const [needsDeposit, setNeedsDeposit] = useState(false)
  const connectPending = useRef(false)
  const providers = useWalletProviders()
  const restoreAttempted = useRef(false)
  const connectVersion = useRef(0)
  const [wallet, setWallet] = useState<WalletSession | null>(null)
  const activeWallet = useRef(wallet)
  activeWallet.current = wallet
  const address = wallet?.address ?? null
  const activeAddress = useRef(address)
  activeAddress.current = address
  const account = useAccount(address, selectedMarket?.dex ?? '')
  const funding = useFunding(wallet, account.refresh, web3Panel !== null)
  const [message, updateMessage] = useState('')
  const setMessage = useCallback(
    (text: string, tone: FeedbackTone = 'info') => {
      updateMessage(text)
      notify(tone, text)
    },
    [],
  )
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const [action, setAction] = useState<ConfirmationAction | null>(null)
  const [pending, setPending] = useState<PendingOrder | null>(null)
  const [journal, setJournal] = useState<JournalEntry[]>([])
  const [resolving, setResolving] = useState(false)

  useEffect(() => {
    const error = marketsError || feed.error || catalogError
    if (error) notify('warning', `行情数据暂不可用：${error}`, 'market')
    else dismissNotification('market')
  }, [marketsError, feed.error, catalogError])
  useEffect(() => {
    if (account.error)
      notify('error', `账户查询失败，暂不能交易：${account.error}`, 'account')
    else dismissNotification('account')
  }, [account.error])
  useEffect(() => {
    if (funding.busy || (funding.error && web3Panel))
      dismissNotification('funding')
    else if (funding.error) notify('warning', funding.error, 'funding')
    else if (funding.notification) {
      const feedback = fundingFeedback(
        funding.notification.kind,
        funding.notification.status,
      )
      notify(feedback.tone, feedback.text, 'funding')
    } else dismissNotification('funding')
  }, [funding.busy, funding.error, funding.notification, web3Panel])

  useEffect(() => {
    setPending(address ? loadPending(address) : null)
    setCashOrderIntent(null)
  }, [address])
  useEffect(() => {
    if (!wallet) return
    const changed = (forget: boolean) => {
      if (wallet.lifecycle) wallet.lifecycle.active = false
      connectVersion.current += 1
      if (forget) clearTradingConnection()
      else setTradingConnectionDisconnected(wallet.address, true)
      setConnecting(null)
      activeWallet.current = null
      setWallet(null)
      setWeb3Panel('wallet')
      setConnectionError('')
      setNeedsDeposit(false)
      setAction(null)
      dismissNotification('wallet-progress')
      setMessage('钱包账户已变化或断开，请重新连接。', 'warning')
    }
    const accountsChanged = (accounts: string[]) => changed(accounts.length > 0)
    const disconnected = () => changed(false)
    wallet.provider.on('accountsChanged', accountsChanged)
    wallet.provider.on('disconnect', disconnected)
    return () => {
      wallet.provider.removeListener('accountsChanged', accountsChanged)
      wallet.provider.removeListener('disconnect', disconnected)
    }
  }, [wallet, setMessage])
  const unresolved =
    pending?.account.toLowerCase() === address?.toLowerCase() ? pending : null
  const tradingReady = !!wallet?.exchange && Date.now() < wallet.expiresAt
  const accountReady =
    !connecting &&
    !connectionError &&
    !!account.snapshot &&
    Date.now() - account.snapshot.at < 30000 &&
    !account.error
  const checkingAccount = !!wallet && (!!connecting || !account.snapshot)
  const needsTradingConnection = !!wallet && !connecting && !tradingReady
  const onboarding = !wallet
    ? '连接钱包开始交易'
    : needsTradingConnection
      ? needsDeposit
        ? '存款'
        : '完成钱包连接'
      : null
  const canTrade = tradingReady && accountReady && !unresolved

  function storePending(next: PendingOrder | null) {
    const owner = next?.account ?? address
    if (owner?.toLowerCase() === activeAddress.current?.toLowerCase())
      setPending(next)
    if (next)
      localStorage.setItem(
        `${pendingKey}:${next.account.toLowerCase()}`,
        JSON.stringify(next),
      )
    else if (address)
      localStorage.removeItem(`${pendingKey}:${address.toLowerCase()}`)
  }
  const chase = useChaseOrders(wallet, storePending)
  const log = useCallback(
    (entry: Omit<JournalEntry, 'at'>) =>
      setJournal((previous) =>
        [{ ...entry, at: new Date().toISOString() }, ...previous].slice(0, 100),
      ),
    [],
  )

  function connect() {
    setConnectionError('')
    setWeb3Panel('wallet')
  }
  const connectProvider = useCallback(
    async (
      provider: EIP1193Provider,
      name: string,
      providerId = 'injected',
      silent = false,
      persist = false,
    ) => {
      if (connectPending.current) return
      connectPending.current = true
      const version = ++connectVersion.current
      setConnecting(name)
      setConnectionError('')
      setNeedsDeposit(false)
      if (!silent)
        notify('loading', '等待钱包连接，请在钱包中确认。', 'wallet-progress')
      let session: WalletSession | null = null
      try {
        session = {
          ...(await connectWallet(provider, silent)),
          name,
          providerId,
        }
        if (version !== connectVersion.current) {
          if (session.lifecycle) session.lifecycle.active = false
          return
        }
        if (activeWallet.current?.lifecycle)
          activeWallet.current.lifecycle.active = false
        activeWallet.current = session
        setWallet(session)
        let restored = await restoreTrading(session, persist)
        if (!silent && !restored.exchange) {
          await Promise.all([
            info.clearinghouseState({ user: session.address }),
            info.spotClearinghouseState({ user: session.address }),
          ])
          if (version !== connectVersion.current) return
          notify(
            'loading',
            '正在连接交易账户，请在钱包中确认交易权限签名。',
            'wallet-progress',
          )
          restored = await authorizeTrading(session, persist)
        }
        if (version !== connectVersion.current) return
        activeWallet.current = restored
        setWallet(restored)
        setWeb3Panel((panel) => (panel === 'wallet' ? null : panel))
        if (!silent)
          setMessage(
            restored.connectionSaved
              ? '钱包连接完成，可以直接交易。'
              : '钱包连接完成，但浏览器无法保存会话，刷新后需要重新连接。',
            restored.connectionSaved ? 'success' : 'warning',
          )
      } catch (e) {
        if (version !== connectVersion.current) return
        if (/钱包账户已变化|钱包会话已断开/.test(errorText(e))) {
          clearTradingConnection()
          if (session?.lifecycle) session.lifecycle.active = false
          session = null
          activeWallet.current = null
          setWallet(null)
        }
        if (session) {
          activeWallet.current = session
          setWallet(session)
        }
        if (session && isDepositRequired(e)) {
          setNeedsDeposit(true)
          setWeb3Panel((panel) =>
            panel === 'wallet' || panel === null ? 'deposit' : panel,
          )
          setMessage(DEPOSIT_REQUIRED_MESSAGE, 'info')
          return
        }
        const text = isUserRejection(e)
          ? session
            ? '交易权限签名已取消，钱包保持只读。可重新连接完成签名。'
            : '已取消连接钱包，可重新选择钱包连接。'
          : e && typeof e === 'object' && 'code' in e && e.code === -32002
            ? '钱包中已有待处理的连接请求，请打开钱包扩展完成确认或取消后重试。'
            : `连接未完成：${errorText(e)}。请检查钱包或网络后重试；不会自动签名。`
        setConnectionError(text)
        setMessage(text, isUserRejection(e) ? 'warning' : 'error')
      } finally {
        connectPending.current = false
        if (version === connectVersion.current) {
          setConnecting(null)
          dismissNotification('wallet-progress')
        }
      }
    },
    [setMessage],
  )
  useEffect(() => {
    if (restoreAttempted.current || wallet || connecting) return
    const saved = loadTradingConnection()
    if (!saved || saved.disconnected) return
    const provider = providers.find(
      (item) => (item.rdns ?? item.id) === saved.providerId,
    )
    if (!provider) return
    restoreAttempted.current = true
    void connectProvider(
      provider.provider,
      provider.name,
      saved.providerId,
      true,
    )
  }, [providers, wallet, connecting, connectProvider])

  async function reconcile() {
    if (!unresolved || resolving) return
    setResolving(true)
    notify('loading', '正在查询交易所订单状态…', 'reconcile-progress')
    try {
      if (unresolved.native) {
        account.refresh()
        setMessage(
          unresolved.native === 'outcome'
            ? '预测转换没有客户端订单 ID。请在余额、预测持仓及官方页面核对实际变化；不会自动重发。'
            : '此请求没有客户端订单 ID。请在仓位、TWAP、当前委托及官方页面核对实际状态；不会自动重发。',
          'warning',
        )
        return
      }
      const results = await Promise.all(
        (unresolved.cloids ?? [unresolved.cloid]).map((oid) =>
          info.orderStatus({ user: unresolved.account, oid }),
        ),
      )
      const known = results.filter((result) => result.status === 'order')
      const complete =
        known.length === results.length ||
        Date.now() > unresolved.expiresAt + 30000
      const text = `订单核对：${known.length}/${results.length} 笔查到记录。${known.map((result) => (result.status === 'order' ? `#${result.order.order.oid} ${result.order.status}` : '')).join('；')}`
      if (complete) {
        storePending(null)
        log({
          account: unresolved.account,
          action: 'reconcile',
          coin: unresolved.coin,
          state: 'reconciled',
          message: text,
        })
        setMessage(
          known.length === results.length
            ? `${text} 已解除待确认状态，未自动重发。`
            : `${text} 未查到的请求已超过签名有效期 30 秒，未自动重发。`,
        )
        account.refresh()
      } else
        setMessage(
          `${text} 仍保留待确认状态，请稍后再查，不要重复提交。`,
          'warning',
        )
    } catch (e) {
      setMessage(errorText(e), 'error')
    } finally {
      setResolving(false)
      dismissNotification('reconcile-progress')
    }
  }

  async function execute(next: Action) {
    if (!wallet || busyRef.current || funding.busy) return false
    busyRef.current = true
    setBusy(true)
    setAction(null)
    notify('loading', '请求处理中，请勿重复提交。', 'trade-progress')
    let cloid: `0x${string}` | undefined
    try {
      if (wallet.address !== next.account)
        throw new Error('账户已改变，请重新预览')
      if (next.kind === 'ticket' && next.ticket.kind === 'chase') {
        if (unresolved || Date.now() - next.at > 15000)
          throw new Error('请核对未确认订单或重新预览追价单')
        const result = await chase.start(next.ticket)
        setMessage(result.message, tradeFeedbackTone(result.state))
        log(result)
        return !['rejected', 'unconfirmed'].includes(result.state)
      }
      if (next.kind === 'ticket' && isCash(next.ticket.market)) {
        if (unresolved || Date.now() - next.at > 15000)
          throw new Error('请核对未确认订单或重新预览')
        const funds = await loadCashFunds(next.ticket.market, wallet.address)
        if (activeWallet.current !== wallet)
          throw new Error('账户已变化，请重新预览')
        validateCashTicketFunds(next.ticket, funds.balances, funds.feeRate)
      }
      const result = await submitTrade(
        wallet,
        next,
        !!unresolved,
        (pending) => {
          if (pending) cloid = pending.cloid
          storePending(pending)
        },
      )
      setMessage(result.message, tradeFeedbackTone(result.state))
      log(result)
      return ![
        'rejected',
        'partial-rejected',
        'pending',
        'unconfirmed',
      ].includes(result.state)
    } catch (e) {
      if (
        e instanceof ApiRequestError &&
        /(?:User or API Wallet .* does not exist|Agent .* (?:expired|not found))/i.test(
          errorText(e),
        )
      ) {
        clearTradingConnection()
        if (activeWallet.current?.lifecycle === wallet.lifecycle) {
          if (wallet.lifecycle) wallet.lifecycle.active = false
          setWallet({
            ...wallet,
            exchange: null,
            sendNative: undefined,
            expiresAt: 0,
            lifecycle: { active: true },
          })
        }
      }
      const denied = isUserRejection(e)
      const needsDeposit = isDepositRequired(e)
      const rejected = e instanceof ApiRequestError || denied || needsDeposit
      if (cloid && rejected) storePending(null)
      const text = needsDeposit
        ? DEPOSIT_REQUIRED_MESSAGE
        : denied
          ? '签名已取消，未发送交易请求。'
          : rejected
            ? `交易所拒绝：${errorText(e)}`
            : `${errorText(e)}${cloid ? '。结果待确认，请查询订单状态。' : ''}`
      setMessage(
        text,
        denied || needsDeposit || (cloid && !rejected) ? 'warning' : 'error',
      )
      if (needsDeposit && activeWallet.current?.lifecycle === wallet.lifecycle)
        setWeb3Panel('deposit')
      log({
        account: next.account,
        action: next.kind,
        coin: next.coin,
        state: rejected ? 'rejected' : 'unconfirmed',
        message: text,
        cloid,
      })
      return false
    } finally {
      busyRef.current = false
      setBusy(false)
      dismissNotification('trade-progress')
      account.refresh()
    }
  }

  function confirmAction(next: Action, skip = false) {
    if (next.kind === 'order' || next.kind === 'ticket')
      rememberOrderConfirmation(orderConfirmation(next).reduceOnly, skip)
    return execute(next)
  }
  function requestOrder(next: ConfirmationAction) {
    const close = orderConfirmation(next).reduceOnly
    if (
      !(next.kind === 'ticket' && next.ticket.kind === 'chase') &&
      skipOrderConfirmation(close)
    )
      void execute(next)
    else setAction(next)
  }
  function previewTicket(ticket: Ticket) {
    if (!wallet) return
    const order = ticket.kind === 'orders' ? ticket.orders[0] : null
    if (
      !isCash(ticket.market) &&
      ticket.kind === 'orders' &&
      ticket.orders.length === 1 &&
      (ticket.orderKind === 'limit' || ticket.orderKind === 'market') &&
      order &&
      'limit' in order.t
    ) {
      previewOrder({ ...order, t: { limit: order.t.limit } }, ticket.orderKind)
    } else
      requestOrder({
        kind: 'ticket',
        account: wallet.address,
        coin: ticket.market.name,
        at: Date.now(),
        ticket,
      })
  }
  function previewOrder(order: PreparedOrder, orderKind: 'limit' | 'market') {
    if (wallet)
      requestOrder({
        kind: 'order',
        orderKind,
        account: wallet.address,
        coin,
        at: Date.now(),
        order,
      })
  }
  function previewCancel(order: OpenOrder) {
    const selected = markets.find((m) => m.name === order.coin)
    if (wallet && selected)
      void execute({
        kind: 'cancel',
        account: wallet.address,
        coin: order.coin,
        at: Date.now(),
        asset: selected.asset,
        oid: order.oid,
      })
  }
  async function submitPosition(
    position: NonNullable<
      typeof account.snapshot
    >['state']['assetPositions'][number]['position'],
    options: PositionActionOptions,
    skip = false,
  ) {
    if (!wallet || busyRef.current || funding.busy) return false
    busyRef.current = true
    setBusy(true)
    try {
      const selected = markets.find((m) => m.name === position.coin)
      if (!selected) throw new Error('找不到仓位对应的市场')
      const [state, book] = await Promise.all([
        info.clearinghouseState({ user: wallet.address, dex: selected.dex }),
        info.l2Book({ coin: position.coin }),
      ])
      if (activeWallet.current !== wallet)
        throw new Error('账户已变化，请重新确认')
      const latest = state.assetPositions.find(
        (item) => item.position.coin === position.coin,
      )?.position
      if (!latest || new Money(latest.szi).eq(0))
        throw new Error('仓位已关闭，请刷新账户')
      if (!new Money(latest.szi).eq(position.szi))
        throw new Error('仓位数量或方向已变化，请重新确认')
      if (
        !book ||
        Date.now() - book.time > 15000 ||
        book.time > Date.now() + 5000
      )
        throw new Error('该市场行情过期，暂不能平仓')
      const price = book.levels[new Money(latest.szi).gt(0) ? 0 : 1][0]?.px
      if (!price) throw new Error('当前盘口没有对手方报价')
      const mark = new Money(latest.positionValue)
        .div(new Money(latest.szi).abs())
        .toFixed()
      const ticket = preparePositionAction(
        { ...selected, context: { ...selected.context, markPx: mark } },
        latest.szi,
        price,
        options,
      )
      if (options.kind === 'market' || options.kind === 'reverse')
        rememberOrderConfirmation(true, skip)
      busyRef.current = false
      return await execute({
        kind: 'ticket',
        account: wallet.address,
        coin: position.coin,
        at: Date.now(),
        ticket,
      })
    } catch (error) {
      setMessage(errorText(error), 'error')
      return false
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  async function submitProtection(
    position: NonNullable<
      typeof account.snapshot
    >['state']['assetPositions'][number]['position'],
    takeProfit: string,
    stopLoss: string,
    options: PositionProtectionOptions,
    replaceOrder?: OpenOrder,
  ) {
    if (!wallet || busyRef.current || funding.busy) return false
    busyRef.current = true
    setBusy(true)
    try {
      const selected = markets.find((item) => item.name === position.coin)
      if (!selected) throw new Error('市场不存在')
      const [state, contexts, openOrders] = await Promise.all([
        info.clearinghouseState({ user: wallet.address, dex: selected.dex }),
        info.metaAndAssetCtxs({ dex: selected.dex }),
        replaceOrder
          ? info.frontendOpenOrders({ user: wallet.address, dex: selected.dex })
          : Promise.resolve([]),
      ])
      if (activeWallet.current !== wallet)
        throw new Error('账户已变化，请重新确认')
      const latest = state.assetPositions.find(
        (item) => item.position.coin === position.coin,
      )?.position
      if (!latest || !new Money(latest.szi).eq(position.szi))
        throw new Error('仓位数量或方向已变化，请重新确认')
      const mark =
        contexts[1][
          contexts[0].universe.findIndex((item) => item.name === position.coin)
        ]?.markPx
      if (!mark) throw new Error('无法读取标记价')
      if (replaceOrder) {
        if (!!takeProfit === !!stopLoss)
          throw new Error('一次只能修改一笔保护单')
        assertProtectionUnchanged(
          replaceOrder,
          openOrders.find((order) => order.oid === replaceOrder.oid),
          position.coin,
          latest.szi,
          takeProfit ? 'tp' : 'sl',
        )
        options = {
          ...options,
          size: Number(replaceOrder.origSz) === 0 ? undefined : replaceOrder.sz,
        }
      }
      const ticket = preparePositionProtection(
        selected,
        mark,
        latest.szi,
        takeProfit,
        stopLoss,
        options,
      )
      if (replaceOrder && ticket.kind === 'orders') {
        ticket.replaceOid = replaceOrder.oid
        ticket.label = '修改止盈 / 止损'
      }
      busyRef.current = false
      return await execute({
        kind: 'ticket',
        account: wallet.address,
        coin: position.coin,
        at: Date.now(),
        ticket,
      })
    } catch (error) {
      setMessage(errorText(error), 'error')
      void account.refresh()
      return false
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }
  async function submitIsolatedMargin(
    name: string,
    amount: string,
    direction: 'add' | 'remove',
  ) {
    if (!wallet || busyRef.current || funding.busy) return false
    busyRef.current = true
    setBusy(true)
    try {
      const selected = markets.find((m) => m.name === name)
      if (!selected) throw new Error('市场不存在')
      const quote = await loadIsolatedMargin(wallet.address, selected)
      if (activeWallet.current !== wallet)
        throw new Error('账户已变化，请重新确认')
      const ntli = marginDelta(amount, quote[direction], direction)
      busyRef.current = false
      return await execute({
        kind: 'isolatedMargin',
        account: wallet.address,
        coin: name,
        at: Date.now(),
        asset: selected.asset,
        isBuy: true,
        ntli,
      })
    } catch (error) {
      setMessage(errorText(error), 'error')
      return false
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }
  function previewTwapCancel(twapId: number, name: string) {
    const selected = markets.find((item) => item.name === name)
    if (wallet && selected)
      void execute({
        kind: 'twapCancel',
        account: wallet.address,
        coin: name,
        at: Date.now(),
        asset: selected.asset,
        twapId,
      })
  }
  function acknowledgeNative() {
    if (!unresolved?.native || Date.now() <= unresolved.expiresAt + 30000) {
      setMessage(
        '签名仍可能有效，请至少等到有效期结束 30 秒后再核对解除。',
        'warning',
      )
      return
    }
    log({
      account: unresolved.account,
      action: 'manual-reconcile',
      coin: unresolved.coin,
      state: 'manually-cleared',
      message:
        '用户确认已在交易所核对，解除本地重复提交保护；不代表请求成功或失败',
    })
    storePending(null)
    setMessage('已按你的核对结果解除本地保护，没有重新发送交易。')
  }

  function selectMarket(name: string) {
    if (!markets.some((m) => m.name === name)) return
    setCoin(name)
    window.history.replaceState(
      null,
      '',
      `/?market=${encodeURIComponent(name)}`,
    )
    setAction(null)
  }
  function disconnect() {
    if (wallet) setTradingConnectionDisconnected(wallet.address, true)
    restoreAttempted.current = true
    setConnecting(null)
    connectVersion.current += 1
    if (activeWallet.current?.lifecycle)
      activeWallet.current.lifecycle.active = false
    activeWallet.current = null
    setWeb3Panel('wallet')
    setConnectionError('')
    setNeedsDeposit(false)
    setWallet(null)
    setMessage('已断开本地钱包会话。交易所授权会在到期或撤销后失效。')
    setAction(null)
  }
  function previewLeverage(leverage: number, isCross: boolean) {
    if (wallet && market)
      void execute({
        kind: 'leverage',
        account: wallet.address,
        coin,
        at: Date.now(),
        asset: market.asset,
        leverage,
        isCross,
      })
  }
  function continueConnection() {
    if (needsDeposit) setWeb3Panel('deposit')
    else connect()
  }
  async function transferFunds(amount: string, toPerp: boolean) {
    if (await funding.transfer(amount, toPerp)) {
      if (activeWallet.current?.lifecycle !== wallet?.lifecycle) return
      setWeb3Panel(null)
    }
  }
  async function changeAccountType(next: AccountType, expected: AccountMode) {
    if (!wallet || !accountReady)
      throw new Error('请先连接钱包并等到账户类型读取完成')
    if (busyRef.current || funding.busy || unresolved)
      throw new Error('请先完成当前操作或核对未确认订单')
    if (!accountTypes.some((type) => type.value === next))
      throw new Error('账户类型无效')
    busyRef.current = true
    setBusy(true)
    let sent = false
    try {
      await assertSession(wallet)
      const current = parseAccountMode(
        await info.userAbstraction({ user: wallet.address }),
      )
      if (current !== expected)
        throw new Error('账户类型已变化，请关闭弹窗后重新确认')
      if (current === next) return
      sent = true
      await masterExchange(wallet).userSetAbstraction({
        user: wallet.address,
        abstraction: next,
      })
      await assertSession(wallet)
      const confirmed = await info.userAbstraction({ user: wallet.address })
      if (confirmed !== next)
        throw new Error('账户类型尚未确认，请刷新查询后再操作')
      setMessage(
        `账户类型已切换为${accountTypeName(next)}，正在刷新余额。`,
        'success',
      )
      log({
        account: wallet.address,
        action: 'accountType',
        coin: '账户',
        state: 'confirmed',
        message: accountTypeName(next),
      })
    } catch (error) {
      const text = isUserRejection(error)
        ? '已取消签名，账户类型未修改。'
        : error instanceof ApiRequestError
          ? `交易所拒绝：${errorText(error)}`
          : `${errorText(error)}${sent ? '；请刷新核对账户类型，勿重复提交。' : ''}`
      throw new Error(text)
    } finally {
      await account.refresh()
      busyRef.current = false
      setBusy(false)
    }
  }
  return {
    bookPrice,
    selectBookPrice: (price: string) => {
      if (!busyRef.current && !funding.busy && !feed.stale)
        setBookPrice({ coin, price })
    },
    changeAccountType,
    transferFunds,
    transferToPerp,
    setTransferToPerp,
    funding,
    web3Panel,
    setWeb3Panel,
    connecting: !!connecting,
    connectingWallet: connecting,
    connectionError,
    connectProvider,
    providers,
    confirmAction,
    chase,
    previewTwapCancel,
    submitProtection,
    acknowledgeNative,
    markets,
    marketsError,
    catalogError,
    catalogLoading,
    coin,
    interval,
    setIntervalValue,
    market,
    feed,
    wallet,
    address,
    account,
    message,
    busy: busy || funding.busy || !!connecting,
    action,
    setAction,
    journal,
    resolving,
    unresolved,
    canTrade,
    tradingReady,
    checkingAccount,
    onboarding,
    connect,
    disconnect,
    selectMarket,
    continueConnection,
    needsDeposit,
    previewOrder,
    previewTicket,
    cashOrderIntent,
    sellCashBalance: (name: string, amount: string) => {
      selectMarket(name)
      setCashOrderIntent({ coin: name, amount, at: Date.now() })
    },
    convertOutcome: (next: Extract<Action, { kind: 'outcome' }>) =>
      execute(next),
    previewCancel,
    submitPosition,
    submitIsolatedMargin,
    previewLeverage,
    execute,
    reconcile,
  }
}
export type TerminalModel = ReturnType<typeof useTerminal>
