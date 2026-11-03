import { getChartEngine } from '../../shared/engine'
import { TPSL_MAIN_LINE_HITBOX_FIGURE } from '../constants'

let mainLineHitboxFigureRegistered = false

export interface TPSLMainLineHitboxAttrs {
  /** X 坐标 */
  x: number
  /** Y 坐标（中心点） */
  y: number
  /** 宽度 */
  width: number
  /** 高度 */
  height: number
}

/**
 * 主线命中区域 Figure
 * 不可见的命中区域，用于捕获整条主线的 hover 和点击事件
 */
export const registerMainLineHitboxFigure = (): void => {
  if (mainLineHitboxFigureRegistered) return
  mainLineHitboxFigureRegistered = true

  getChartEngine().registerFigure({
    name: TPSL_MAIN_LINE_HITBOX_FIGURE,
    draw: () => {
      // 不绘制任何内容，仅用于事件命中
    },
    checkEventOn: (
      coordinate: { x: number; y: number },
      attrs: TPSLMainLineHitboxAttrs,
    ) => {
      const { x, y, width, height } = attrs
      const halfHeight = height / 2

      return (
        coordinate.x >= x &&
        coordinate.x <= x + width &&
        coordinate.y >= y - halfHeight &&
        coordinate.y <= y + halfHeight
      )
    },
  })
}
