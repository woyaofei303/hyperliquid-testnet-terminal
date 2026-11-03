import { getThemeBg2Color } from '../../shared/colors'
import { getChartEngine } from '../../shared/engine'
import {
  TPSL_OVERLAY_STYLES,
  TPSL_VERTICAL_CONNECTOR_FIGURE,
} from '../constants'

let registered = false

export interface TPSLVerticalConnectorAttrs {
  /** X 坐标（垂线的水平位置） */
  x: number
  /** 主线 Y 坐标 */
  mainY: number
  /** 预估线 Y 坐标 */
  estimateY: number
  /** 垂线颜色（多空方向色） */
  lineColor: string
  /** 主线端圆圈颜色（主线对应的水平线颜色） */
  mainCircleColor: string
  /** 预估线端圆圈颜色（预估线对应的水平线颜色） */
  estimateCircleColor: string
}

const CIRCLE_RADIUS = 3
const CIRCLE_LINE_WIDTH = 1.5
const LINE_WIDTH = TPSL_OVERLAY_STYLES.line.width
const LINE_DASH = TPSL_OVERLAY_STYLES.line.dash

export const registerVerticalConnectorFigure = (): void => {
  if (registered) return
  registered = true

  getChartEngine().registerFigure({
    name: TPSL_VERTICAL_CONNECTOR_FIGURE,
    draw: (
      ctx: CanvasRenderingContext2D,
      attrs: TPSLVerticalConnectorAttrs,
    ) => {
      const {
        x,
        mainY,
        estimateY,
        lineColor,
        mainCircleColor,
        estimateCircleColor,
      } = attrs
      const bgColor = getThemeBg2Color()

      ctx.save()

      // 垂线（虚线）
      ctx.beginPath()
      ctx.setLineDash(LINE_DASH)
      ctx.strokeStyle = lineColor
      ctx.lineWidth = LINE_WIDTH
      ctx.moveTo(x, mainY)
      ctx.lineTo(x, estimateY)
      ctx.stroke()
      ctx.setLineDash([])

      // 主线端空心圆圈（bg2 填充）
      ctx.beginPath()
      ctx.arc(x, mainY, CIRCLE_RADIUS, 0, Math.PI * 2)
      ctx.fillStyle = bgColor
      ctx.fill()
      ctx.strokeStyle = mainCircleColor
      ctx.lineWidth = CIRCLE_LINE_WIDTH
      ctx.stroke()

      // 预估线端空心圆圈（bg2 填充）
      ctx.beginPath()
      ctx.arc(x, estimateY, CIRCLE_RADIUS, 0, Math.PI * 2)
      ctx.fillStyle = bgColor
      ctx.fill()
      ctx.strokeStyle = estimateCircleColor
      ctx.lineWidth = CIRCLE_LINE_WIDTH
      ctx.stroke()

      ctx.restore()
    },
    checkEventOn: () => false,
  })
}
