import { getChartEngine } from '../../shared/engine'
import { TPSL_OVERLAY_STYLES, TPSL_TPSL_BUTTON_FIGURE } from '../constants'
import { drawDragHandle, drawRoundedRect } from './utils'

const S = TPSL_OVERLAY_STYLES
const DRAG_HANDLE_PADDING = S.mainLine.tpslButton.dragHandlePadding

let tpslButtonFigureRegistered = false

export interface TPSLTpslButtonAttrs {
  /** X 坐标 */
  x: number
  /** Y 坐标（中心点） */
  y: number
  /** 背景颜色 */
  bgColor: string
  /** 文本颜色 */
  textColor: string
  /** 边框颜色 */
  borderColor: string
  /** 拖拽手柄颜色 */
  handleColor: string
  /** 是否高亮（hover）状态 */
  isHovered: boolean
  /** 按钮文本（默认 "止盈止损"） */
  buttonText?: string
}

/**
 * 止盈止损按钮 Figure
 * 显示 "止盈止损" 文本和拖拽手柄
 */
export const registerTpslButtonFigure = (): void => {
  if (tpslButtonFigureRegistered) return
  tpslButtonFigureRegistered = true

  getChartEngine().registerFigure({
    name: TPSL_TPSL_BUTTON_FIGURE,
    draw: (ctx: CanvasRenderingContext2D, attrs: TPSLTpslButtonAttrs) => {
      const { x, y, bgColor, textColor, borderColor, handleColor, buttonText } =
        attrs

      ctx.save()
      ctx.setLineDash([])
      ctx.font = `${S.text.fontWeight.regular} ${S.text.fontSize}px ${S.text.fontFamily}`

      const tpslText = buttonText || ''
      const tpslTextWidth = ctx.measureText(tpslText).width
      const tpslWidth = tpslTextWidth + S.mainLine.tpslButton.paddingX * 2
      const dragHandleWidth =
        S.mainLine.tpslButton.dragHandleWidth + DRAG_HANDLE_PADDING * 2
      const totalWidth = tpslWidth + dragHandleWidth
      const badgeY = y - S.height / 2

      // Draw background with rounded corners
      drawRoundedRect(ctx, x, badgeY, totalWidth, S.height, {
        tl: 2,
        tr: 2,
        br: 2,
        bl: 2,
      })
      ctx.fillStyle = bgColor
      ctx.fill()
      ctx.strokeStyle = borderColor
      ctx.lineWidth = S.borderWidth
      ctx.stroke()

      // Draw tpsl text
      ctx.fillStyle = textColor
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(tpslText, x + tpslWidth / 2, y)

      // Draw vertical separator line between text and drag handle
      const separatorX = x + tpslWidth
      ctx.beginPath()
      ctx.moveTo(separatorX, badgeY)
      ctx.lineTo(separatorX, badgeY + S.height)
      ctx.strokeStyle = borderColor
      ctx.lineWidth = S.borderWidth
      ctx.stroke()

      // Draw drag handle (centered in handle section)
      const handleX = x + tpslWidth
      drawDragHandle(ctx, handleX + dragHandleWidth / 2, y, handleColor)

      ctx.restore()
    },
    checkEventOn: (
      coordinate: { x: number; y: number },
      attrs: TPSLTpslButtonAttrs,
    ) => {
      const { x, y, buttonText } = attrs
      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d')
      if (!ctx) return false

      ctx.font = `${S.text.fontWeight.regular} ${S.text.fontSize}px ${S.text.fontFamily}`
      const tpslText = buttonText || ''
      const tpslTextWidth = ctx.measureText(tpslText).width
      const tpslWidth = tpslTextWidth + S.mainLine.tpslButton.paddingX * 2
      const dragHandleWidth =
        S.mainLine.tpslButton.dragHandleWidth + DRAG_HANDLE_PADDING * 2
      const totalWidth = tpslWidth + dragHandleWidth
      const halfHeight = S.height / 2

      return (
        coordinate.x >= x &&
        coordinate.x <= x + totalWidth &&
        coordinate.y >= y - halfHeight &&
        coordinate.y <= y + halfHeight
      )
    },
  })
}
