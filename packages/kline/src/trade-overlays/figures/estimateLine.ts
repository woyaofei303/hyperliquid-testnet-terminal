import { getThemeBg2Color } from '../../shared/colors'
import { getChartEngine } from '../../shared/engine'
import { TPSL_ESTIMATE_LINE_FIGURE, TPSL_OVERLAY_STYLES } from '../constants'
import {
  ESTIMATE_GAP,
  ESTIMATE_LEFT_OFFSET,
  SEGMENT_BORDER_OVERLAP,
  TEXT_SAFE_RIGHT_PADDING,
} from '../helpers/overlayConstants'
import type { TPSLEstimateLineAttrs } from './types'
import {
  drawCloseIcon,
  drawEstimateLineDragHandle,
  drawRoundedRect,
} from './utils'

const S = TPSL_OVERLAY_STYLES
const LINE_WIDTH = S.line.width
const LINE_DASH = S.line.dash
const HANDLE_HEIGHT = S.estimateLine.dragHandle.height
const HANDLE_BORDER_RADIUS = S.estimateLine.dragHandle.borderRadius

const getEstimateLabelWidth = (
  ctx: CanvasRenderingContext2D,
  estimateText: string,
): number =>
  Math.max(
    S.estimateLine.label.minWidth,
    ctx.measureText(estimateText).width +
      S.estimateLine.label.paddingX * 2 +
      TEXT_SAFE_RIGHT_PADDING,
  )

const getSegmentLayout = (
  x: number,
  estimateWidth: number,
  closeWidth: number,
  labelOffset?: number,
): { labelX: number; closeX: number; handleX: number } => {
  const labelX = x + (labelOffset ?? ESTIMATE_LEFT_OFFSET)
  const closeX = labelX + estimateWidth - SEGMENT_BORDER_OVERLAP
  const handleX = closeX + closeWidth - SEGMENT_BORDER_OVERLAP + ESTIMATE_GAP
  return { labelX, closeX, handleX }
}

let estimateLineFigureRegistered = false

/**
 * Register estimate line figure (TP/SL target line with estimate profit)
 * Layout: [Left offset] [Estimate Text Label] [Close] [Gap] [Drag Handle]
 */
export const registerEstimateLineFigure = (): void => {
  if (estimateLineFigureRegistered) return
  estimateLineFigureRegistered = true

  getChartEngine().registerFigure({
    name: TPSL_ESTIMATE_LINE_FIGURE,
    draw: (
      ctx: CanvasRenderingContext2D,
      attrs: TPSLEstimateLineAttrs,
      _styles: unknown,
    ) => {
      const {
        x,
        y,
        width,
        estimateText,
        priceText: _priceText,
        isLoss,
        labelOffsetX,
      } = attrs
      const color = isLoss ? S.colors.loss.primary : S.colors.profit.primary
      const bgColor = getThemeBg2Color()
      const closeSize = S.mainLine.closeButton.size
      const closePadding = S.mainLine.closeButton.padding
      const closeWidth = closeSize + closePadding * 2
      const handleWidth = S.estimateLine.dragHandle.width

      ctx.save()

      // Draw dashed horizontal line (behind labels)
      ctx.beginPath()
      ctx.setLineDash(LINE_DASH)
      ctx.moveTo(x, y)
      ctx.lineTo(width, y)
      ctx.strokeStyle = color
      ctx.lineWidth = LINE_WIDTH
      ctx.stroke()

      // 切回实线绘制标签边框
      ctx.setLineDash([])

      const badgeY = y - S.height / 2
      const handleY = y - HANDLE_HEIGHT / 2

      // 1. Estimate text label (on the left side)
      ctx.font = `${S.text.fontWeight.regular} ${S.text.fontSize}px ${S.text.fontFamily}`
      const estimateWidth = getEstimateLabelWidth(ctx, estimateText)
      const { labelX, closeX, handleX } = getSegmentLayout(
        x,
        estimateWidth,
        closeWidth,
        labelOffsetX,
      )

      // 1. Estimate text label
      drawRoundedRect(ctx, labelX, badgeY, estimateWidth, S.height, {
        tl: 2,
        tr: 2,
        br: 2,
        bl: 2,
      })
      ctx.fillStyle = bgColor
      ctx.fill()
      ctx.strokeStyle = color
      ctx.lineWidth = S.borderWidth
      ctx.stroke()
      ctx.fillStyle = color
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(estimateText, labelX + estimateWidth / 2, y)

      // 2. Close button (right)
      drawRoundedRect(ctx, closeX, badgeY, closeWidth, S.height, {
        tl: 0,
        tr: 2,
        br: 2,
        bl: 0,
      })
      ctx.fillStyle = bgColor
      ctx.fill()
      ctx.strokeStyle = color
      ctx.lineWidth = S.borderWidth
      ctx.stroke()
      drawCloseIcon(ctx, closeX + closeWidth / 2, y, closeSize, color)

      // 3. Drag handle (on the right side)
      drawRoundedRect(ctx, handleX, handleY, handleWidth, HANDLE_HEIGHT, {
        tl: HANDLE_BORDER_RADIUS,
        tr: HANDLE_BORDER_RADIUS,
        br: HANDLE_BORDER_RADIUS,
        bl: HANDLE_BORDER_RADIUS,
      })
      ctx.fillStyle = bgColor
      ctx.fill()
      ctx.strokeStyle = color
      ctx.lineWidth = S.borderWidth
      ctx.stroke()

      drawEstimateLineDragHandle(ctx, handleX + handleWidth / 2, y, color)

      ctx.restore()
    },
    checkEventOn: (
      coordinate: { x: number; y: number },
      attrs: TPSLEstimateLineAttrs,
    ) => {
      const { x, y, estimateText, labelOffsetX } = attrs
      const halfHeight = S.height / 2
      const handleHalfHeight = HANDLE_HEIGHT / 2
      const closeSize = S.mainLine.closeButton.size
      const closePadding = S.mainLine.closeButton.padding
      const closeWidth = closeSize + closePadding * 2
      const handleWidth = S.estimateLine.dragHandle.width

      const canvas = document.createElement('canvas')
      const measureCtx = canvas.getContext('2d')
      if (!measureCtx) return false
      measureCtx.font = `${S.text.fontWeight.regular} ${S.text.fontSize}px ${S.text.fontFamily}`
      const estimateWidth = getEstimateLabelWidth(measureCtx, estimateText)

      const { labelX, closeX, handleX } = getSegmentLayout(
        x,
        estimateWidth,
        closeWidth,
        labelOffsetX,
      )
      const isInLabelY =
        coordinate.y >= y - halfHeight && coordinate.y <= y + halfHeight
      const isInHandleY =
        coordinate.y >= y - handleHalfHeight &&
        coordinate.y <= y + handleHalfHeight
      return (
        (isInLabelY &&
          coordinate.x >= labelX &&
          coordinate.x <= labelX + estimateWidth) ||
        (isInLabelY &&
          coordinate.x >= closeX &&
          coordinate.x <= closeX + closeWidth) ||
        (isInHandleY &&
          coordinate.x >= handleX &&
          coordinate.x <= handleX + handleWidth)
      )
    },
  })
}
