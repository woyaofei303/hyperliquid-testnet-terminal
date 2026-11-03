import { getColorByCssVar } from '@fameex/utils'
import { getChartEngine } from '../../shared/engine'
import { TPSL_AREA_FIGURE } from '../constants'
import type { TPSLAreaAttrs } from './types'

let areaFigureRegistered = false

/**
 * Register area figure (background between main line and estimate line)
 */
export const registerAreaFigure = (): void => {
  if (areaFigureRegistered) return
  areaFigureRegistered = true

  getChartEngine().registerFigure({
    name: TPSL_AREA_FIGURE,
    draw: (
      ctx: CanvasRenderingContext2D,
      attrs: TPSLAreaAttrs,
      _styles: unknown,
    ) => {
      const { x, y1, y2, width, isDragging, isLoss } = attrs
      const minY = Math.min(y1, y2)
      const maxY = Math.max(y1, y2)
      const height = maxY - minY

      if (height <= 0) return

      ctx.save()

      ctx.fillStyle = isDragging
        ? isLoss
          ? getColorByCssVar('--fx-bg-r', 0.2) || 'rgba(255, 236, 236, 0.2)'
          : getColorByCssVar('--fx-bg-g', 0.2) || 'rgba(231, 248, 242, 0.2)'
        : isLoss
          ? getColorByCssVar('--fx-sem-r', 0.1) || 'rgba(235, 71, 71, 0.1)'
          : getColorByCssVar('--fx-sem-g', 0.1) || 'rgba(20, 184, 129, 0.1)'

      ctx.fillRect(x, minY, width - x, height)

      ctx.restore()
    },
    checkEventOn: () => false,
  })
}
