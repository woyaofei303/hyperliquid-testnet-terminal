'use client'
import { ApiRequestError } from '@nktkas/hyperliquid/api/exchange'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { EIP1193Provider } from 'viem'
import {
  dismissNotification,
  type FeedbackTone,
  notify,
} from '@/components/notifications'
import {
  type AccountMode,
  type AccountType,
  accountTypeName,
  accountTypes,
  parseAccountMode,
} from '@/lib/account-types'
import { loadCashFunds, validateCashTicketFunds } from '@/lib/cash-order'
import { fundingFeedback, tradeFeedbackTone } from '@/lib/feedback'
import {
  API_URL,
  assertSession,
  assertTradingAccount,
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
} from '@/lib/hyperliquid'
import { isCash } from '@/lib/market-catalog'
import { preparePositionProtection, type Ticket } from '@/lib/order-ticket'
import { Money, positiveDecimal, prepareOrder } from '@/lib/orders'
import {
  type Action,
  type ConfirmationAction,
  type JournalEntry,
  loadPending,
  type PendingOrder,
  type PreparedOrder,
  pendingKey,
  submitTrade,
} from '@/lib/trading'
import {
  clearTradingConnection,
  loadTradingConnection,
  rememberOrderConfirmation,
  skipOrderConfirmation,
} from '@/lib/trading-connection'
import {
  type Interval,
  useAccount,
  useMarket,
  useMarkets,
} from '@/lib/use-market'
import { useChaseOrders } from './use-chase-orders'
import { useFunding } from './use-funding'
import { useWalletProviders } from './use-wallet-providers'

export function useTerminal() {
  const { markets, error: marketsError, catalogError } = useMarkets()
  const [coin, setCoin] = useState('BTC')
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
  const [connecting, setConnecting] = useState<string | null>(null)
  const [connectionError, setConnectionError] = useState('')
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
    if (funding.busy)
      notify('loading', '资金操作处理中，请在钱包中核对并确认。', 'funding')
    else if (funding.error) notify('warning', funding.error, 'funding')
    else if (funding.notification) {
      const feedback = fundingFeedback(
        funding.notification.kind,
        funding.notification.status,
      )
      notify(feedback.tone, feedback.text, 'funding')
    } else dismissNotification('funding')
  }, [funding.busy, funding.error, funding.notification])

  useEffect(() => {
    setPending(address ? loadPending(address) : null)
  }, [address])
  useEffect(() => {
    if (!wallet) return
    const changed = () => {
      if (wallet.lifecycle) wallet.lifecycle.active = false
      connectVersion.current += 1
      clearTradingConnection()
      setConnecting(null)
      activeWallet.current = null
      setWallet(null)
      setAction(null)
      dismissNotification('wallet-progress')
      setMessage('钱包账户已变化或断开，请重新连接。', 'warning')
    }
    wallet.provider.on('accountsChanged', changed)
    wallet.provider.on('disconnect', changed)
    return () => {
      wallet.provider.removeListener('accountsChanged', changed)
      wallet.provider.removeListener('disconnect', changed)
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
  const needsTradingConnection = !!wallet && accountReady && !tradingReady
  const onboarding = !wallet
    ? '连接钱包开始交易'
    : needsTradingConnection
      ? '启用交易'
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
    ) => {
      if (connectPending.current) return
      connectPending.current = true
      const version = ++connectVersion.current
      setConnecting(name)
      setConnectionError('')
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
        setWeb3Panel((panel) => (panel === 'wallet' ? null : panel))
        const restored = await restoreTrading(session)
        if (version !== connectVersion.current) return
        activeWallet.current = restored
        setWallet(restored)
        if (!silent)
          setMessage(
            restored.exchange
              ? '交易连接已恢复，无需重复签名。'
              : '钱包已连接，正在读取余额与交易记录。',
            'success',
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
        const text = isUserRejection(e)
          ? '已取消连接钱包，可重新选择钱包连接。'
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
    if (!saved) return
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
          '原生请求没有客户端订单 ID，无法按本地编号确认。请在 TWAP / 当前委托和官方测试网页核对；不会自动重发。',
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

  async function execute(next: Action, persist = false) {
    if (!wallet || busyRef.current || funding.busy) return
    busyRef.current = true
    setBusy(true)
    setAction(null)
    notify(
      'loading',
      next.kind === 'approve'
        ? '等待钱包签名以启用交易…'
        : '请求处理中，请勿重复提交。',
      'trade-progress',
    )
    let cloid: `0x${string}` | undefined
    try {
      if (wallet.address !== next.account)
        throw new Error('账户已改变，请重新预览')
      if (next.kind === 'approve') {
        const authorized = await authorizeTrading(wallet, persist)
        if (
          activeWallet.current?.lifecycle !== wallet.lifecycle ||
          wallet.lifecycle?.active === false
        )
          throw new Error('授权过程中账户已变化，请重新连接')
        setWallet(authorized)
        setMessage(
          authorized.connectionSaved
            ? '交易已启用。下单、撤单无需逐笔钱包确认，刷新后可恢复连接。'
            : '交易已启用，但浏览器无法保存连接，刷新后需要重新启用。',
          authorized.connectionSaved ? 'success' : 'warning',
        )
        return
      }
      if (next.kind === 'ticket' && next.ticket.kind === 'chase') {
        if (unresolved || Date.now() - next.at > 15000)
          throw new Error('请核对未确认订单或重新预览追价单')
        const result = await chase.start(next.ticket)
        setMessage(result.message, tradeFeedbackTone(result.state))
        log(result)
        return
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
    } finally {
      busyRef.current = false
      setBusy(false)
      dismissNotification('trade-progress')
      account.refresh()
    }
  }

  function confirmAction(next: Action, skip = false, persist = false) {
    if (next.kind === 'order' || next.kind === 'ticket')
      rememberOrderConfirmation(next.kind === 'order' && next.order.r, skip)
    return execute(next, persist)
  }
  function requestOrder(
    next: Exclude<ConfirmationAction, { kind: 'approve' }>,
  ) {
    const close = next.kind === 'order' && next.order.r
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
  async function previewClose(
    position: NonNullable<
      typeof account.snapshot
    >['state']['assetPositions'][number]['position'],
    options?: { size: string; kind: 'market' | 'limit'; price: string },
  ) {
    if (!wallet) return
    try {
      const selected = markets.find((m) => m.name === position.coin)
      if (!selected) throw new Error('找不到仓位对应的市场')
      const current = await info.clearinghouseState({
        user: wallet.address,
        dex: selected.dex,
      })
      const latest = current.assetPositions.find(
        (item) => item.position.coin === position.coin,
      )?.position
      if (!latest || new Money(latest.szi).eq(0))
        throw new Error('仓位已关闭，请刷新账户')
      if (
        new Money(latest.szi).isPositive() !==
        new Money(position.szi).isPositive()
      )
        throw new Error('仓位方向已变化，请重新确认')
      const size = options?.size ?? new Money(latest.szi).abs().toFixed()
      if (positiveDecimal(size, '平仓数量').gt(new Money(latest.szi).abs()))
        throw new Error('平仓数量超过当前仓位')
      const book = await info.l2Book({ coin: position.coin })
      if (!book || Date.now() - book.time > 15000)
        throw new Error('该市场行情过期，暂不能平仓')
      const side = new Money(position.szi).gt(0) ? 'sell' : 'buy'
      const price =
        options?.kind === 'limit'
          ? options.price
          : book.levels[side === 'buy' ? 1 : 0][0]?.px
      if (!price) throw new Error('当前盘口没有对手方报价')
      const order = prepareOrder({
        market: selected,
        side,
        kind: options?.kind ?? 'market',
        price,
        size,
        reduceOnly: true,
        slippageBps: 50,
      })
      requestOrder({
        kind: 'order',
        orderKind: options?.kind ?? 'market',
        account: wallet.address,
        coin: position.coin,
        at: Date.now(),
        order,
      })
      return true
    } catch (e) {
      setMessage(errorText(e), 'error')
      return false
    }
  }

  async function previewProtection(
    name: string,
    takeProfit: string,
    stopLoss: string,
  ) {
    if (!wallet) throw new Error('请先连接钱包')
    const selected = markets.find((item) => item.name === name)
    if (!selected) throw new Error('市场不存在')
    const [state, contexts] = await Promise.all([
      info.clearinghouseState({ user: wallet.address, dex: selected.dex }),
      info.metaAndAssetCtxs({ dex: selected.dex }),
    ])
    if (activeAddress.current !== wallet.address) throw new Error('账户已变化')
    const position =
      state.assetPositions.find((item) => item.position.coin === name)?.position
        .szi ?? '0'
    const mark =
      contexts[1][contexts[0].universe.findIndex((item) => item.name === name)]
        ?.markPx
    if (!mark) throw new Error('无法读取标记价')
    previewTicket(
      preparePositionProtection(selected, mark, position, takeProfit, stopLoss),
    )
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

  function exportEvidence() {
    const blob = new Blob(
      [
        JSON.stringify(
          {
            version: 1,
            network: 'hyperliquid-testnet',
            apiUrl: API_URL,
            capturedAt: new Date().toISOString(),
            account: address,
            events: journal,
            snapshot: account.snapshot,
            market: { coin, bookTime: feed.book?.time },
          },
          null,
          2,
        ),
      ],
      { type: 'application/json' },
    )
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `hyperliquid-testnet-evidence-${Date.now()}.json`
    link.click()
    URL.revokeObjectURL(url)
  }

  function selectMarket(name: string) {
    if (!markets.some((m) => m.name === name)) return
    setCoin(name)
    setAction(null)
  }
  function disconnect() {
    clearTradingConnection()
    restoreAttempted.current = true
    setConnecting(null)
    connectVersion.current += 1
    if (activeWallet.current?.lifecycle)
      activeWallet.current.lifecycle.active = false
    activeWallet.current = null
    setWeb3Panel(null)
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
  async function previewApproval() {
    if (!wallet || !needsTradingConnection || busyRef.current || funding.busy)
      return
    busyRef.current = true
    setBusy(true)
    try {
      await assertTradingAccount(wallet)
      setAction({
        kind: 'approve',
        account: wallet.address,
        coin: '测试网账户',
        at: Date.now(),
      })
    } catch (e) {
      setMessage(
        isDepositRequired(e) ? DEPOSIT_REQUIRED_MESSAGE : errorText(e),
        isDepositRequired(e) ? 'warning' : 'error',
      )
      if (
        isDepositRequired(e) &&
        activeWallet.current?.lifecycle === wallet.lifecycle
      )
        setWeb3Panel('deposit')
    } finally {
      busyRef.current = false
      setBusy(false)
    }
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
    previewProtection,
    acknowledgeNative,
    markets,
    marketsError,
    catalogError,
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
    needsTradingConnection,
    onboarding,
    connect,
    disconnect,
    selectMarket,
    previewApproval,
    previewOrder,
    previewTicket,
    previewCancel,
    previewClose,
    previewLeverage,
    execute,
    reconcile,
    exportEvidence,
  }
}
export type TerminalModel = ReturnType<typeof useTerminal>
