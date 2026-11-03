import { getChartEngine } from '../../shared/engine'
import { TPSL_CLOSE_BUTTON_FIGURE, TPSL_OVERLAY_STYLES } from '../constants'
import { drawCloseIcon, drawRoundedRect } from './utils'

const S = TPSL_OVERLAY_STYLES

let closeButtonFigureRegistered = false

export interface TPSLCloseButtonAttrs {
  /** X 坐标 */
  x: number
  /** Y 坐标（中心点） */
  y: number
  /** 背景颜色 */
  bgColor: string
  /** 图标颜色 */
  iconColor: string
  /** 边框颜色 */
  borderColor: string
  /** 是否高亮（hover）状态 */
  isHovered: boolean
  /** 左侧圆角 */
  hasLeftRadius?: boolean
  /** 右侧圆角 */
  hasRightRadius?: boolean
}

/**
 * 关闭按钮 Figure
 * 支持 hover 状态和点击事件
 */
export const registerCloseButtonFigure = (): void => {
  if (closeButtonFigureRegistered) return
  closeButtonFigureRegistered = true

  getChartEngine().registerFigure({
    name: TPSL_CLOSE_BUTTON_FIGURE,
    draw: (ctx: CanvasRenderingContext2D, attrs: TPSLCloseButtonAttrs) => {
      const {
        x,
        y,
        bgColor,
        iconColor,
        borderColor,
        hasLeftRadius = false,
        hasRightRadius = true,
      } = attrs

      const closeSize = S.mainLine.closeButton.size
      const closePadding = S.mainLine.closeButton.padding
      const closeWidth = closeSize + closePadding * 2
      const badgeY = y - S.height / 2

      ctx.save()
      ctx.setLineDash([])

      // Draw background with rounded corners
      drawRoundedRect(ctx, x, badgeY, closeWidth, S.height, {
        tl: hasLeftRadius ? 2 : 0,
        tr: hasRightRadius ? 2 : 0,
        br: hasRightRadius ? 2 : 0,
        bl: hasLeftRadius ? 2 : 0,
      })
      ctx.fillStyle = bgColor
      ctx.fill()
      ctx.strokeStyle = borderColor
      ctx.lineWidth = S.borderWidth
      ctx.stroke()

      // Draw close icon (X)
      drawCloseIcon(ctx, x + closeWidth / 2, y, closeSize, iconColor)

      ctx.restore()
    },
    checkEventOn: (
      coordinate: { x: number; y: number },
      attrs: TPSLCloseButtonAttrs,
    ) => {
      const { x, y } = attrs
      const closeSize = S.mainLine.closeButton.size
      const closePadding = S.mainLine.closeButton.padding
      const closeWidth = closeSize + closePadding * 2
      const halfHeight = S.height / 2
      const buffer = 2

      return (
        coordinate.x >= x - buffer &&
        coordinate.x <= x + closeWidth + buffer &&
        coordinate.y >= y - halfHeight - buffer &&
        coordinate.y <= y + halfHeight + buffer
      )
    },
  })
}
