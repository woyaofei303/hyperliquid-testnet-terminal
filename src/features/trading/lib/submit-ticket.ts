import {
  ApiRequestError,
  type OrderResponse,
} from '@nktkas/hyperliquid/api/exchange'
import type { WalletSession } from '../../../shared/lib/hyperliquid.ts'
import type { Ticket, WireOrder } from './order-ticket.ts'
import { orderResult } from './orders.ts'
import type { JournalEntry, PendingOrder } from './trading.ts'

export function batchOrderResults(
  response: OrderResponse,
  orders: WireOrder[],
) {
  if (
    response?.status !== 'ok' ||
    response.response?.type !== 'order' ||
    !Array.isArray(response.response.data?.statuses) ||
    response.response.data.statuses.length !== orders.length
  )
    throw new Error('批量回报数量或类型异常，请核对每一笔订单')
  return response.response.data.statuses.map((status, index) => {
    if (status === 'waitingForFill' || status === 'waitingForTrigger')
      return {
        state: 'waiting',
        message: status === 'waitingForFill' ? '父单成交后激活' : '等待触发',
        oid: undefined,
      }
    return orderResult(
      {
        status: 'ok',
        response: { type: 'order', data: { statuses: [status] } },
      },
      orders[index].s,
      'limit' in orders[index].t && orders[index].t.limit.tif === 'Ioc',
    )
  })
}
export async function submitOrderTicket(
  wallet: WalletSession,
  coin: string,
  ticket: Ticket,
  onPending: (value: PendingOrder | null) => void,
): Promise<Omit<JournalEntry, 'at'>> {
  if (!wallet.exchange || Date.now() >= wallet.expiresAt)
    throw new Error('交易会话已过期')
  if (ticket.kind === 'chase') throw new Error('追价单必须经策略管理器启动')
  const cloid = (): `0x${string}` =>
    `0x${crypto.randomUUID().replaceAll('-', '')}`
  const expiresAt = Math.min(Date.now() + 60000, wallet.expiresAt)
  const base = { account: wallet.address, coin, action: ticket.label }
  if (ticket.kind === 'twap' || ticket.kind === 'trailing') {
    if (!wallet.sendNative) throw new Error('请重新连接钱包以使用高级订单')
    onPending({
      account: wallet.address,
      coin,
      expiresAt,
      cloid: cloid(),
      native: ticket.kind,
    })
    const id = await wallet.sendNative(ticket.action)
    onPending(null)
    return {
      ...base,
      state: 'accepted',
      message: `${ticket.label}已受理 #${id}，由交易所持续执行`,
      oid: id,
    }
  }
  if (
    ticket.replaceOid !== undefined &&
    (!Number.isSafeInteger(ticket.replaceOid) ||
      ticket.replaceOid < 0 ||
      ticket.orders.length !== 1 ||
      !ticket.orders[0].r ||
      !('trigger' in ticket.orders[0].t))
  )
    throw new Error('保护单修改参数无效')
  const orders = ticket.orders.map((order) => ({ ...order, c: cloid() }))
  onPending({
    account: wallet.address,
    coin,
    expiresAt,
    cloid: orders[0].c,
    cloids: orders.map((order) => order.c),
  })
  let response: OrderResponse
  try {
    response =
      ticket.replaceOid === undefined
        ? await wallet.exchange.order(
            { orders, grouping: ticket.grouping },
            { expiresAfter: expiresAt },
          )
        : await wallet.exchange.batchModify(
            {
              modifies: [{ oid: ticket.replaceOid, order: orders[0] }],
              a: true,
            },
            { expiresAfter: expiresAt },
          )
  } catch (error) {
    if (!(error instanceof ApiRequestError)) throw error
    const raw = error.response as OrderResponse
    if (
      raw?.response?.type !== 'order' ||
      !Array.isArray(raw.response.data?.statuses)
    )
      throw error
    response = raw
  }
  const results = batchOrderResults(response, orders)
  if (results.every((result) => result.state !== 'pending')) onPending(null)
  const rejected = results.filter(
    (result) => result.state === 'rejected',
  ).length
  return {
    ...base,
    state: rejected
      ? rejected === results.length
        ? 'rejected'
        : 'partial-rejected'
      : results.some((result) => result.state === 'pending')
        ? 'pending'
        : 'accepted',
    message: `${ticket.label}回报：${results.length - rejected} 笔非拒绝、${rejected} 笔拒绝。${results.map((result, index) => `第 ${index + 1} 笔：${result.message}`).join('；')}`,
  }
}
