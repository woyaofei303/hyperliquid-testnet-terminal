import { getThemeBg2Color } from '../../shared/colors'
import { getChartEngine } from '../../shared/engine'
import { TPSL_DRAG_HANDLE_FIGURE, TPSL_OVERLAY_STYLES } from '../constants'
import type { TPSLDragHandleAttrs } from './types'
import { drawEstimateLineDragHandle, drawRoundedRect } from './utils'

const S = TPSL_OVERLAY_STYLES
const DRAG_HANDLE_HEIGHT = S.estimateLine.dragHandle.height
const DRAG_HANDLE_BORDER_RADIUS = S.estimateLine.dragHandle.borderRadius

let dragHandleFigureRegistered = false

/**
 * Register drag handle figure (standalone drag handle for adjustment)
 */
export const registerDragHandleFigure = (): void => {
  if (dragHandleFigureRegistered) return
  dragHandleFigureRegistered = true

  getChartEngine().registerFigure({
    name: TPSL_DRAG_HANDLE_FIGURE,
    draw: (
      ctx: CanvasRenderingContext2D,
      attrs: TPSLDragHandleAttrs,
      _styles: unknown,
    ) => {
      const { x, y, isLoss } = attrs
      const color = isLoss ? S.colors.loss.primary : S.colors.profit.primary
      const bgColor = getThemeBg2Color()
      const handleWidth = S.estimateLine.dragHandle.width
      const badgeY = y - DRAG_HANDLE_HEIGHT / 2

      ctx.save()

      drawRoundedRect(ctx, x, badgeY, handleWidth, DRAG_HANDLE_HEIGHT, {
        tl: DRAG_HANDLE_BORDER_RADIUS,
        tr: DRAG_HANDLE_BORDER_RADIUS,
        br: DRAG_HANDLE_BORDER_RADIUS,
        bl: DRAG_HANDLE_BORDER_RADIUS,
      })
      ctx.fillStyle = bgColor
      ctx.fill()
      ctx.strokeStyle = color
      ctx.lineWidth = S.borderWidth
      ctx.stroke()

      drawEstimateLineDragHandle(ctx, x + handleWidth / 2, y, color)

      ctx.restore()
    },
    checkEventOn: (
      coordinate: { x: number; y: number },
      attrs: TPSLDragHandleAttrs,
    ) => {
      const { x, y } = attrs
      const halfHeight = DRAG_HANDLE_HEIGHT / 2
      const handleWidth = S.estimateLine.dragHandle.width
      return (
        coordinate.x >= x &&
        coordinate.x <= x + handleWidth &&
        coordinate.y >= y - halfHeight &&
        coordinate.y <= y + halfHeight
      )
    },
  })
}
