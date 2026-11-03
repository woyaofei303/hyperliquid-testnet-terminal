import type { OverlayTemplate } from 'klinecharts'
import {
  TPSL_OVERLAY_STYLES,
  TPSL_VERTICAL_CONNECTOR_FIGURE,
} from '../constants'
import {
  registerVerticalConnectorFigure,
  type TPSLVerticalConnectorAttrs,
} from '../figures/index'
import { TPSL_TEMPLATE_NAMES } from '../idFactory'
import { clamp } from '../utils'

const S = TPSL_OVERLAY_STYLES
const RIGHT_MARGIN = 60

export interface VerticalConnectorExtendData {
  /** 垂线颜色（多空方向色） */
  lineColor: string
  /** 主线端圆圈颜色 */
  mainCircleColor: string
  /** 预估线端圆圈颜色 */
  estimateCircleColor: string
}

/**
 * 垂线连接器 Overlay Template
 * points[0] = 主线价格, points[1] = 预估线价格
 * 两个 coordinates 由 klinecharts 自动转换为像素坐标
 * X 位置固定在右侧距 Y 轴 60px
 */
export const verticalConnectorTemplate: OverlayTemplate<VerticalConnectorExtendData> =
  {
    name: TPSL_TEMPLATE_NAMES.verticalConnector,
    fixedZLevel: true,
    totalStep: 1,
    needDefaultPointFigure: false,
    needDefaultXAxisFigure: false,
    needDefaultYAxisFigure: false,

    createPointFigures: ({ coordinates, bounding, overlay }) => {
      if (coordinates.length < 2) return []
      registerVerticalConnectorFigure()

      const extendData = overlay.extendData
      if (!extendData) return []

      const { lineColor, mainCircleColor, estimateCircleColor } = extendData

      const mainY = clamp(
        coordinates[0].y,
        S.height / 2,
        bounding.height - S.height / 2,
      )
      const estimateY = clamp(
        coordinates[1].y,
        S.height / 2,
        bounding.height - S.height / 2,
      )
      const connectorX = bounding.width - RIGHT_MARGIN

      const attrs: TPSLVerticalConnectorAttrs = {
        x: connectorX,
        mainY,
        estimateY,
        lineColor,
        mainCircleColor,
        estimateCircleColor,
      }

      return [
        {
          key: 'verticalConnector',
          type: TPSL_VERTICAL_CONNECTOR_FIGURE,
          attrs,
          ignoreEvent: true,
        },
      ]
    },
  }
