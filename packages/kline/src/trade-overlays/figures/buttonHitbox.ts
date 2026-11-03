import { getChartEngine } from '../../shared/engine'
import { TPSL_BUTTON_HITBOX_FIGURE } from '../constants'
import type { TPSLButtonHitboxAttrs } from './types'

let buttonHitboxFigureRegistered = false

/**
 * Register button hitbox figure (used for hover/click/drag detection)
 */
export const registerButtonHitboxFigure = (): void => {
  if (buttonHitboxFigureRegistered) return
  buttonHitboxFigureRegistered = true

  getChartEngine().registerFigure({
    name: TPSL_BUTTON_HITBOX_FIGURE,
    draw: () => {
      // 不绘制任何内容，仅用于事件命中
    },
    checkEventOn: (
      coordinate: { x: number; y: number },
      attrs: TPSLButtonHitboxAttrs,
    ) => {
      const { x, y, width, height } = attrs
      return (
        coordinate.x >= x &&
        coordinate.x <= x + width &&
        coordinate.y >= y &&
        coordinate.y <= y + height
      )
    },
  })
}
