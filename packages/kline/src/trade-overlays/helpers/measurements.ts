import type { TpslOverlayData } from '../types'
import { TPSL_LINE_TYPES } from '../types'
import { getTextWidth } from '../utils'
import {
  BUTTON_GAP,
  LEAVE_PADDING,
  LEFT_OFFSET,
  PROFIT_LABEL_RIGHT_PADDING,
  S,
  TEXT_SAFE_RIGHT_PADDING,
} from './overlayConstants'

export type LabelWidths = {
  limitWidth: number
  priceWidth: number
  profitWidth: number
  positionWidth: number
}

export type ActionLayout = {
  closeWidth: number
  tpslButtonWidth: number
  closeOffsetX: number
  tpslOffsetX: number
  totalWidth: number
  enterWidth: number
  leaveWidth: number
}

export type MeasureTextFn = (text: string) => number

export const createMeasureText = (font: string): MeasureTextFn => {
  const cache = new Map<string, number>()
  return (text: string) => {
    if (cache.has(text)) {
      return cache.get(text) as number
    }
    const width = getTextWidth(text, font)
    cache.set(text, width)
    return width
  }
}

export const calculateLabelWidths = (
  item: TpslOverlayData,
  measureText: MeasureTextFn,
  texts: { limit: string; profitAmount?: string },
): LabelWidths => {
  if (item.lineType !== TPSL_LINE_TYPES.Position) {
    const limitLabelTextWidth = measureText(texts.limit)
    const limitWidth =
      limitLabelTextWidth +
      S.mainLine.leftBadge.paddingX * 2 +
      TEXT_SAFE_RIGHT_PADDING
    const priceTextWidth = measureText(item.orderPriceText)
    const priceWidth =
      priceTextWidth +
      S.mainLine.positionBadge.paddingX * 2 +
      TEXT_SAFE_RIGHT_PADDING

    return { limitWidth, priceWidth, profitWidth: 0, positionWidth: 0 }
  }

  const profitText = texts.profitAmount
    ? `${texts.profitAmount} ${item.profitPercent}`
    : item.profitPercent
  const profitTextWidth = measureText(profitText)
  const profitWidth = Math.max(
    S.mainLine.leftBadge.minWidth,
    profitTextWidth +
      S.mainLine.leftBadge.paddingX * 2 +
      PROFIT_LABEL_RIGHT_PADDING,
  )

  const positionTextWidth = measureText(item.positionAmount)
  const positionWidth = Math.max(
    S.mainLine.positionBadge.minWidth,
    positionTextWidth + S.mainLine.positionBadge.paddingX * 2,
  )

  return { limitWidth: 0, priceWidth: 0, profitWidth, positionWidth }
}

export const calculateActionLayout = (
  labelsWidth: number,
  measureText: MeasureTextFn,
  opts?: { buttonText?: string; includeTpslButton?: boolean },
): ActionLayout => {
  const { buttonText, includeTpslButton = true } = opts ?? {}
  const closeWidth =
    S.mainLine.closeButton.size + S.mainLine.closeButton.padding * 2
  const closeOffsetX = LEFT_OFFSET + labelsWidth

  if (!includeTpslButton) {
    const totalWidth = closeOffsetX + closeWidth
    return {
      closeWidth,
      tpslButtonWidth: 0,
      closeOffsetX,
      tpslOffsetX: 0,
      totalWidth,
      enterWidth: totalWidth,
      leaveWidth: totalWidth + LEAVE_PADDING,
    }
  }

  const dragHandlePadding = S.mainLine.tpslButton.dragHandlePadding
  const effectiveText = buttonText || ''
  const textWidth = measureText(effectiveText)
  const tpslButtonWidth = Math.max(
    S.mainLine.tpslButton.minWidth,
    textWidth +
      S.mainLine.tpslButton.paddingX * 2 +
      S.mainLine.tpslButton.dragHandleWidth +
      dragHandlePadding * 2,
  )

  const tpslOffsetX = closeOffsetX + closeWidth - S.borderWidth + BUTTON_GAP
  const totalWidth = tpslOffsetX + tpslButtonWidth

  return {
    closeWidth,
    tpslButtonWidth,
    closeOffsetX,
    tpslOffsetX,
    totalWidth,
    enterWidth: totalWidth,
    leaveWidth: totalWidth + LEAVE_PADDING,
  }
}
