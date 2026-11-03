import type { OverlayTemplate } from 'klinecharts'
import { getThemeBg2Color } from '../../shared/colors'
import { TPSL_OVERLAY_STYLES, TPSL_PRICE_LABEL_FIGURE } from '../constants'
import {
  registerPriceLabelFigure,
  type TPSLPriceLabelAttrs,
} from '../figures/index'
import { TPSL_TEMPLATE_NAMES } from '../idFactory'
import { clamp } from '../utils'

const S = TPSL_OVERLAY_STYLES

export interface PriceLabelExtendData {
  text: string
  isLoss: boolean
  /** 限价标签宽度（用于定位） */
  offsetX: number
}

export const priceLabelTemplate: OverlayTemplate<PriceLabelExtendData> = {
  name: TPSL_TEMPLATE_NAMES.priceLabel,
  fixedZLevel: true,
  totalStep: 1,
  needDefaultPointFigure: false,
  needDefaultXAxisFigure: false,
  needDefaultYAxisFigure: false,
  createPointFigures: ({ coordinates, bounding, overlay }) => {
    if (coordinates.length === 0) return []
    registerPriceLabelFigure()

    const extendData = overlay.extendData
    if (!extendData) return []
    const { text, isLoss, offsetX } = extendData
    const mainY = clamp(
      coordinates[0].y,
      S.height / 2,
      bounding.height - S.height / 2,
    )
    const color = isLoss ? S.colors.loss.primary : S.colors.profit.primary

    const attrs: TPSLPriceLabelAttrs = {
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
        key: 'priceLabel',
        type: TPSL_PRICE_LABEL_FIGURE,
        attrs,
        ignoreEvent: true,
      },
    ]
  },
}
