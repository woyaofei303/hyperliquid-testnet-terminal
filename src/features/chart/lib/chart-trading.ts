import type {
  AccountState,
  OpenOrder,
} from '../../../shared/lib/hyperliquid.ts'
import { Money } from '../../trading/lib/orders.ts'

export type ProtectionKind = 'tp' | 'sl'
export function protectionKind(order: OpenOrder): ProtectionKind | null {
  if (!order.isTrigger || !order.reduceOnly || Number(order.triggerPx) <= 0)
    return null
  if (order.orderType.startsWith('Take Profit')) return 'tp'
  if (order.orderType.startsWith('Stop')) return 'sl'
  return null
}
export function positionProtections(
  position: AccountState['assetPositions'][number]['position'],
  orders: OpenOrder[],
) {
  const result: Partial<Record<ProtectionKind, OpenOrder>> = {}
  for (const kind of ['tp', 'sl'] as const) {
    const candidates = orders.filter(
      (order) =>
        order.coin === position.coin &&
        order.isPositionTpsl &&
        order.side === (Number(position.szi) > 0 ? 'A' : 'B') &&
        protectionKind(order) === kind &&
        (Number(order.origSz) === 0 ||
          new Money(order.sz).eq(new Money(position.szi).abs())),
    )
    // 多笔同侧或部分仓位保护保留为独立订单线，避免错误合并或撤销。
    if (candidates.length === 1) result[kind] = candidates[0]
  }
  return result
}
export function assertProtectionUnchanged(
  expected: OpenOrder,
  current: OpenOrder | undefined,
  coin: string,
  position: string,
  kind: ProtectionKind,
) {
  if (
    !current ||
    !Number.isSafeInteger(expected.oid) ||
    expected.oid < 0 ||
    expected.coin !== coin ||
    !expected.isPositionTpsl ||
    protectionKind(expected) !== kind ||
    expected.side !== (new Money(position).gt(0) ? 'A' : 'B') ||
    (
      [
        'oid',
        'coin',
        'side',
        'sz',
        'origSz',
        'limitPx',
        'triggerPx',
        'orderType',
        'reduceOnly',
        'isTrigger',
        'isPositionTpsl',
      ] as const
    ).some((key) => current[key] !== expected[key])
  )
    throw new Error('保护单已变化，请关闭后重新确认')
}
