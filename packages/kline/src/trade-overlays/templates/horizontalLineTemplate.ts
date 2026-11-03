import type { OverlayFigure, OverlayTemplate } from 'klinecharts'
import { getThemeBg2Color } from '../../shared/colors'
import { TPSL_HORIZONTAL_LINE_FIGURE, TPSL_OVERLAY_STYLES } from '../constants'
import {
  registerHorizontalLineFigure,
  type TPSLHorizontalLineAttrs,
} from '../figures/index'
import { avoidYAxisLabelOverlapWithCurrentPrice } from '../helpers/avoidYAxisLabelOverlap'
import { TPSL_TEMPLATE_NAMES } from '../idFactory'
import { clamp } from '../utils'

const S = TPSL_OVERLAY_STYLES

export interface HorizontalLineExtendData {
  /** 是否亏损（控制颜色） */
  isLoss: boolean
  /** 起始 X 坐标（用于绘制部分实线） */
  startX?: number
  /** 宽度（用于绘制部分实线） */
  width?: number
  /** 是否为虚线（默认 false，实线） */
  dashed?: boolean
  /** 是否显示 Y 轴价格标签 */
  showYAxisLabel?: boolean
}

/**
 * 水平线 Overlay Template
 * 显示主线的水平实线或虚线
 */
export const horizontalLineTemplate: OverlayTemplate<HorizontalLineExtendData> =
  {
    name: TPSL_TEMPLATE_NAMES.horizontalLine,
    fixedZLevel: true,
    totalStep: 1,
    needDefaultPointFigure: false,
    needDefaultXAxisFigure: false,
    needDefaultYAxisFigure: false,

    createYAxisFigures: ({ coordinates, bounding, overlay, chart, yAxis }) => {
      if (coordinates.length === 0) return []
      const extendData = overlay.extendData
      if (!extendData?.showYAxisLabel) return []

      const priceValue = overlay.points[0]?.value
      if (typeof priceValue !== 'number') return []

      const color = extendData.isLoss
        ? S.colors.loss.primary
        : S.colors.profit.primary
      const precision = chart.getSymbol()?.pricePrecision ?? 2
      const priceText = chart
        .getDecimalFold()
        .format(
          chart.getThousandsSeparator().format(priceValue.toFixed(precision)),
        )
      const rawY = yAxis?.convertToPixel(priceValue) ?? coordinates[0].y
      const clampedY = clamp(rawY, S.height / 2, bounding.height - S.height / 2)
      const adjustedY = avoidYAxisLabelOverlapWithCurrentPrice({
        chart,
        yAxis,
        labelY: clampedY,
        labelValue: priceValue,
        labelHeight: S.height,
        boundingHeight: bounding.height,
      })

      const figures: OverlayFigure[] = [
        {
          type: 'text',
          attrs: {
            x: 0,
            y: adjustedY,
            text: priceText,
            baseline: 'middle',
            align: 'left',
          },
          styles: {
            style: 'stroke_fill',
            color,
            backgroundColor: getThemeBg2Color(),
            borderColor: color,
            borderSize: 1,
            borderRadius: S.borderRadius,
            size: S.text.fontSize,
            family: S.text.fontFamily,
            weight: `${S.text.fontWeight.regular}`,
            paddingLeft: S.padding.x,
            paddingRight: S.padding.x,
            paddingTop: S.padding.y,
            paddingBottom: S.padding.y,
          },
          ignoreEvent: true,
        },
      ]
      return figures
    },

    createPointFigures: ({ coordinates, bounding, overlay }) => {
      if (coordinates.length === 0) return []

      registerHorizontalLineFigure()

      const extendData = overlay.extendData
      if (!extendData) return []
      const { isLoss, startX = 0, width, dashed = false } = extendData

      const mainY = clamp(
        coordinates[0].y,
        S.height / 2,
        bounding.height - S.height / 2,
      )
      const color = isLoss ? S.colors.loss.primary : S.colors.profit.primary

      const attrs: TPSLHorizontalLineAttrs = {
        x: startX,
        y: mainY,
        width: width ?? bounding.width,
        color,
        dashed,
      }

      return [
        {
          key: 'horizontalLine',
          type: TPSL_HORIZONTAL_LINE_FIGURE,
          attrs,
          ignoreEvent: true,
        },
      ]
    },
  }
