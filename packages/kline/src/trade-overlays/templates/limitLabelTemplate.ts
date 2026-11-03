import type { OverlayTemplate } from 'klinecharts'
import { TPSL_LIMIT_LABEL_FIGURE, TPSL_OVERLAY_STYLES } from '../constants'
import {
  registerLimitLabelFigure,
  type TPSLLimitLabelAttrs,
} from '../figures/index'
import { TPSL_TEMPLATE_NAMES } from '../idFactory'
import { clamp } from '../utils'

const S = TPSL_OVERLAY_STYLES

export interface LimitLabelExtendData {
  /** 限价文本 */
  text: string
  /** 是否亏损（控制颜色） */
  isLoss: boolean
  /** X 偏移量 */
  offsetX?: number
}

/**
 * 限价标签 Overlay Template
 * 显示委托单的限价标签
 */
export const limitLabelTemplate: OverlayTemplate<LimitLabelExtendData> = {
  name: TPSL_TEMPLATE_NAMES.limitLabel,
  fixedZLevel: true,
  totalStep: 1,
  needDefaultPointFigure: false,
  needDefaultXAxisFigure: false,
  needDefaultYAxisFigure: false,
  createPointFigures: ({ coordinates, bounding, overlay }) => {
    if (coordinates.length === 0) return []

    registerLimitLabelFigure()

    const extendData = overlay.extendData
    if (!extendData) return []
    const { text, isLoss, offsetX = 0 } = extendData

    const mainY = clamp(
      coordinates[0].y,
      S.height / 2,
      bounding.height - S.height / 2,
    )
    const color = isLoss ? S.colors.loss.primary : S.colors.profit.primary

    const attrs: TPSLLimitLabelAttrs = {
      x: offsetX,
      y: mainY,
      text,
      bgColor: color,
      textColor: S.colors.text,
      isHovered: false,
    }

    return [
      {
        key: 'limitLabel',
        type: TPSL_LIMIT_LABEL_FIGURE,
        attrs,
        ignoreEvent: true,
      },
    ]
  },
}
