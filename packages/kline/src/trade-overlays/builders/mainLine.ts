import type { OverlayCreate } from 'klinecharts'
import { KLINE_MAIN_PANE_ID } from '../../chart/constants'
import { TPSL_Z_LEVELS } from '../constants'
import type { ActionLayout } from '../helpers/measurements'
import { LEFT_OFFSET } from '../helpers/overlayConstants'
import {
  horizontalLineTemplate,
  mainLineHitboxTemplate,
} from '../templates/index'
import { TPSL_LINE_TYPES, type TpslOverlayData } from '../types'
import type { ButtonOverlayIds, OverlayIds } from './types'

export type MainLineBuilderParams = {
  item: TpslOverlayData
  overlayIds: OverlayIds
  groupId: string
  isLoss: boolean
  labelsWidth: number
  actionLayout: ActionLayout
  buttonOverlayIds: ButtonOverlayIds
  onHoverChange: (hovered: boolean) => void
  onLineClick?: () => void
}

export const createMainLineOverlays = ({
  item,
  overlayIds,
  groupId,
  isLoss,
  labelsWidth,
  actionLayout,
  buttonOverlayIds,
  onHoverChange,
  onLineClick,
}: MainLineBuilderParams): OverlayCreate[] => [
  {
    id: overlayIds.horizontalLineBg,
    name: horizontalLineTemplate.name,
    groupId,
    paneId: KLINE_MAIN_PANE_ID,
    zLevel: TPSL_Z_LEVELS.background,
    points: [{ timestamp: 0, value: item.mainValue }],
    extendData: {
      isLoss,
      dashed: item.lineType !== TPSL_LINE_TYPES.Position,
      showYAxisLabel: true,
    },
  },
  {
    id: overlayIds.horizontalLineSolid,
    name: horizontalLineTemplate.name,
    groupId,
    paneId: KLINE_MAIN_PANE_ID,
    zLevel: TPSL_Z_LEVELS.solidLine,
    points: [{ timestamp: 0, value: item.mainValue }],
    extendData: {
      isLoss,
      startX: LEFT_OFFSET,
      width: LEFT_OFFSET + labelsWidth,
      dashed: false,
    },
  },
  {
    id: overlayIds.hitboxEnter,
    name: mainLineHitboxTemplate.name,
    groupId,
    paneId: KLINE_MAIN_PANE_ID,
    zLevel: TPSL_Z_LEVELS.hitbox,
    points: [{ timestamp: 0, value: item.mainValue }],
    extendData: {
      width: actionLayout.enterWidth,
      baseId: item.id,
      enableEnter: true,
      enableLeave: true,
      buttonOverlayIds,
      onHoverChange,
      onClick: onLineClick,
    },
  },
  {
    id: overlayIds.hitboxLeave,
    name: mainLineHitboxTemplate.name,
    groupId,
    paneId: KLINE_MAIN_PANE_ID,
    zLevel: TPSL_Z_LEVELS.hitbox,
    points: [{ timestamp: 0, value: item.mainValue }],
    extendData: {
      width: actionLayout.leaveWidth,
      baseId: item.id,
      enableEnter: false,
      enableLeave: true,
      buttonOverlayIds,
      onHoverChange,
    },
  },
]
