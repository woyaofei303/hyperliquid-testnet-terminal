import type { OverlayTemplate } from 'klinecharts'
import { TPSL_OVERLAY_STYLES, TPSL_PROFIT_LABEL_FIGURE } from '../constants'
import {
  registerProfitLabelFigure,
  type TPSLProfitLabelAttrs,
} from '../figures/index'
import { TPSL_TEMPLATE_NAMES } from '../idFactory'
import { clamp } from '../utils'

const S = TPSL_OVERLAY_STYLES

export interface ProfitLabelExtendData {
  text: string
  isLoss: boolean
  offsetX?: number
}

export const profitLabelTemplate: OverlayTemplate<ProfitLabelExtendData> = {
  name: TPSL_TEMPLATE_NAMES.profitLabel,
  fixedZLevel: true,
  totalStep: 1,
  needDefaultPointFigure: false,
  needDefaultXAxisFigure: false,
  needDefaultYAxisFigure: false,
  createPointFigures: ({ coordinates, bounding, overlay }) => {
    if (coordinates.length === 0) return []
    registerProfitLabelFigure()

    const extendData = overlay.extendData
    if (!extendData) return []
    const { text, isLoss, offsetX = 0 } = extendData
    const mainY = clamp(
      coordinates[0].y,
      S.height / 2,
      bounding.height - S.height / 2,
    )
    const color = isLoss ? S.colors.loss.primary : S.colors.profit.primary

    const attrs: TPSLProfitLabelAttrs = {
      x: offsetX,
      y: mainY,
      text,
      bgColor: color,
      textColor: S.colors.text,
      isHovered: false,
    }

    return [
      {
        key: 'profitLabel',
        type: TPSL_PROFIT_LABEL_FIGURE,
        attrs,
        ignoreEvent: true,
      },
    ]
  },
}
