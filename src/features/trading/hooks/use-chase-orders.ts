import { useCallback, useEffect, useRef, useState } from 'react'
import { isCash } from '@/features/market/lib/market-catalog'
import {
  loadCashFunds,
  validateCashTicketFunds,
} from '@/features/trading/lib/cash-order'
import {
  chaseQuote,
  chaseRemainder,
  placeChaseOrder,
} from '@/features/trading/lib/chase'
import type { Ticket } from '@/features/trading/lib/order-ticket'
import { Money } from '@/features/trading/lib/orders'
import { loadPending, type PendingOrder } from '@/features/trading/lib/trading'
import { errorText, info, type WalletSession } from '@/shared/lib/hyperliquid'

type ChaseTicket = Extract<Ticket, { kind: 'chase' }>
type Chase = {
  id: string
  createdAt: number
  account: `0x${string}`
  ticket: ChaseTicket
  oid: number
  price: string
  remaining: string
  active: boolean
  status: string
}
export function useChaseOrders(
  wallet: WalletSession | null,
  onPending: (pending: PendingOrder | null) => void,
) {
  const entries = useRef<Chase[]>([])
  const [rows, setRows] = useState<Chase[]>([])
  const session = useRef(wallet)
  session.current = wallet
  const pendingCallback = useRef(onPending)
  pendingCallback.current = onPending
  const lock = useRef(false)
  const publish = useCallback(
    () => setRows(entries.current.map((row) => ({ ...row }))),
    [],
  )
  useEffect(() => {
    let disposed = false
    const tick = async () => {
      if (
        lock.current ||
        disposed ||
        !entries.current.some((row) => row.active)
      )
        return
      lock.current = true
      try {
        for (const entry of entries.current.filter((row) => row.active)) {
          const valid = () =>
            !disposed &&
            entry.active &&
            session.current === wallet &&
            !!wallet?.exchange &&
            Date.now() < wallet.expiresAt &&
            !loadPending(wallet.address)
          if (!valid() || !wallet?.exchange) {
            entry.active = false
            entry.status = '已停止改价，原委托请在当前委托核对'
            continue
          }
          try {
            const current = await info.orderStatus({
              user: wallet.address,
              oid: entry.oid,
            })
            if (!valid()) continue
            if (current.status !== 'order')
              throw new Error('订单状态不明，停止追价')
            const remaining = new Money(current.order.order.sz)
            if (
              !remaining.isFinite() ||
              remaining.lt(0) ||
              remaining.gt(entry.remaining)
            )
              throw new Error('剩余数量异常，停止追价')
            entry.remaining =
              current.order.status === 'filled' ? '0' : remaining.toFixed()
            if (current.order.status !== 'open') {
              entry.active = false
              entry.status = `已结束：${current.order.status}`
              continue
            }
            const book = await info.l2Book({ coin: entry.ticket.market.name })
            if (!valid()) continue
            const price = chaseQuote(
              book,
              entry.ticket.order,
              entry.ticket.market,
              current.order.order.limitPx,
            )
            if (new Money(price).eq(current.order.order.limitPx)) continue
            // 先确认撤销和最终剩余量，再重挂，避免改价期间的成交导致超出总授权数量。
            await wallet.exchange.cancel({
              cancels: [{ a: entry.ticket.market.asset, o: entry.oid }],
            })
            const final = await info.orderStatus({
              user: wallet.address,
              oid: entry.oid,
            })
            if (final.status !== 'order')
              throw new Error('撤单结果未知，请核对原订单')
            entry.remaining = chaseRemainder(
              entry.remaining,
              final.order.order.sz,
              final.order.status,
            )
            if (!valid()) continue
            if (
              new Money(entry.remaining).isZero() ||
              (!entry.ticket.order.r &&
                new Money(entry.remaining).times(price).lt(10))
            ) {
              entry.active = false
              entry.status = '已结束，剩余数量不足最小委托金额或已成交'
              continue
            }
            const order = {
              ...entry.ticket.order,
              p: price,
              s: entry.remaining,
            }
            if (isCash(entry.ticket.market)) {
              const funds = await loadCashFunds(
                entry.ticket.market,
                wallet.address,
              )
              if (!valid()) continue
              validateCashTicketFunds(
                { ...entry.ticket, order, size: entry.remaining },
                funds.balances,
                funds.feeRate,
              )
            }
            const result = await placeChaseOrder(
              wallet,
              entry.ticket.market.name,
              order,
              pendingCallback.current,
            )
            if (result.state !== 'resting' || result.oid == null)
              throw new Error(result.message)
            entry.oid = result.oid
            entry.price = price
            entry.status = entry.active ? '追价中' : '已停止改价，委托仍有效'
          } catch (error) {
            entry.active = false
            entry.status = `${errorText(error)}；请在当前委托核对`
          }
        }
      } finally {
        lock.current = false
        if (!disposed) publish()
      }
    }
    const timer = window.setInterval(() => void tick(), 2000)
    return () => {
      disposed = true
      window.clearInterval(timer)
      for (const entry of entries.current) {
        entry.active = false
        entry.status = '会话结束，已停止改价；原委托仍需核对'
      }
    }
  }, [wallet, publish])
  async function start(ticket: ChaseTicket) {
    if (!wallet?.exchange || session.current !== wallet)
      throw new Error('请先完成钱包连接')
    if (lock.current) throw new Error('策略正在更新，请稍后重试')
    if (entries.current.filter((row) => row.active).length >= 5)
      throw new Error('最多同时运行 5 笔追价单')
    lock.current = true
    try {
      const book = await info.l2Book({ coin: ticket.market.name })
      if (session.current !== wallet) throw new Error('账户已变化')
      const price = chaseQuote(book, ticket.order, ticket.market)
      const order = { ...ticket.order, p: price }
      if (isCash(ticket.market)) {
        const funds = await loadCashFunds(ticket.market, wallet.address)
        if (session.current !== wallet) throw new Error('账户已变化')
        validateCashTicketFunds(
          { ...ticket, order },
          funds.balances,
          funds.feeRate,
        )
      }
      const result = await placeChaseOrder(
        wallet,
        ticket.market.name,
        order,
        pendingCallback.current,
      )
      if (result.state === 'resting' && result.oid != null) {
        const active = session.current === wallet
        entries.current = [
          ...entries.current.slice(-49),
          {
            id: crypto.randomUUID(),
            createdAt: Date.now(),
            account: wallet.address,
            ticket,
            oid: result.oid,
            price,
            remaining: ticket.size,
            active,
            status: active ? '追价中' : '会话结束，原委托仍有效',
          },
        ]
        publish()
      }
      return {
        ...result,
        action: 'chase',
        message: `追价单：${result.message}`,
      }
    } finally {
      lock.current = false
    }
  }
  function stop(id: string) {
    const entry = entries.current.find((row) => row.id === id)
    if (!entry) return
    entry.active = false
    entry.status =
      '已停止改价，正在发送的请求可能完成；请在当前委托撤销剩余订单'
    publish()
  }
  return {
    rows: rows.filter((row) => row.account === wallet?.address),
    start,
    stop,
  }
}
