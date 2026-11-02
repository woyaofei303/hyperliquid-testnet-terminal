import type { AssetContext } from './hyperliquid.ts'
import { Money } from './orders.ts'
export function marketSummary(context: AssetContext | undefined) {
  if (!context?.markPx || !context.prevDayPx) return null
  const mark = new Money(context.markPx)
  const previous = new Money(context.prevDayPx)
  const change = mark.minus(previous)
  return {
    change: change.toFixed(),
    changePercent: previous.gt(0)
      ? change.div(previous).times(100).toFixed(2)
      : null,
    interestUsd:
      context.openInterest == null
        ? null
        : new Money(context.openInterest).times(mark).toFixed(),
    funding:
      context.funding == null
        ? null
        : new Money(context.funding).times(100).toFixed(4),
  }
}
export function fundingCountdown(now: number) {
  const seconds = Math.ceil((3600000 - (now % 3600000)) / 1000)
  return `${String(Math.floor(seconds / 3600)).padStart(2, '0')}:${String(Math.floor(seconds / 60) % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}
