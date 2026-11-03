import { getChartEngine } from '../../shared/engine'
import { TPSL_OVERLAY_STYLES, TPSL_PROFIT_LABEL_FIGURE } from '../constants'
import { PROFIT_LABEL_RIGHT_PADDING } from '../helpers/overlayConstants'
import { drawRoundedRect } from './utils'

const S = TPSL_OVERLAY_STYLES

let profitLabelFigureRegistered = false

export interface TPSLProfitLabelAttrs {
  /** X 坐标 */
  x: number
  /** Y 坐标（中心点） */
  y: number
  /** 收益文本 */
  text: string
  /** 背景颜色 */
  bgColor: string
  /** 文本颜色 */
  textColor: string
  /** 是否高亮（hover）状态 */
  isHovered?: boolean
}

/**
 * 收益标签 Figure
 * 用于持仓模式显示 "收益额 -3%" 等文本
 */
export const registerProfitLabelFigure = (): void => {
  if (profitLabelFigureRegistered) return
  profitLabelFigureRegistered = true

  getChartEngine().registerFigure({
    name: TPSL_PROFIT_LABEL_FIGURE,
    draw: (ctx: CanvasRenderingContext2D, attrs: TPSLProfitLabelAttrs) => {
      const { x, y, text, bgColor, textColor } = attrs

      ctx.save()
      ctx.setLineDash([])
      ctx.font = `${S.text.fontWeight.regular} ${S.text.fontSize}px ${S.text.fontFamily}`

      const textWidth = ctx.measureText(text).width
      const badgeWidth = Math.max(
        S.mainLine.leftBadge.minWidth,
        textWidth +
          S.mainLine.leftBadge.paddingX * 2 +
          PROFIT_LABEL_RIGHT_PADDING,
      )
      const badgeY = y - S.height / 2

      // Draw background with left rounded corners + stroke to match adjacent label height
      drawRoundedRect(ctx, x, badgeY, badgeWidth, S.height, {
        tl: 2,
        tr: 0,
        br: 0,
        bl: 2,
      })
      ctx.fillStyle = bgColor
      ctx.fill()
      ctx.strokeStyle = bgColor
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
      attrs: TPSLProfitLabelAttrs,
    ) => {
      const { x, y, text } = attrs
      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d')
      if (!ctx) return false

      ctx.font = `${S.text.fontWeight.regular} ${S.text.fontSize}px ${S.text.fontFamily}`
      const textWidth = ctx.measureText(text).width
      const badgeWidth = Math.max(
        S.mainLine.leftBadge.minWidth,
        textWidth +
          S.mainLine.leftBadge.paddingX * 2 +
          PROFIT_LABEL_RIGHT_PADDING,
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
