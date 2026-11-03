import type { OverlayTemplate } from 'klinecharts'
import { getThemeBg2Color } from '../../shared/colors'
import { TPSL_OVERLAY_STYLES, TPSL_POSITION_LABEL_FIGURE } from '../constants'
import {
  registerPositionLabelFigure,
  type TPSLPositionLabelAttrs,
} from '../figures/index'
import { TPSL_TEMPLATE_NAMES } from '../idFactory'
import { clamp } from '../utils'

const S = TPSL_OVERLAY_STYLES

export interface PositionLabelExtendData {
  text: string
  isLoss: boolean
  offsetX: number
}

export const positionLabelTemplate: OverlayTemplate<PositionLabelExtendData> = {
  name: TPSL_TEMPLATE_NAMES.positionLabel,
  fixedZLevel: true,
  totalStep: 1,
  needDefaultPointFigure: false,
  needDefaultXAxisFigure: false,
  needDefaultYAxisFigure: false,
  createPointFigures: ({ coordinates, bounding, overlay }) => {
    if (coordinates.length === 0) return []
    registerPositionLabelFigure()

    const extendData = overlay.extendData
    if (!extendData) return []
    const { text, isLoss, offsetX } = extendData
    const mainY = clamp(
      coordinates[0].y,
      S.height / 2,
      bounding.height - S.height / 2,
    )
    const color = isLoss ? S.colors.loss.primary : S.colors.profit.primary

    const attrs: TPSLPositionLabelAttrs = {
      x: offsetX,
      y: mainY,
      text,
      bgColor: getThemeBg2Color(),
      textColor: color,
      borderColor: color,
      isHovered: false,
    }

    return [
      {
        key: 'positionLabel',
        type: TPSL_POSITION_LABEL_FIGURE,
        attrs,
        ignoreEvent: true,
      },
    ]
  },
}
