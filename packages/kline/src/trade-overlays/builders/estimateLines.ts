import type { OverlayCreate } from 'klinecharts'
import { KLINE_MAIN_PANE_ID } from '../../chart/constants'
import { TPSL_Z_LEVELS } from '../constants'
import { S } from '../helpers/overlayConstants'
import {
  areaTemplate,
  estimateLineTemplate,
  verticalConnectorTemplate,
} from '../templates/index'
import type { TpslOverlayData } from '../types'
import { TpslDirection, TpslEstimateType } from '../types'
import type { OverlayIds } from './types'

export type EstimateOverlaysParams = {
  item: TpslOverlayData
  overlayIds: OverlayIds
  groupId: string
  estimateValue: number
  estimateText?: string
  estimateType: TpslEstimateType
  fallbackText: string
  estimateCircleColor: string
  labelOffsetX?: number
}

export const getDirectionColor = (item: TpslOverlayData): string =>
  item.direction === TpslDirection.Long
    ? S.colors.profit.primary
    : S.colors.loss.primary

export const getEstimateCircleColor = (
  estimateType: TpslEstimateType,
): string =>
  estimateType === TpslEstimateType.TakeProfit
    ? S.colors.profit.primary
    : S.colors.loss.primary

export const createEstimateOverlays = ({
  item,
  overlayIds,
  groupId,
  estimateValue,
  estimateText,
  estimateType,
  fallbackText,
  estimateCircleColor,
  labelOffsetX,
}: EstimateOverlaysParams): Array<OverlayCreate & { id: string }> => {
  const areaId =
    estimateType === TpslEstimateType.TakeProfit
      ? overlayIds.tpArea
      : overlayIds.slArea
  const lineId =
    estimateType === TpslEstimateType.TakeProfit
      ? overlayIds.tpLine
      : overlayIds.slLine
  const connectorId =
    estimateType === TpslEstimateType.TakeProfit
      ? overlayIds.tpConnector
      : overlayIds.slConnector
  const isLossArea = estimateType === TpslEstimateType.StopLoss
  const directionColor = getDirectionColor(item)

  return [
    {
      id: areaId,
      name: areaTemplate.name,
      groupId,
      paneId: KLINE_MAIN_PANE_ID,
      zLevel: TPSL_Z_LEVELS.background,
      points: [
        { timestamp: 0, value: item.mainValue },
        { timestamp: 0, value: estimateValue },
      ],
      extendData: {
        isDragging: false,
        isLoss: isLossArea,
      },
    },
    {
      id: lineId,
      name: estimateLineTemplate.name,
      groupId,
      paneId: KLINE_MAIN_PANE_ID,
      zLevel: TPSL_Z_LEVELS.action,
      points: [{ timestamp: 0, value: estimateValue }],
      extendData: {
        estimateText: estimateText || fallbackText,
        estimateType,
        _isTemporary: false,
        labelOffsetX,
        baseId: item.id,
        direction: item.direction,
        mainValue: item.mainValue,
        reducePrice: item.reducePrice,
        onDragging: item.onDragging,
        onFirstDragEnd: item.onFirstDragEnd,
        onEstimateDragEnd: item.onEstimateDragEnd,
        onEstimateClose: item.onEstimateClose,
        onOpenTpslModal: item.onOpenEstimateModal
          ? () => item.onOpenEstimateModal?.(estimateType)
          : item.onOpenTpslModal,
        getEstimateText: item.getEstimateText,
      },
    },
    {
      id: connectorId,
      name: verticalConnectorTemplate.name,
      groupId,
      paneId: KLINE_MAIN_PANE_ID,
      zLevel: TPSL_Z_LEVELS.base + 1,
      points: [
        { timestamp: 0, value: item.mainValue },
        { timestamp: 0, value: estimateValue },
      ],
      visible: false,
      extendData: {
        lineColor: directionColor,
        mainCircleColor: directionColor,
        estimateCircleColor,
      },
    },
  ]
}
