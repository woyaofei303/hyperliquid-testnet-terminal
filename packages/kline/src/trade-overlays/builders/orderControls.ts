import type { OverlayCreate } from 'klinecharts'
import { KLINE_MAIN_PANE_ID } from '../../chart/constants'
import { TPSL_Z_LEVELS } from '../constants'
import type { ActionLayout } from '../helpers/measurements'
import { LEFT_OFFSET } from '../helpers/overlayConstants'
import {
  type CloseButtonExtendData,
  closeButtonTemplate,
  limitLabelTemplate,
  priceLabelTemplate,
} from '../templates/index'
import type { TpslOrderOverlayData, TpslTpslOrderOverlayData } from '../types'
import type { OverlayIds } from './types'

export type OrderControlsParams = {
  item: TpslOrderOverlayData | TpslTpslOrderOverlayData
  overlayIds: OverlayIds
  groupId: string
  isLoss: boolean
  limitText: string
  limitWidth: number
  actionLayout: ActionLayout
  closeButtonExtend: Pick<CloseButtonExtendData, 'onClose' | 'onHoverChange'>
}

export const createOrderControlOverlays = ({
  item,
  overlayIds,
  groupId,
  isLoss,
  limitText,
  limitWidth,
  actionLayout,
  closeButtonExtend,
}: OrderControlsParams): OverlayCreate[] => [
  {
    id: overlayIds.limitLabel,
    name: limitLabelTemplate.name,
    groupId,
    paneId: KLINE_MAIN_PANE_ID,
    zLevel: TPSL_Z_LEVELS.base,
    points: [{ timestamp: 0, value: item.mainValue }],
    extendData: { text: limitText, isLoss, offsetX: LEFT_OFFSET },
  },
  {
    id: overlayIds.priceLabel,
    name: priceLabelTemplate.name,
    groupId,
    paneId: KLINE_MAIN_PANE_ID,
    zLevel: TPSL_Z_LEVELS.base,
    points: [{ timestamp: 0, value: item.mainValue }],
    extendData: {
      text: item.orderPriceText,
      isLoss,
      offsetX: LEFT_OFFSET + limitWidth,
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
]
