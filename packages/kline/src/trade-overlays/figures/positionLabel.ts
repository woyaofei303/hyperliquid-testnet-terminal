import { getChartEngine } from '../../shared/engine'
import { TPSL_OVERLAY_STYLES, TPSL_POSITION_LABEL_FIGURE } from '../constants'

const S = TPSL_OVERLAY_STYLES

let positionLabelFigureRegistered = false

export interface TPSLPositionLabelAttrs {
  /** X 坐标 */
  x: number
  /** Y 坐标（中心点） */
  y: number
  /** 持仓量文本 */
  text: string
  /** 背景颜色 */
  bgColor: string
  /** 文本颜色 */
  textColor: string
  /** 边框颜色 */
  borderColor: string
  /** 是否高亮（hover）状态 */
  isHovered?: boolean
}

/**
 * 持仓量标签 Figure
 * 用于持仓模式显示持仓数量
 */
export const registerPositionLabelFigure = (): void => {
  if (positionLabelFigureRegistered) return
  positionLabelFigureRegistered = true

  getChartEngine().registerFigure({
    name: TPSL_POSITION_LABEL_FIGURE,
    draw: (ctx: CanvasRenderingContext2D, attrs: TPSLPositionLabelAttrs) => {
      const { x, y, text, bgColor, textColor, borderColor } = attrs

      ctx.save()
      ctx.setLineDash([])
      ctx.font = `${S.text.fontWeight.regular} ${S.text.fontSize}px ${S.text.fontFamily}`

      const textWidth = ctx.measureText(text).width
      const badgeWidth = Math.max(
        S.mainLine.positionBadge.minWidth,
        textWidth + S.mainLine.positionBadge.paddingX * 2,
      )
      const badgeY = y - S.height / 2

      // Draw background
      ctx.beginPath()
      ctx.rect(x, badgeY, badgeWidth, S.height)
      ctx.fillStyle = bgColor
      ctx.fill()
      ctx.strokeStyle = borderColor
      ctx.lineWidth = S.borderWidth
      ctx.stroke()

      // Draw text
      ctx.fillStyle = textColor
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(text, x + badgeWidth / 2, y)

      ctx.restore()
    },
    checkEventOn: (
      coordinate: { x: number; y: number },
      attrs: TPSLPositionLabelAttrs,
    ) => {
      const { x, y, text } = attrs
      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d')
      if (!ctx) return false

      ctx.font = `${S.text.fontWeight.regular} ${S.text.fontSize}px ${S.text.fontFamily}`
      const textWidth = ctx.measureText(text).width
      const badgeWidth = Math.max(
        S.mainLine.positionBadge.minWidth,
        textWidth + S.mainLine.positionBadge.paddingX * 2,
      )
      const halfHeight = S.height / 2

      return (
        coordinate.x >= x &&
        coordinate.x <= x + badgeWidth &&
        coordinate.y >= y - halfHeight &&
        coordinate.y <= y + halfHeight
      )
    },
  })
}
