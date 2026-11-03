import { TPSL_OVERLAY_STYLES } from './constants'
import { type TPSLDirection, TpslDirection, TpslEstimateType } from './types'

const S = TPSL_OVERLAY_STYLES

/**
 * 限制值在范围内
 */
export const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value))

export const getTextWidth = (() => {
  let ctx: CanvasRenderingContext2D | null = null
  return (text: string, font: string): number => {
    if (!ctx && typeof document !== 'undefined') {
      ctx = document.createElement('canvas').getContext('2d')
    }
    if (!ctx) return text.length * S.text.fontSize
    ctx.font = font
    return ctx.measureText(text).width
  }
})()

/**
 * 校验预估收益线的价格值是否在有效范围内
 * - 做多-止盈：价格需 > mainValue
 * - 做多-止损：价格需 < mainValue 且 > reducePrice
 * - 做空-止盈：价格需 < mainValue
 * - 做空-止损：价格需 > mainValue 且 < reducePrice
 * @returns true 合法，false 超出范围应取消操作
 */
export const isEstimateValueValid = (
  value: number,
  mainValue: number,
  direction: TPSLDirection,
  estimateType: TpslEstimateType,
  reducePrice?: number | null,
): boolean => {
  if (estimateType === TpslEstimateType.TakeProfit) {
    return direction === TpslDirection.Long
      ? value > mainValue
      : value < mainValue
  }
  const directionValid =
    direction === TpslDirection.Long ? value < mainValue : value > mainValue
  if (!directionValid) return false
  if (reducePrice != null && reducePrice > 0) {
    return direction === TpslDirection.Long
      ? value > reducePrice
      : value < reducePrice
  }
  return true
}

/**
 * 根据仓位方向和价格差判断是止盈还是止损
 * @param direction 仓位方向
 * @param mainValue 主线价格（入场价）
 * @param estimateValue 预估收益线价格（目标价）
 * @returns TpslEstimateType.TakeProfit | TpslEstimateType.StopLoss
 */
export const determineEstimateType = (
  direction: TPSLDirection,
  mainValue: number,
  estimateValue: number,
): TpslEstimateType => {
  const isAbove = estimateValue > mainValue

  if (direction === TpslDirection.Long) {
    // 做多：价格上涨盈利，向上拖动为止盈，向下拖动为止损
    return isAbove ? TpslEstimateType.TakeProfit : TpslEstimateType.StopLoss
  } else {
    // 做空：价格下跌盈利，向上拖动为止损，向下拖动为止盈
    return isAbove ? TpslEstimateType.StopLoss : TpslEstimateType.TakeProfit
  }
}

export const isNil = (value: unknown) => value == null

// 绘图补丁只包含普通对象、数组、原始值和回调；回调按引用比较。
export function isEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false
  const left = Object.entries(a),
    right = Object.entries(b)
  return (
    left.length === right.length &&
    left.every(
      ([key, value]) =>
        Object.hasOwn(b, key) &&
        isEqual(value, (b as Record<string, unknown>)[key]),
    )
  )
}
