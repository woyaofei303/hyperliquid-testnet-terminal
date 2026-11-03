import { getChartEngine } from '../../shared/engine'
import { TPSL_HORIZONTAL_LINE_FIGURE, TPSL_OVERLAY_STYLES } from '../constants'

const S = TPSL_OVERLAY_STYLES
const LINE_WIDTH = S.line.width
const LINE_DASH = S.line.dash

let horizontalLineFigureRegistered = false

export interface TPSLHorizontalLineAttrs {
  /** 起始 X 坐标 */
  x: number
  /** Y 坐标 */
  y: number
  /** 线条宽度 */
  width: number
  /** 线条颜色 */
  color: string
  /** 是否虚线 */
  dashed?: boolean
}

/**
 * 水平线 Figure
 * 用于绘制主线和预估线的横线部分
 */
export const registerHorizontalLineFigure = (): void => {
  if (horizontalLineFigureRegistered) return
  horizontalLineFigureRegistered = true

  getChartEngine().registerFigure({
    name: TPSL_HORIZONTAL_LINE_FIGURE,
    draw: (ctx: CanvasRenderingContext2D, attrs: TPSLHorizontalLineAttrs) => {
      const { x, y, width, color, dashed = true } = attrs

      ctx.save()
      ctx.beginPath()
      if (dashed) {
        ctx.setLineDash(LINE_DASH)
      } else {
        ctx.setLineDash([])
      }
      ctx.moveTo(x, y)
      ctx.lineTo(width, y)
      ctx.strokeStyle = color
      ctx.lineWidth = LINE_WIDTH
      ctx.stroke()
      ctx.setLineDash([])
      ctx.restore()
    },
    checkEventOn: (
      coordinate: { x: number; y: number },
      attrs: TPSLHorizontalLineAttrs,
    ) => {
      const { x, y, width } = attrs
      const hitHeight = 4 // 扩大命中区域
      return (
        coordinate.x >= x &&
        coordinate.x <= width &&
        coordinate.y >= y - hitHeight &&
        coordinate.y <= y + hitHeight
      )
    },
  })
}
