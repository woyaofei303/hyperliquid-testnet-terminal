import type { OverlayTemplate } from 'klinecharts'
import { TPSL_AREA_FIGURE, TPSL_OVERLAY_STYLES } from '../constants'
import { registerAreaFigure, type TPSLAreaAttrs } from '../figures/index'
import { TPSL_TEMPLATE_NAMES } from '../idFactory'
import { clamp } from '../utils'

const S = TPSL_OVERLAY_STYLES

export interface AreaExtendData {
  isDragging: boolean
  isLoss: boolean
}

export const areaTemplate: OverlayTemplate<AreaExtendData> = {
  name: TPSL_TEMPLATE_NAMES.area,
  fixedZLevel: true,
  totalStep: 2,
  needDefaultPointFigure: false,
  needDefaultXAxisFigure: false,
  needDefaultYAxisFigure: false,
  createPointFigures: ({ coordinates, bounding, overlay }) => {
    if (coordinates.length < 2) return []
    registerAreaFigure()

    const extendData = overlay.extendData
    if (!extendData) return []
    const y1 = clamp(
      coordinates[0].y,
      S.height / 2,
      bounding.height - S.height / 2,
    )
    const y2 = clamp(
      coordinates[1].y,
      S.height / 2,
      bounding.height - S.height / 2,
    )

    const attrs: TPSLAreaAttrs = {
      x: 0,
      y1,
      y2,
      width: bounding.width,
      isDragging: extendData.isDragging,
      isLoss: extendData.isLoss,
    }

    return [
      {
        key: 'area',
        type: TPSL_AREA_FIGURE,
        attrs,
        ignoreEvent: true,
      },
    ]
  },
}
