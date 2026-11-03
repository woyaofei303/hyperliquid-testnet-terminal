import { getChartEngine } from '../../shared/engine'
import { TPSL_LIMIT_LABEL_FIGURE, TPSL_OVERLAY_STYLES } from '../constants'
import { TEXT_SAFE_RIGHT_PADDING } from '../helpers/overlayConstants'
import { drawRoundedRect } from './utils'

const S = TPSL_OVERLAY_STYLES

let limitLabelFigureRegistered = false

export interface TPSLLimitLabelAttrs {
  /** X 坐标 */
  x: number
  /** Y 坐标（中心点） */
  y: number
  /** 文本内容 */
  text: string
  /** 背景颜色 */
  bgColor: string
  /** 文本颜色 */
  textColor: string
  /** 是否高亮（hover）状态 */
  isHovered?: boolean
}

/**
 * 限价标签 Figure
 * 用于委托单模式显示 "限价" 文本
 */
export const registerLimitLabelFigure = (): void => {
  if (limitLabelFigureRegistered) return
  limitLabelFigureRegistered = true

  getChartEngine().registerFigure({
    name: TPSL_LIMIT_LABEL_FIGURE,
    draw: (ctx: CanvasRenderingContext2D, attrs: TPSLLimitLabelAttrs) => {
      const { x, y, text, bgColor, textColor } = attrs

      ctx.save()
      ctx.font = `${S.text.fontWeight.regular} ${S.text.fontSize}px ${S.text.fontFamily}`

      const textWidth = ctx.measureText(text).width
      const badgeWidth =
        textWidth + S.mainLine.leftBadge.paddingX * 2 + TEXT_SAFE_RIGHT_PADDING
      const badgeY = y - S.height / 2

      // Draw background with left rounded corners + stroke to match price label height
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
      attrs: TPSLLimitLabelAttrs,
    ) => {
      const { x, y, text } = attrs
      // 需要临时创建 canvas context 来测量文本宽度
      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d')
      if (!ctx) return false

      ctx.font = `${S.text.fontWeight.regular} ${S.text.fontSize}px ${S.text.fontFamily}`
      const textWidth = ctx.measureText(text).width
      const badgeWidth =
        textWidth + S.mainLine.leftBadge.paddingX * 2 + TEXT_SAFE_RIGHT_PADDING
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
