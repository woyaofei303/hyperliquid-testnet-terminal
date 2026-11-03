import type { UseChartOverlayReturn } from '../shared/useKlineChartOverlay'
import {
  createEstimateOverlays,
  getEstimateCircleColor,
} from './builders/estimateLines'
import { TPSL_Z_LEVELS } from './constants'
import {
  getTpslDragAreaId,
  getTpslGroupId,
  getTpslOverlayIds,
} from './idFactory'
import type { OverlayPatch } from './options'
import { isEstimateLineExtendData } from './typeGuards'
import { TpslEstimateType, type TpslOverlayData } from './types'

interface SyncEstimateSideParams {
  item: TpslOverlayData
  overlayApi: UseChartOverlayReturn
  existingOverlayIds: Set<string>
  overrideOverlayIfChanged: (patch: OverlayPatch) => boolean
  labelOffsetX: number
  estimateType: TpslEstimateType
  estimateValue?: number | null
  estimateText?: string
  fallbackText: string
  keepTemporary?: boolean
  hovered?: boolean
}

/** 一侧的线、填充区与连接线共用 builder 和 id；拖拽中的坐标由模板独占。 */
export function syncEstimateSide({
  item,
  overlayApi,
  existingOverlayIds,
  overrideOverlayIfChanged,
  labelOffsetX,
  estimateType,
  estimateValue,
  estimateText,
  fallbackText,
  keepTemporary,
  hovered,
}: SyncEstimateSideParams) {
  const ids = getTpslOverlayIds(item.id)
  const isTp = estimateType === TpslEstimateType.TakeProfit
  const lineId = isTp ? ids.tpLine : ids.slLine
  const areaId = isTp ? ids.tpArea : ids.slArea
  const connectorId = isTp ? ids.tpConnector : ids.slConnector
  const existingLine = overlayApi.getOverlayById(lineId)
  const extendData = isEstimateLineExtendData(existingLine?.extendData)
    ? existingLine.extendData
    : null

  if (estimateValue == null) {
    // 首次创建的确认弹窗尚未结束时保留草稿，取消后再清理临时区域。
    if (extendData?._isTemporary && keepTemporary) return
    for (const id of [
      areaId,
      getTpslDragAreaId(item.id, estimateType),
      lineId,
      connectorId,
    ]) {
      overlayApi.removeOverlay({ id })
      existingOverlayIds.delete(id)
    }
    return
  }

  const dragging = Boolean(extendData?._isDragging)
  // 提交成功或失败回滚后，由正式区域接管展示，拖拽预览不能继续覆盖它。
  if (!dragging)
    overlayApi.removeOverlay({ id: getTpslDragAreaId(item.id, estimateType) })
  const overlays = createEstimateOverlays({
    item,
    overlayIds: ids,
    groupId: getTpslGroupId(item.id),
    estimateType,
    estimateValue,
    estimateText,
    fallbackText,
    labelOffsetX,
    estimateCircleColor: getEstimateCircleColor(estimateType),
  })
  for (const overlay of overlays) {
    const { id } = overlay
    if (dragging && id === areaId) continue
    if (dragging && id === lineId) {
      overrideOverlayIfChanged({
        id,
        zLevel: TPSL_Z_LEVELS.action,
        extendData: {
          ...extendData,
          onDragging: item.onDragging,
          onFirstDragEnd: item.onFirstDragEnd,
          onEstimateDragEnd: item.onEstimateDragEnd,
          onEstimateClose: item.onEstimateClose,
          onOpenTpslModal: item.onOpenEstimateModal ?? item.onOpenTpslModal,
          getEstimateText: item.getEstimateText,
        },
      })
      continue
    }
    if (id === connectorId) overlay.visible = Boolean(hovered || dragging)
    if (overlayApi.getOverlayById(id)) {
      overrideOverlayIfChanged(overlay)
      existingOverlayIds.add(id)
    } else if (overlayApi.createOverlay(overlay, { allowDuplicate: true })) {
      existingOverlayIds.add(id)
    }
  }
}
