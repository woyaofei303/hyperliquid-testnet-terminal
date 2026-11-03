import type { OverlayCreate } from 'klinecharts'
import { KLINE_MAIN_PANE_ID } from '../../chart/constants'
import { TPSL_Z_LEVELS } from '../constants'
import type { ActionLayout } from '../helpers/measurements'
import { LEFT_OFFSET } from '../helpers/overlayConstants'
import {
  type CloseButtonExtendData,
  closeButtonTemplate,
  positionLabelTemplate,
  profitLabelTemplate,
  tpslButtonTemplate,
} from '../templates/index'
import type { TpslPositionOverlayData } from '../types'
import { isNil } from '../utils'
import type { OverlayIds } from './types'

export type PositionControlsParams = {
  item: TpslPositionOverlayData
  overlayIds: OverlayIds
  groupId: string
  isLoss: boolean
  profitLabelText: string
  profitWidth: number
  positionWidth: number
  actionLayout: ActionLayout
  buttonText: string
  estimatedProfitText: string
  estimatedLossText: string
  closeButtonExtend: Pick<CloseButtonExtendData, 'onClose' | 'onHoverChange'>
}

export const createPositionControlOverlays = ({
  item,
  overlayIds,
  groupId,
  isLoss,
  profitLabelText,
  profitWidth,
  actionLayout,
  buttonText,
  estimatedProfitText,
  estimatedLossText,
  closeButtonExtend,
}: PositionControlsParams): OverlayCreate[] => {
  const hasTakeProfit = !isNil(item.takeProfitValue)
  const hasStopLoss = !isNil(item.stopLossValue)

  return [
    {
      id: overlayIds.profitLabel,
      name: profitLabelTemplate.name,
      groupId,
      paneId: KLINE_MAIN_PANE_ID,
      zLevel: TPSL_Z_LEVELS.base,
      points: [{ timestamp: 0, value: item.mainValue }],
      extendData: {
        text: profitLabelText,
        isLoss,
        offsetX: LEFT_OFFSET,
      },
    },
    {
      id: overlayIds.positionLabel,
      name: positionLabelTemplate.name,
      groupId,
      paneId: KLINE_MAIN_PANE_ID,
      zLevel: TPSL_Z_LEVELS.base,
      points: [{ timestamp: 0, value: item.mainValue }],
      extendData: {
        text: item.positionAmount,
        isLoss,
        offsetX: LEFT_OFFSET + profitWidth,
      },
    },
    {
      id: overlayIds.closeButton,
      name: closeButtonTemplate.name,
      groupId,
      paneId: KLINE_MAIN_PANE_ID,
      zLevel: TPSL_Z_LEVELS.action,
      points: [{ timestamp: 0, value: item.mainValue }],
      visible: false,
      extendData: {
        offsetX: actionLayout.closeOffsetX,
        isLoss,
        hasLeftRadius: false,
        hasRightRadius: true,
        onClose: closeButtonExtend.onClose,
        onHoverChange: closeButtonExtend.onHoverChange,
      },
    },
    {
      id: overlayIds.tpslButton,
      name: tpslButtonTemplate.name,
      groupId,
      paneId: KLINE_MAIN_PANE_ID,
      zLevel: TPSL_Z_LEVELS.action,
      points: [{ timestamp: 0, value: item.mainValue }],
      visible: false,
      extendData: {
        offsetX: actionLayout.tpslOffsetX,
        isLoss,
        baseId: item.id,
        direction: item.direction,
        mainValue: item.mainValue,
        reducePrice: item.reducePrice,
        buttonText,
        hasTakeProfit,
        hasStopLoss,
        takeProfitText: item.takeProfitText,
        stopLossText: item.stopLossText,
        estimatedProfitFallback: estimatedProfitText,
        estimatedLossFallback: estimatedLossText,
        onDragging: item.onDragging,
        onFirstDragEnd: item.onFirstDragEnd,
        onEstimateDragEnd: item.onEstimateDragEnd,
        onEstimateClose: item.onEstimateClose,
        onOpenTpslModal: item.onOpenEstimateModal ?? item.onOpenTpslModal,
        getEstimateText: item.getEstimateText,
      },
    },
  ]
}
