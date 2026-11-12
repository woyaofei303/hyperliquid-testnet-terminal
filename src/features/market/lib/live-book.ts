import type { Book } from '../../../shared/lib/fameex-testnet.ts'
import { Money } from '../../trading/lib/orders.ts'

export function createLiveBook(coin: string) {
  let full: Book | null = null
  let fast: Book | null = null
  return {
    accept(data: Book | null, quick: boolean): Book | null {
      if (
        !data ||
        data.coin !== coin ||
        data.time < ((quick ? fast : full)?.time ?? 0)
      )
        return null
      if (quick) fast = data
      else full = data
      if (!fast || (full && full.time > fast.time)) return full
      const tail = full && fast.time - full.time <= 15000 ? full : null
      // 快照不是增量：前五档覆盖旧报价，深档仅保留在快速快照范围之外的价格。
      const levels = fast.levels.map((rows, side) => {
        const boundary = rows.at(-1)?.px
        if (!boundary) return []
        return [
          ...rows,
          ...(tail?.levels[side] ?? []).filter((row) =>
            side === 0
              ? new Money(row.px).lt(boundary)
              : new Money(row.px).gt(boundary),
          ),
        ].slice(0, 20)
      }) as Book['levels']
      return { ...fast, levels }
    },
  }
}
