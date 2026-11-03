import type { OverlayFigure, OverlayTemplate } from 'klinecharts'
import { getThemeBg2Color } from '../../shared/colors'
import {
  TPSL_ESTIMATE_LINE_FIGURE,
  TPSL_OVERLAY_STYLES,
  TPSL_Z_LEVELS,
} from '../constants'
import {
  registerEstimateLineFigure,
  type TPSLEstimateLineAttrs,
} from '../figures/index'
import { avoidYAxisLabelOverlapWithCurrentPrice } from '../helpers/avoidYAxisLabelOverlap'
import {
  cancelTpslDrag,
  clampOverlayY,
  restoreChartNavigation,
  setDragPresentation,
  suspendChartNavigation,
  upsertTpslArea,
} from '../helpers/drag'
import {
  ESTIMATE_LEFT_OFFSET,
  SEGMENT_BORDER_OVERLAP,
  TEXT_SAFE_RIGHT_PADDING,
} from '../helpers/overlayConstants'
import {
  getTpslConnectorId,
  getTpslDragAreaId,
  TPSL_TEMPLATE_NAMES,
} from '../idFactory'
import {
  type TPSLDirection,
  type TPSLEstimateType,
  TpslEstimateType,
} from '../types'
import { determineEstimateType } from '../utils'

const S = TPSL_OVERLAY_STYLES
const CLOSE_HIT_BUFFER = 4
const CLOSE_CENTER_Y = 0

export interface EstimateLineExtendData {
  estimateText: string
  estimateType: TpslEstimateType
  baseId: string
  direction: TPSLDirection
  mainValue: number
  /** 标签左偏移量（对齐 tpslButton 位置） */
  labelOffsetX?: number
  /** 强平价格上下文；当前模板不据此拦截拖拽，提交校验需由业务层负责。 */
  reducePrice?: number | null
  onFirstDragEnd?: (data: {
    direction: TPSLDirection
    mainValue: number
    estimateValue: number
    estimateType: TPSLEstimateType
  }) => void
  onEstimateDragEnd?: (data: {
    direction: TPSLDirection
    mainValue: number
    estimateValue: number
    estimateType: TPSLEstimateType
    originalEstimateType?: TPSLEstimateType
  }) => void
  /** 点击已有线时触发（弹出编辑弹窗） */
  onOpenTpslModal?: () => void
  onDragging?: (data: {
    direction: TPSLDirection
    currentValue: number
    estimateType: TPSLEstimateType
    isFirstDrag: boolean
  }) => void
  onEstimateClose?: (data: {
    direction: TPSLDirection
    mainValue: number
    estimateValue: number
    estimateType: TPSLEstimateType
  }) => void
  getEstimateText?: (
    currentValue: number,
    estimateType: TpslEstimateType,
  ) => string
  _isTemporary?: boolean
  _mainValueSnapshot?: number | null
  _estimateValueSnapshot?: number | null
  _originalEstimateType?: TpslEstimateType | null
  _isDragging?: boolean
  _hasMoved?: boolean
}

/**
 * 获取 overlay 在 pane 中经过 clamp 后的 y 坐标
 * 与 createPointFigures 中的 clamp 逻辑保持一致
 */
const getClampedOverlayY = (
  chart: Parameters<NonNullable<OverlayTemplate['onClick']>>[0]['chart'],
  overlay: Pick<
    Parameters<NonNullable<OverlayTemplate['onClick']>>[0]['overlay'],
    'points' | 'paneId'
  >,
): number | undefined => {
  const pixel = chart.convertToPixel(overlay.points, { paneId: overlay.paneId })
  const points = Array.isArray(pixel) ? pixel : [pixel]
  const rawY = points[0]?.y
  if (rawY === undefined) return undefined
  const container = chart.getDom(overlay.paneId, 'main')
  const paneHeight = container?.clientHeight
  if (!paneHeight) return rawY
  return clampOverlayY(rawY, paneHeight)
}

const measureEstimateLabelWidth = (estimateText: string): number => {
  const canvas = document.createElement('canvas')
  const measureCtx = canvas.getContext('2d')
  if (!measureCtx) return S.estimateLine.label.minWidth
  measureCtx.font = `${S.text.fontWeight.regular} ${S.text.fontSize}px ${S.text.fontFamily}`
  return Math.max(
    S.estimateLine.label.minWidth,
    measureCtx.measureText(estimateText).width +
      S.estimateLine.label.paddingX * 2 +
      TEXT_SAFE_RIGHT_PADDING,
  )
}

const isCloseButtonHit = (
  x: number,
  y: number,
  estimateText: string,
  labelOffset?: number,
): boolean => {
  const closeSize = S.mainLine.closeButton.size
  const closePadding = S.mainLine.closeButton.padding
  const closeWidth = closeSize + closePadding * 2
  const halfHeight = S.height / 2
  const estimateWidth = measureEstimateLabelWidth(estimateText)
  const closeX =
    (labelOffset ?? ESTIMATE_LEFT_OFFSET) +
    estimateWidth -
    SEGMENT_BORDER_OVERLAP

  return (
    x >= closeX - CLOSE_HIT_BUFFER &&
    x <= closeX + closeWidth + CLOSE_HIT_BUFFER &&
    y >= CLOSE_CENTER_Y - halfHeight - CLOSE_HIT_BUFFER &&
    y <= CLOSE_CENTER_Y + halfHeight + CLOSE_HIT_BUFFER
  )
}

/**
 * 预估线的几何、命中与拖拽事件；业务快照由 manager 同步，拖拽期间由本模板暂时接管位置。
 */
export const estimateLineTemplate: OverlayTemplate<EstimateLineExtendData> = {
  name: TPSL_TEMPLATE_NAMES.estimateLine,
  fixedZLevel: true,
  totalStep: 1,
  needDefaultPointFigure: false,
  needDefaultXAxisFigure: false,
  needDefaultYAxisFigure: false,

  createYAxisFigures: ({ coordinates, bounding, overlay, chart, yAxis }) => {
    if (coordinates.length === 0) return []
    const extendData = overlay.extendData
    if (!extendData) return []

    const priceValue = overlay.points[0]?.value
    if (typeof priceValue !== 'number') return []

    const isLoss = extendData.estimateType === TpslEstimateType.StopLoss
    const color = isLoss ? S.colors.loss.primary : S.colors.profit.primary

    const precision = chart.getSymbol()?.pricePrecision ?? 2
    const priceText = chart
      .getDecimalFold()
      .format(
        chart.getThousandsSeparator().format(priceValue.toFixed(precision)),
      )
    const estimateY = yAxis?.convertToPixel(priceValue) ?? coordinates[0].y
    const clampedY = clampOverlayY(estimateY, bounding.height)
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
    registerEstimateLineFigure()

    const extendData = overlay.extendData
    if (!extendData) return []
    const { estimateText, estimateType } = extendData
    const estimateY = clampOverlayY(coordinates[0].y, bounding.height)
    const isLoss = estimateType === TpslEstimateType.StopLoss

    const attrs: TPSLEstimateLineAttrs = {
      x: 0,
      y: estimateY,
      width: bounding.width,
      estimateText,
      priceText: '',
      isLoss,
      estimateType,
      labelOffsetX: extendData.labelOffsetX,
    }

    return [
      {
        key: 'estimateLine',
        type: TPSL_ESTIMATE_LINE_FIGURE,
        attrs,
      },
    ]
  },

  onRemoved: ({ chart, overlay }) => {
    if (!overlay.extendData?._isDragging) return
    // 引擎可能仍持有 pressed overlay，后到的 mouseup 不能提交已取消的拖拽。
    overlay.extendData._isDragging = false
    cancelTpslDrag(chart)
  },
  onPressedMoveStart: (event) => {
    const { overlay, chart } = event
    if (!overlay.extendData) return

    const extendData = overlay.extendData
    if (!extendData.onFirstDragEnd && !extendData.onEstimateDragEnd) return
    if (typeof event.x === 'number' && typeof event.y === 'number') {
      const clampedY = getClampedOverlayY(chart, overlay)
      if (clampedY !== undefined) {
        const localX = event.x
        const localY = event.y - clampedY
        if (
          isCloseButtonHit(
            localX,
            localY,
            extendData.estimateText,
            extendData.labelOffsetX,
          )
        ) {
          return
        }
      }
    }

    const mainValue = extendData.mainValue
    const areaId = getTpslDragAreaId(extendData.baseId, extendData.estimateType)
    const currentValue = overlay.points[0]?.value ?? mainValue

    const areaExtendData = {
      isDragging: true,
      isLoss: extendData.estimateType === TpslEstimateType.StopLoss,
    }

    upsertTpslArea(chart, {
      id: areaId,
      groupId: overlay.groupId,
      paneId: overlay.paneId,
      zLevel: TPSL_Z_LEVELS.background,
      points: [
        { timestamp: 0, value: mainValue },
        { timestamp: 0, value: currentValue },
      ],
      extendData: areaExtendData,
    })

    // 原类型随拖拽快照保存；跨越开仓价后，业务层需要同时知道旧侧和新侧。
    chart.overrideOverlay({
      id: overlay.id,
      extendData: {
        ...extendData,
        _mainValueSnapshot: mainValue,
        _estimateValueSnapshot: currentValue,
        _originalEstimateType: extendData.estimateType,
        _isDragging: true,
        _hasMoved: false,
      },
    })

    suspendChartNavigation(chart)
    setDragPresentation(chart, overlay.paneId, true)
  },

  onPressedMoving: (event) => {
    const { overlay, chart } = event
    if (!overlay.extendData) return

    const extendData = overlay.extendData
    if (!extendData._isDragging) return

    if (!extendData._hasMoved) {
      chart.overrideOverlay({
        id: overlay.id,
        extendData: { ...extendData, _hasMoved: true },
      })
    }

    if (event.x !== undefined && event.y !== undefined) {
      const result = chart.convertFromPixel([{ x: event.x, y: event.y }], {
        paneId: overlay.paneId,
      })
      const points = Array.isArray(result) ? result : [result]
      const currentValue = points[0]?.value
      if (currentValue === undefined) return

      const mainValue = extendData._mainValueSnapshot ?? extendData.mainValue
      const prevEstimateType = extendData.estimateType
      const nextEstimateType = determineEstimateType(
        extendData.direction,
        mainValue,
        currentValue,
      )

      if (prevEstimateType !== nextEstimateType) {
        const oldAreaId = getTpslDragAreaId(extendData.baseId, prevEstimateType)
        chart.removeOverlay({ id: oldAreaId })
      }

      const areaId = getTpslDragAreaId(extendData.baseId, nextEstimateType)
      const areaPoints = [
        { timestamp: 0, value: mainValue },
        { timestamp: 0, value: currentValue },
      ]
      const areaExtendData = {
        isDragging: true,
        isLoss: nextEstimateType === TpslEstimateType.StopLoss,
      }

      upsertTpslArea(chart, {
        id: areaId,
        groupId: overlay.groupId,
        paneId: overlay.paneId,
        zLevel: TPSL_Z_LEVELS.background,
        points: areaPoints,
        extendData: areaExtendData,
      })

      const dynamicText = extendData.getEstimateText
        ? extendData.getEstimateText(currentValue, nextEstimateType)
        : extendData.estimateText

      chart.overrideOverlay({
        id: overlay.id,
        points: [{ timestamp: 0, value: currentValue }],
        extendData: {
          ...extendData,
          estimateText: dynamicText,
          estimateType: nextEstimateType,
        },
      })

      extendData.onDragging?.({
        direction: extendData.direction,
        currentValue,
        estimateType: nextEstimateType,
        isFirstDrag: false,
      })
    }
  },

  onPressedMoveEnd: (event) => {
    const { overlay, chart } = event
    if (!overlay.extendData) return

    const extendData = overlay.extendData
    // dispose 可能先清空图形且不触发 onRemoved，迟到的松手不能交付交易回调。
    if (
      !extendData._isDragging ||
      chart.getOverlays({ id: overlay.id }).length === 0
    )
      return

    const mainValue = extendData._mainValueSnapshot ?? extendData.mainValue
    const estimateValue = overlay.points[0]?.value
    const currentEstimateType = extendData.estimateType
    const originalEstimateType =
      extendData._originalEstimateType ?? currentEstimateType
    const typeChanged = currentEstimateType !== originalEstimateType

    const currentAreaId = getTpslDragAreaId(
      extendData.baseId,
      currentEstimateType,
    )
    const originalAreaId = getTpslDragAreaId(
      extendData.baseId,
      originalEstimateType,
    )

    if (estimateValue !== undefined) {
      if (typeChanged) {
        chart.removeOverlay({ id: originalAreaId })

        const areaIsLoss = currentEstimateType === TpslEstimateType.StopLoss

        const areaExtendData = { isDragging: false, isLoss: areaIsLoss }
        upsertTpslArea(chart, {
          id: currentAreaId,
          groupId: overlay.groupId,
          paneId: overlay.paneId,
          zLevel: TPSL_Z_LEVELS.background,
          points: [
            { timestamp: 0, value: mainValue },
            { timestamp: 0, value: estimateValue },
          ],
          extendData: areaExtendData,
        })

        extendData.onEstimateDragEnd?.({
          direction: extendData.direction,
          mainValue,
          estimateValue,
          estimateType: currentEstimateType,
          originalEstimateType,
        })
      } else {
        const areaIsLoss = currentEstimateType === TpslEstimateType.StopLoss

        const areaExtendData = { isDragging: false, isLoss: areaIsLoss }
        upsertTpslArea(chart, {
          id: currentAreaId,
          groupId: overlay.groupId,
          paneId: overlay.paneId,
          zLevel: TPSL_Z_LEVELS.background,
          points: [
            { timestamp: 0, value: mainValue },
            { timestamp: 0, value: estimateValue },
          ],
          extendData: areaExtendData,
        })

        if (
          !extendData._hasMoved &&
          !extendData._isTemporary &&
          extendData.onOpenTpslModal
        ) {
          const clampedY = getClampedOverlayY(chart, overlay)
          const tapOnClose =
            typeof event.x === 'number' &&
            typeof event.y === 'number' &&
            clampedY !== undefined &&
            isCloseButtonHit(
              event.x,
              event.y - clampedY,
              extendData.estimateText,
              extendData.labelOffsetX,
            )
          if (!tapOnClose) {
            extendData.onOpenTpslModal()
          }
        } else {
          extendData.onEstimateDragEnd?.({
            direction: extendData.direction,
            mainValue,
            estimateValue,
            estimateType: currentEstimateType,
          })
        }
      }
    } else if (extendData._hasMoved) {
      chart.removeOverlay({ id: currentAreaId })
      if (typeChanged) {
        chart.removeOverlay({ id: originalAreaId })
      }

      const originalValue = extendData._estimateValueSnapshot
      if (originalValue != null) {
        const origAreaIsLoss =
          originalEstimateType === TpslEstimateType.StopLoss
        chart.overrideOverlay({
          id: overlay.id,
          points: [{ timestamp: 0, value: originalValue }],
          extendData: {
            ...extendData,
            estimateType: originalEstimateType,
            estimateText: extendData.getEstimateText
              ? extendData.getEstimateText(originalValue, originalEstimateType)
              : extendData.estimateText,
          },
        })
        const origAreaExist = chart.getOverlays({ id: originalAreaId })
        if (origAreaExist.length > 0) {
          chart.overrideOverlay({
            id: originalAreaId,
            points: [
              { timestamp: 0, value: mainValue },
              { timestamp: 0, value: originalValue },
            ],
            extendData: { isDragging: false, isLoss: origAreaIsLoss },
          })
        }
      }
    }

    chart.overrideOverlay({
      id: overlay.id,
      zLevel: TPSL_Z_LEVELS.action,
      extendData: {
        ...extendData,
        // 保留拖拽后的方向，让后续关闭/编辑作用于当前可见的止盈或止损线。
        estimateType: currentEstimateType,
        _isDragging: false,
        _hasMoved: false,
        _mainValueSnapshot: null,
        _estimateValueSnapshot: null,
        _originalEstimateType: null,
      },
    })

    restoreChartNavigation(chart)
    setDragPresentation(chart, overlay.paneId, false)
  },

  onMouseEnter: (event) => {
    const { overlay, chart } = event
    const extendData = overlay.extendData
    if (!extendData?.baseId) return

    chart.overrideOverlay({ id: overlay.id, zLevel: TPSL_Z_LEVELS.tooltip })

    const tpConnectorId = getTpslConnectorId(
      extendData.baseId,
      TpslEstimateType.TakeProfit,
    )
    const slConnectorId = getTpslConnectorId(
      extendData.baseId,
      TpslEstimateType.StopLoss,
    )
    if (chart.getOverlays({ id: tpConnectorId }).length > 0) {
      chart.overrideOverlay({ id: tpConnectorId, visible: true })
    }
    if (chart.getOverlays({ id: slConnectorId }).length > 0) {
      chart.overrideOverlay({ id: slConnectorId, visible: true })
    }
  },

  onMouseLeave: (event) => {
    const { overlay, chart } = event
    const extendData = overlay.extendData
    if (!extendData?.baseId) return

    if (extendData._isDragging) return

    chart.overrideOverlay({ id: overlay.id, zLevel: TPSL_Z_LEVELS.action })

    const tpConnectorId = getTpslConnectorId(
      extendData.baseId,
      TpslEstimateType.TakeProfit,
    )
    const slConnectorId = getTpslConnectorId(
      extendData.baseId,
      TpslEstimateType.StopLoss,
    )
    if (chart.getOverlays({ id: tpConnectorId }).length > 0) {
      chart.overrideOverlay({ id: tpConnectorId, visible: false })
    }
    if (chart.getOverlays({ id: slConnectorId }).length > 0) {
      chart.overrideOverlay({ id: slConnectorId, visible: false })
    }
  },

  onClick: (event) => {
    const { overlay, chart } = event
    const extendData = overlay.extendData
    if (!extendData || extendData._isDragging) return
    if (typeof event.x !== 'number' || typeof event.y !== 'number') return

    const clampedY = getClampedOverlayY(chart, overlay)
    if (clampedY === undefined) return

    const localX = event.x
    const localY = event.y - clampedY
    if (
      !isCloseButtonHit(
        localX,
        localY,
        extendData.estimateText,
        extendData.labelOffsetX,
      )
    )
      return

    const estimateValue = overlay.points[0]?.value
    if (estimateValue === undefined) return

    extendData.onEstimateClose?.({
      direction: extendData.direction,
      mainValue: extendData.mainValue,
      estimateValue,
      estimateType: extendData.estimateType,
    })
  },
}
