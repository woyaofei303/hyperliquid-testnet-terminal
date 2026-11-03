import { getChartEngine } from '../../shared/engine'
import { TPSL_OVERLAY_STYLES, TPSL_PRICE_LABEL_FIGURE } from '../constants'
import { TEXT_SAFE_RIGHT_PADDING } from '../helpers/overlayConstants'

const S = TPSL_OVERLAY_STYLES

let priceLabelFigureRegistered = false

export interface TPSLPriceLabelAttrs {
  /** X 坐标 */
  x: number
  /** Y 坐标（中心点） */
  y: number
  /** 价格文本 */
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
 * 价格标签 Figure
 * 用于委托单模式显示价格
 */
export const registerPriceLabelFigure = (): void => {
  if (priceLabelFigureRegistered) return
  priceLabelFigureRegistered = true

  getChartEngine().registerFigure({
    name: TPSL_PRICE_LABEL_FIGURE,
    draw: (ctx: CanvasRenderingContext2D, attrs: TPSLPriceLabelAttrs) => {
      const { x, y, text, bgColor, textColor, borderColor } = attrs

      ctx.save()
      ctx.setLineDash([])
      ctx.font = `${S.text.fontWeight.regular} ${S.text.fontSize}px ${S.text.fontFamily}`

      const textWidth = ctx.measureText(text).width
      const badgeWidth =
        textWidth +
        S.mainLine.positionBadge.paddingX * 2 +
        TEXT_SAFE_RIGHT_PADDING
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
      attrs: TPSLPriceLabelAttrs,
    ) => {
      const { x, y, text } = attrs
      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d')
      if (!ctx) return false

      ctx.font = `${S.text.fontWeight.regular} ${S.text.fontSize}px ${S.text.fontFamily}`
      const textWidth = ctx.measureText(text).width
      const badgeWidth =
        textWidth +
        S.mainLine.positionBadge.paddingX * 2 +
        TEXT_SAFE_RIGHT_PADDING
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
