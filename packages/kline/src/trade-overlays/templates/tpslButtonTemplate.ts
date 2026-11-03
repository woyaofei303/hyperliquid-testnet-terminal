import type { OverlayTemplate } from 'klinecharts'
import {
  getThemeBg2Color,
  getThemeBgGColor,
  getThemeBgRColor,
} from '../../shared/colors'
import {
  TPSL_OVERLAY_STYLES,
  TPSL_TPSL_BUTTON_FIGURE,
  TPSL_Z_LEVEL,
  TPSL_Z_LEVELS,
} from '../constants'
import {
  registerTpslButtonFigure,
  type TPSLTpslButtonAttrs,
} from '../figures/index'
import {
  cancelTpslDrag,
  clampOverlayY,
  restoreChartNavigation,
  setDragPresentation,
  suspendChartNavigation,
  upsertTpslArea,
} from '../helpers/drag'
import {
  getTpslDragAreaId,
  getTpslLineId,
  getTpslOverlayId,
  TPSL_TEMPLATE_NAMES,
} from '../idFactory'
import {
  type TPSLDirection,
  type TPSLEstimateType,
  TpslEstimateType,
} from '../types'
import { determineEstimateType } from '../utils'

const S = TPSL_OVERLAY_STYLES

export interface TpslButtonExtendData {
  offsetX: number
  isLoss: boolean
  baseId: string
  direction: TPSLDirection
  mainValue: number
  /** 强平价格上下文；当前模板不据此拦截拖拽，提交校验需由业务层负责。 */
  reducePrice?: number | null
  /** 按钮显示文案（如 "止盈"、"止损"、"止盈止损"） */
  buttonText?: string
  /** 是否已有止盈 */
  hasTakeProfit?: boolean
  /** 是否已有止损 */
  hasStopLoss?: boolean
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
  }) => void
  onEstimateClose?: (data: {
    direction: TPSLDirection
    mainValue: number
    estimateValue: number
    estimateType: TPSLEstimateType
  }) => void
  /** 拖拽到已有单子区域时触发（弹出编辑弹窗） */
  onOpenTpslModal?: () => void
  onDragging?: (data: {
    direction: TPSLDirection
    currentValue: number
    estimateType: TPSLEstimateType
    isFirstDrag: boolean
  }) => void
  takeProfitText?: string
  stopLossText?: string
  /** 预估收益默认文本（i18n） */
  estimatedProfitFallback?: string
  /** 预估亏损默认文本（i18n） */
  estimatedLossFallback?: string
  getEstimateText?: (
    currentValue: number,
    estimateType: TpslEstimateType,
  ) => string
  _hoverBgColor?: string
  _isHovered?: boolean
  _mainValueSnapshot?: number | null
  _activeEstimateType?: TPSLEstimateType
  _hadTakeProfitBeforeDrag?: boolean
  _hadStopLossBeforeDrag?: boolean
  _tpValueSnapshot?: number | null
  _slValueSnapshot?: number | null
  _isDragging?: boolean
  _hasMoved?: boolean
}

/**
 * 止盈止损按钮 Overlay Template
 */
export const tpslButtonTemplate: OverlayTemplate<TpslButtonExtendData> = {
  name: TPSL_TEMPLATE_NAMES.tpslButton,
  fixedZLevel: true,
  totalStep: 1,
  needDefaultPointFigure: false,
  needDefaultXAxisFigure: false,
  needDefaultYAxisFigure: false,

  createPointFigures: ({ coordinates, bounding, overlay }) => {
    if (coordinates.length === 0) return []
    registerTpslButtonFigure()

    const extendData = overlay.extendData
    if (!extendData) return []
    const {
      offsetX,
      isLoss,
      _hoverBgColor,
      _isHovered = false,
      buttonText,
    } = extendData
    const mainY = clampOverlayY(coordinates[0].y, bounding.height)

    const color = isLoss ? S.colors.loss.primary : S.colors.profit.primary
    const bgColor = _hoverBgColor || getThemeBg2Color()

    const attrs: TPSLTpslButtonAttrs = {
      x: offsetX,
      y: mainY,
      bgColor,
      textColor: color,
      borderColor: color,
      handleColor: color,
      isHovered: _isHovered,
      buttonText,
    }

    return [
      {
        key: 'tpslButton',
        type: TPSL_TPSL_BUTTON_FIGURE,
        attrs,
        ignoreEvent: false,
      },
    ]
  },

  onMouseEnter: (event) => {
    const { overlay, chart } = event
    if (!overlay.extendData || !overlay.id) return

    const extendData = overlay.extendData
    const { isLoss } = extendData
    const hoverBgColor = isLoss ? getThemeBgRColor() : getThemeBgGColor()

    chart.overrideOverlay({
      id: overlay.id,
      zLevel: TPSL_Z_LEVELS.tooltip,
      extendData: {
        ...extendData,
        _hoverBgColor: hoverBgColor,
        _isHovered: true,
      },
    })

    const container = chart.getDom(overlay.paneId, 'root')
    if (container) {
      container.style.cursor = 'grab'
    }
  },

  onMouseLeave: (event) => {
    const { overlay, chart } = event
    if (!overlay.extendData || !overlay.id) return

    const extendData = overlay.extendData

    chart.overrideOverlay({
      id: overlay.id,
      zLevel: TPSL_Z_LEVELS.action,
      extendData: {
        ...extendData,
        _hoverBgColor: undefined,
        _isHovered: false,
      },
    })

    const container = chart.getDom(overlay.paneId, 'root')
    if (container) {
      container.style.cursor = 'crosshair'
    }
  },

  onRemoved: ({ chart, overlay }) => {
    if (!overlay.extendData?._isDragging) return
    overlay.extendData._isDragging = false
    cancelTpslDrag(chart)
  },
  onPressedMoveStart: (event) => {
    const { overlay, chart } = event
    if (!overlay.extendData) return

    const extendData = overlay.extendData
    if (!extendData.onFirstDragEnd && !extendData.onEstimateDragEnd) return
    const mainValue = overlay.points[0]?.value ?? extendData.mainValue

    // 保存两侧原价；跨过主线换方向时，新草稿可删除，已有线则要恢复。
    const tpOverlay = chart.getOverlays({
      id: getTpslOverlayId(extendData.baseId, 'tpLine'),
    })
    const slOverlay = chart.getOverlays({
      id: getTpslOverlayId(extendData.baseId, 'slLine'),
    })

    const tpValue = tpOverlay[0]?.points?.[0]?.value ?? null
    const slValue = slOverlay[0]?.points?.[0]?.value ?? null

    suspendChartNavigation(chart)

    chart.overrideOverlay({
      id: overlay.id,
      extendData: {
        ...extendData,
        _mainValueSnapshot: mainValue,
        _activeEstimateType: null,
        _hadTakeProfitBeforeDrag: tpOverlay.length > 0,
        _hadStopLossBeforeDrag: slOverlay.length > 0,
        _tpValueSnapshot: tpValue,
        _slValueSnapshot: slValue,
        _isDragging: true,
        _hasMoved: false,
      },
    })
  },

  onPressedMoving: (event) => {
    const { overlay, chart } = event
    if (!overlay.extendData) return

    const extendData = overlay.extendData
    if (!extendData._isDragging) return

    if (!extendData._hasMoved) {
      chart.overrideOverlay({
        id: overlay.id,
        visible: false,
        extendData: {
          ...extendData,
          _hoverBgColor: undefined,
          _isHovered: false,
          _hasMoved: true,
        },
      })

      setDragPresentation(chart, overlay.paneId, true)
    }

    if (event.x !== undefined && event.y !== undefined) {
      const result = chart.convertFromPixel([{ x: event.x, y: event.y }], {
        paneId: overlay.paneId,
      })
      const points = Array.isArray(result) ? result : [result]
      const currentValue = points[0]?.value
      if (currentValue === undefined) return

      const mainValue = extendData._mainValueSnapshot ?? extendData.mainValue
      const prevActiveType = extendData._activeEstimateType
      const nextEstimateType = determineEstimateType(
        extendData.direction,
        mainValue,
        currentValue,
      )

      if (prevActiveType && prevActiveType !== nextEstimateType) {
        const oldLineId = getTpslLineId(extendData.baseId, prevActiveType)
        const oldAreaId = getTpslDragAreaId(extendData.baseId, prevActiveType)
        const wasFirstCreate =
          prevActiveType === TpslEstimateType.TakeProfit
            ? !extendData._hadTakeProfitBeforeDrag
            : !extendData._hadStopLossBeforeDrag

        chart.removeOverlay({ id: oldAreaId })

        if (wasFirstCreate) {
          chart.removeOverlay({ id: oldLineId })
        } else {
          const snapshotValue =
            prevActiveType === TpslEstimateType.TakeProfit
              ? extendData._tpValueSnapshot
              : extendData._slValueSnapshot
          if (snapshotValue != null) {
            const restoreText = extendData.getEstimateText
              ? extendData.getEstimateText(snapshotValue, prevActiveType)
              : prevActiveType === TpslEstimateType.TakeProfit
                ? extendData.takeProfitText ||
                  extendData.estimatedProfitFallback ||
                  ''
                : extendData.stopLossText ||
                  extendData.estimatedLossFallback ||
                  ''
            chart.overrideOverlay({
              id: oldLineId,
              points: [{ timestamp: 0, value: snapshotValue }],
              extendData: {
                estimateType: prevActiveType,
                estimateText: restoreText,
                _isTemporary: false,
                _isDragging: false,
                labelOffsetX: extendData.offsetX,
                baseId: extendData.baseId,
                direction: extendData.direction,
                mainValue,
                reducePrice: extendData.reducePrice,
                onFirstDragEnd: extendData.onFirstDragEnd,
                onEstimateDragEnd: extendData.onEstimateDragEnd,
                onEstimateClose: extendData.onEstimateClose,
                onDragging: extendData.onDragging,
                onOpenTpslModal: extendData.onOpenTpslModal,
                getEstimateText: extendData.getEstimateText,
              },
            })
          }
        }
      }

      const overlayId = getTpslLineId(extendData.baseId, nextEstimateType)

      const isFirstDrag =
        nextEstimateType === TpslEstimateType.TakeProfit
          ? !extendData._hadTakeProfitBeforeDrag
          : !extendData._hadStopLossBeforeDrag
      const staticText =
        nextEstimateType === TpslEstimateType.TakeProfit
          ? extendData.takeProfitText || extendData.estimatedProfitFallback
          : extendData.stopLossText || extendData.estimatedLossFallback
      const estimateText =
        extendData.getEstimateText && nextEstimateType
          ? extendData.getEstimateText(currentValue, nextEstimateType)
          : staticText

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
        zLevel: TPSL_Z_LEVEL - 1,
        points: areaPoints,
        extendData: areaExtendData,
      })

      const estimateLineCallbacks = {
        baseId: extendData.baseId,
        direction: extendData.direction,
        mainValue,
        reducePrice: extendData.reducePrice,
        onFirstDragEnd: extendData.onFirstDragEnd,
        onEstimateDragEnd: extendData.onEstimateDragEnd,
        onEstimateClose: extendData.onEstimateClose,
        onDragging: extendData.onDragging,
        onOpenTpslModal: extendData.onOpenTpslModal,
        getEstimateText: extendData.getEstimateText,
      }

      const exist = chart.getOverlays({ id: overlayId })
      if (exist.length > 0) {
        const prevExtend = exist[0]?.extendData ?? {}
        chart.overrideOverlay({
          id: overlayId,
          points: [{ timestamp: 0, value: currentValue }],
          extendData: {
            ...prevExtend,
            ...estimateLineCallbacks,
            estimateType: nextEstimateType,
            estimateText: estimateText || '',
            _isTemporary: isFirstDrag,
            labelOffsetX: extendData.offsetX,
          },
        })
      } else {
        chart.createOverlay({
          id: overlayId,
          name: TPSL_TEMPLATE_NAMES.estimateLine,
          groupId: overlay.groupId,
          paneId: overlay.paneId,
          zLevel: TPSL_Z_LEVELS.action,
          points: [{ timestamp: 0, value: currentValue }],
          extendData: {
            ...estimateLineCallbacks,
            estimateType: nextEstimateType,
            estimateText: estimateText || '',
            _isTemporary: isFirstDrag,
            labelOffsetX: extendData.offsetX,
          },
        })
      }

      if (extendData._activeEstimateType !== nextEstimateType) {
        chart.overrideOverlay({
          id: overlay.id,
          extendData: {
            ...extendData,
            _activeEstimateType: nextEstimateType,
            _hasMoved: true,
          },
        })
      }

      extendData.onDragging?.({
        direction: extendData.direction,
        currentValue,
        estimateType: nextEstimateType,
        isFirstDrag,
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

    if (!extendData._hasMoved) {
      restoreChartNavigation(chart)
      chart.overrideOverlay({
        id: overlay.id,
        zLevel: TPSL_Z_LEVELS.action,
        extendData: {
          ...extendData,
          _isDragging: false,
          _hasMoved: false,
          _mainValueSnapshot: null,
          _activeEstimateType: null,
        },
      })
      return
    }

    const mainValue = extendData._mainValueSnapshot ?? extendData.mainValue
    const activeType = extendData._activeEstimateType

    if (activeType) {
      const overlayId = getTpslLineId(extendData.baseId, activeType)
      const overlayItem = chart.getOverlays({ id: overlayId })[0]
      const estimateValue = overlayItem?.points?.[0]?.value

      if (estimateValue !== undefined) {
        const areaId = getTpslDragAreaId(extendData.baseId, activeType)

        const areaExtendData = {
          isDragging: false,
          isLoss: activeType === TpslEstimateType.StopLoss,
        }
        upsertTpslArea(chart, {
          id: areaId,
          groupId: overlay.groupId,
          paneId: overlay.paneId,
          zLevel: TPSL_Z_LEVEL - 1,
          points: [
            { timestamp: 0, value: mainValue },
            { timestamp: 0, value: estimateValue },
          ],
          extendData: areaExtendData,
        })

        const isFirstCreate =
          (activeType === TpslEstimateType.TakeProfit &&
            !extendData._hadTakeProfitBeforeDrag) ||
          (activeType === TpslEstimateType.StopLoss &&
            !extendData._hadStopLossBeforeDrag)

        // 松手只交付目标价格，是否真正创建委托由业务回调决定。
        if (isFirstCreate) {
          extendData.onFirstDragEnd?.({
            direction: extendData.direction,
            mainValue,
            estimateValue,
            estimateType: activeType,
          })
        } else {
          extendData.onEstimateDragEnd?.({
            direction: extendData.direction,
            mainValue,
            estimateValue,
            estimateType: activeType,
          })
        }
      } else {
        const areaId = getTpslDragAreaId(extendData.baseId, activeType)
        const isFirstCreate =
          (activeType === TpslEstimateType.TakeProfit &&
            !extendData._hadTakeProfitBeforeDrag) ||
          (activeType === TpslEstimateType.StopLoss &&
            !extendData._hadStopLossBeforeDrag)
        if (isFirstCreate) {
          chart.removeOverlay({ id: overlayId })
        }
        chart.removeOverlay({ id: areaId })
      }
    }

    chart.overrideOverlay({
      id: overlay.id,
      visible: true,
      zLevel: TPSL_Z_LEVELS.action,
      points: [
        { timestamp: overlay.points[0]?.timestamp ?? 0, value: mainValue },
      ],
      extendData: {
        ...extendData,
        _isDragging: false,
        _hasMoved: false,
        _mainValueSnapshot: null,
        _activeEstimateType: null,
        _hadTakeProfitBeforeDrag: false,
        _hadStopLossBeforeDrag: false,
        _tpValueSnapshot: null,
        _slValueSnapshot: null,
      },
    })

    restoreChartNavigation(chart)
    setDragPresentation(
      chart,
      overlay.paneId,
      false,
      extendData._isHovered ? 'grab' : 'crosshair',
    )
  },
}
