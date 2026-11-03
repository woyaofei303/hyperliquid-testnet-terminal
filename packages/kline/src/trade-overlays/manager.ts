import type { RefObject } from 'react'
import { useCallback, useEffect } from 'react'
import { KLINE_MAIN_PANE_ID } from '../chart/constants'
import type { UseChartOverlayReturn } from '../shared/useKlineChartOverlay'
import {
  createEstimateOverlays,
  getEstimateCircleColor,
} from './builders/estimateLines'
import { createMainLineOverlays } from './builders/mainLine'
import { createOrderControlOverlays } from './builders/orderControls'
import { createPositionControlOverlays } from './builders/positionControls'
import { TPSL_Z_LEVELS } from './constants'
import {
  calculateActionLayout,
  calculateLabelWidths,
  type MeasureTextFn,
} from './helpers/measurements'
import { LEFT_OFFSET, S } from './helpers/overlayConstants'
import {
  getTpslButtonOverlayIds,
  getTpslGroupId,
  getTpslOverlayIds,
} from './idFactory'
import type { OverlayPatch } from './options'
import { syncEstimateSide } from './syncEstimateSide'
import type {
  CloseButtonExtendData,
  TpslButtonExtendData,
} from './templates/index'
import { mainLineHitboxTemplate } from './templates/index'
import {
  isCloseButtonExtendData,
  isEstimateLineExtendData,
  isTpslButtonExtendData,
} from './typeGuards'
import type { TpslOverlayData } from './types'
import { TPSL_LINE_TYPES, TpslDirection, TpslEstimateType } from './types'
import { useOverlayInteractions } from './useOverlayInteractions'
import { isEqual, isNil } from './utils'

export type OverlayTexts = {
  limitText: string
  tpslText: string
  tpText: string
  slText: string
  profitAmountText: string
  estimatedProfitText: string
  estimatedLossText: string
}

const isOrderLikeLine = (item: TpslOverlayData) =>
  item.lineType !== TPSL_LINE_TYPES.Position

const getIsLoss = (item: TpslOverlayData) =>
  isOrderLikeLine(item)
    ? item.direction === TpslDirection.Short
    : item.profitPercent.includes('-')

const getButtonText = (hasTp: boolean, hasSl: boolean, texts: OverlayTexts) => {
  if (hasTp && hasSl) return texts.tpslText
  if (hasTp) return texts.slText
  if (hasSl) return texts.tpText
  return texts.tpslText
}

const getOrderLabelText = (
  item: TpslOverlayData,
  texts: OverlayTexts,
): string =>
  item.lineType === TPSL_LINE_TYPES.Position
    ? texts.limitText
    : item.orderLabelText || texts.limitText

// 避免未变化的业务快照反复触发 Canvas 重绘；这里只比较本 manager 实际更新的字段。
const useOverrideOverlay = (overlayApi: UseChartOverlayReturn) =>
  useCallback(
    (patch: OverlayPatch) => {
      if (!patch.id) return false
      const overlay = overlayApi.getOverlayById(patch.id)
      if (!overlay) return false

      const extendDataChanged =
        patch.extendData !== undefined &&
        !isEqual(overlay.extendData ?? null, patch.extendData)
      const pointsChanged =
        patch.points !== undefined &&
        !isEqual(overlay.points ?? [], patch.points ?? [])
      const visibilityChanged =
        patch.visible !== undefined && patch.visible !== overlay.visible
      const zLevelChanged =
        patch.zLevel !== undefined && patch.zLevel !== overlay.zLevel

      if (
        !extendDataChanged &&
        !pointsChanged &&
        !visibilityChanged &&
        !zLevelChanged
      ) {
        return false
      }

      overlayApi.overrideOverlay(patch)
      return true
    },
    [overlayApi],
  )

type ManagerOptions = {
  data: TpslOverlayData[]
  initialized: boolean
  overlayApi: UseChartOverlayReturn
  overlayMapRef: RefObject<Map<string, Set<string>>>
  overlayRevision: number
  texts: OverlayTexts
  measureText: MeasureTextFn
}

/** 按业务 id 同步一组图形：删除消失项、创建新增项、修补已有项，并保留正在交互的状态。 */
export const useTpslOverlayManager = ({
  data,
  initialized,
  overlayApi,
  overlayMapRef,
  overlayRevision,
  texts,
  measureText,
}: ManagerOptions) => {
  const overrideOverlayIfChanged = useOverrideOverlay(overlayApi)
  const {
    closeHoverRevision,
    lineHoverRevision,
    closeHoverStateRef,
    lineHoverStateRef,
    getCloseButtonHandlers,
    setCloseButtonCallback,
    ensureLineHoverHandler,
    cleanupOverlayState,
  } = useOverlayInteractions(initialized)

  const mountOverlayGroup = useCallback(
    (item: TpslOverlayData) => {
      const overlayIds = getTpslOverlayIds(item.id)
      const buttonOverlayIds = getTpslButtonOverlayIds(item.id)
      const groupId = getTpslGroupId(item.id)
      const isLoss = getIsLoss(item)
      const orderLabelText = getOrderLabelText(item, texts)
      const isPosition = item.lineType === TPSL_LINE_TYPES.Position
      const labelWidths = calculateLabelWidths(item, measureText, {
        limit: orderLabelText,
        profitAmount: texts.profitAmountText,
      })
      const labelsWidth = isOrderLikeLine(item)
        ? labelWidths.limitWidth + labelWidths.priceWidth - S.borderWidth
        : labelWidths.profitWidth + labelWidths.positionWidth - S.borderWidth
      const hasTp = !isNil(item.takeProfitValue)
      const hasSl = !isNil(item.stopLossValue)
      const actionLayout = calculateActionLayout(labelsWidth, measureText, {
        buttonText: isPosition ? getButtonText(hasTp, hasSl, texts) : undefined,
        includeTpslButton: isPosition,
      })
      const closeButtonHandlers = getCloseButtonHandlers(item.id)
      const lineHoverHandler = ensureLineHoverHandler(item.id)
      setCloseButtonCallback(item.id, item.onClose)

      const overlays = [
        ...createMainLineOverlays({
          item,
          overlayIds,
          groupId,
          isLoss,
          labelsWidth,
          actionLayout,
          buttonOverlayIds,
          onHoverChange: lineHoverHandler,
          onLineClick:
            item.lineType === TPSL_LINE_TYPES.TpslOrder
              ? item.onOpenTpslModal
              : undefined,
        }),
        ...(isOrderLikeLine(item)
          ? createOrderControlOverlays({
              item,
              overlayIds,
              groupId,
              isLoss,
              limitText: orderLabelText,
              limitWidth: labelWidths.limitWidth,
              actionLayout,
              closeButtonExtend: closeButtonHandlers,
            })
          : createPositionControlOverlays({
              item,
              overlayIds,
              groupId,
              isLoss,
              profitLabelText: texts.profitAmountText
                ? `${texts.profitAmountText} ${item.profitPercent}`
                : item.profitPercent,
              profitWidth: labelWidths.profitWidth,
              positionWidth: labelWidths.positionWidth,
              actionLayout,
              buttonText: getButtonText(hasTp, hasSl, texts),
              estimatedProfitText: texts.estimatedProfitText,
              estimatedLossText: texts.estimatedLossText,
              closeButtonExtend: closeButtonHandlers,
            })),
      ]

      if (isPosition && !isNil(item.takeProfitValue)) {
        overlays.push(
          ...createEstimateOverlays({
            item,
            overlayIds,
            groupId,
            estimateValue: item.takeProfitValue,
            estimateText: item.takeProfitText,
            estimateType: TpslEstimateType.TakeProfit,
            fallbackText: texts.estimatedProfitText,
            estimateCircleColor: getEstimateCircleColor(
              TpslEstimateType.TakeProfit,
            ),
            labelOffsetX: actionLayout.tpslOffsetX,
          }),
        )
      }

      if (isPosition && !isNil(item.stopLossValue)) {
        overlays.push(
          ...createEstimateOverlays({
            item,
            overlayIds,
            groupId,
            estimateValue: item.stopLossValue,
            estimateText: item.stopLossText,
            estimateType: TpslEstimateType.StopLoss,
            fallbackText: texts.estimatedLossText,
            estimateCircleColor: getEstimateCircleColor(
              TpslEstimateType.StopLoss,
            ),
            labelOffsetX: actionLayout.tpslOffsetX,
          }),
        )
      }

      const result = overlayApi.createOverlay(overlays, {
        allowDuplicate: true,
      })
      const ids = Array.isArray(result)
        ? result.filter((id): id is string => Boolean(id))
        : result
          ? [result]
          : []
      overlayMapRef.current.set(item.id, new Set(ids))
      return ids
    },
    [
      measureText,
      overlayApi,
      overlayMapRef,
      texts,
      getCloseButtonHandlers,
      setCloseButtonCallback,
      ensureLineHoverHandler,
    ],
  )

  useEffect(() => {
    if (!initialized) return

    const currentOverlayMap = overlayMapRef.current
    const newDataMap = new Map(data.map((item) => [item.id, item]))

    Array.from(currentOverlayMap.keys()).forEach((id) => {
      if (!newDataMap.has(id)) {
        overlayApi.removeOverlay({ groupId: getTpslGroupId(id) })
        currentOverlayMap.delete(id)
        cleanupOverlayState(id)
      }
    })

    data.forEach((item) => {
      const existingOverlayIds = currentOverlayMap.get(item.id)
      if (!existingOverlayIds) {
        cleanupOverlayState(item.id)
        mountOverlayGroup(item)
        return
      }
      setCloseButtonCallback(item.id, item.onClose)
      const closeButtonHandlers = getCloseButtonHandlers(item.id)
      const lineHoverHandler = ensureLineHoverHandler(item.id)
      const isCloseHovered = closeHoverStateRef.current.get(item.id) ?? false
      const isLineHovered = lineHoverStateRef.current.get(item.id) ?? false

      const missingOverlay = Array.from(existingOverlayIds).some(
        (overlayId) => !overlayApi.getOverlayById(overlayId),
      )
      if (missingOverlay) {
        // 图表中一组图形已不完整时整组重建，避免留下标签存在但命中区/按钮丢失的半成品。
        overlayApi.removeOverlay({ groupId: getTpslGroupId(item.id) })
        currentOverlayMap.delete(item.id)
        cleanupOverlayState(item.id)
        mountOverlayGroup(item)
        return
      }

      const isOrder = isOrderLikeLine(item)
      const isPosition = item.lineType === TPSL_LINE_TYPES.Position
      const isLoss = getIsLoss(item)
      const overlayIds = getTpslOverlayIds(item.id)
      const buttonOverlayIds = getTpslButtonOverlayIds(item.id)
      const tpLineOverlay = isPosition
        ? overlayApi.getOverlayById(overlayIds.tpLine)
        : undefined
      const slLineOverlay = isPosition
        ? overlayApi.getOverlayById(overlayIds.slLine)
        : undefined
      const tpslButtonOverlay = isPosition
        ? overlayApi.getOverlayById(overlayIds.tpslButton)
        : undefined

      const tpLineDragging =
        isEstimateLineExtendData(tpLineOverlay?.extendData) &&
        Boolean(tpLineOverlay.extendData._isDragging)
      const slLineDragging =
        isEstimateLineExtendData(slLineOverlay?.extendData) &&
        Boolean(slLineOverlay.extendData._isDragging)
      const buttonDragging =
        isTpslButtonExtendData(tpslButtonOverlay?.extendData) &&
        Boolean(tpslButtonOverlay.extendData._isDragging)

      if (isPosition && (tpLineDragging || slLineDragging || buttonDragging)) {
        // 拖拽模板暂时拥有价格与位置；这里只换最新回调，防止行情刷新把鼠标控制的线拉回。
        if (isTpslButtonExtendData(tpslButtonOverlay?.extendData)) {
          const prevTpsl = tpslButtonOverlay.extendData
          prevTpsl.onDragging = item.onDragging
          prevTpsl.onFirstDragEnd = item.onFirstDragEnd
          prevTpsl.onEstimateDragEnd = item.onEstimateDragEnd
          prevTpsl.onEstimateClose = item.onEstimateClose
          prevTpsl.onOpenTpslModal =
            item.onOpenEstimateModal ?? item.onOpenTpslModal
          prevTpsl.getEstimateText = item.getEstimateText
        }
        if (isEstimateLineExtendData(tpLineOverlay?.extendData)) {
          const currentTpExtend = tpLineOverlay.extendData
          overrideOverlayIfChanged({
            id: overlayIds.tpLine,
            extendData: {
              ...currentTpExtend,
              onDragging: item.onDragging,
              onFirstDragEnd: item.onFirstDragEnd,
              onEstimateDragEnd: item.onEstimateDragEnd,
              onEstimateClose: item.onEstimateClose,
              onOpenTpslModal: item.onOpenEstimateModal ?? item.onOpenTpslModal,
              getEstimateText: item.getEstimateText,
            },
          })
        }
        if (isEstimateLineExtendData(slLineOverlay?.extendData)) {
          const currentSlExtend = slLineOverlay.extendData
          overrideOverlayIfChanged({
            id: overlayIds.slLine,
            extendData: {
              ...currentSlExtend,
              onDragging: item.onDragging,
              onFirstDragEnd: item.onFirstDragEnd,
              onEstimateDragEnd: item.onEstimateDragEnd,
              onEstimateClose: item.onEstimateClose,
              onOpenTpslModal: item.onOpenEstimateModal ?? item.onOpenTpslModal,
              getEstimateText: item.getEstimateText,
            },
          })
        }
        return
      }

      const labelWidths = calculateLabelWidths(item, measureText, {
        limit: getOrderLabelText(item, texts),
        profitAmount: texts.profitAmountText,
      })

      overrideOverlayIfChanged({
        id: overlayIds.horizontalLineBg,
        extendData: { isLoss, dashed: isOrder, showYAxisLabel: true },
      })

      const labelsWidth = isOrder
        ? labelWidths.limitWidth + labelWidths.priceWidth - S.borderWidth
        : labelWidths.profitWidth + labelWidths.positionWidth - S.borderWidth
      const buttonText = isPosition
        ? getButtonText(
            !isNil(item.takeProfitValue),
            !isNil(item.stopLossValue),
            texts,
          )
        : undefined
      const actionLayout = isOrder
        ? calculateActionLayout(labelsWidth, measureText, {
            includeTpslButton: false,
          })
        : calculateActionLayout(labelsWidth, measureText, { buttonText })

      const legacyHitboxId = `${item.id}-hitbox`
      if (overlayApi.getOverlayById(legacyHitboxId)) {
        overlayApi.removeOverlay({ id: legacyHitboxId })
        existingOverlayIds.delete(legacyHitboxId)
      }

      const enterHitboxOverlay = overlayApi.getOverlayById(
        overlayIds.hitboxEnter,
      )
      if (enterHitboxOverlay) {
        overrideOverlayIfChanged({
          id: overlayIds.hitboxEnter,
          zLevel: TPSL_Z_LEVELS.hitbox,
          extendData: {
            width: actionLayout.enterWidth,
            baseId: item.id,
            enableEnter: true,
            enableLeave: true,
            buttonOverlayIds,
            onHoverChange: lineHoverHandler,
            onClick:
              item.lineType === TPSL_LINE_TYPES.TpslOrder
                ? item.onOpenTpslModal
                : undefined,
          },
        })
      } else {
        const result = overlayApi.createOverlay(
          {
            id: overlayIds.hitboxEnter,
            name: mainLineHitboxTemplate.name,
            groupId: getTpslGroupId(item.id),
            paneId: KLINE_MAIN_PANE_ID,
            zLevel: TPSL_Z_LEVELS.hitbox,
            points: [{ timestamp: 0, value: item.mainValue }],
            extendData: {
              width: actionLayout.enterWidth,
              baseId: item.id,
              enableEnter: true,
              enableLeave: true,
              buttonOverlayIds,
              onHoverChange: lineHoverHandler,
              onClick:
                item.lineType === TPSL_LINE_TYPES.TpslOrder
                  ? item.onOpenTpslModal
                  : undefined,
            },
          },
          { allowDuplicate: true },
        )
        if (result && existingOverlayIds) {
          existingOverlayIds.add(overlayIds.hitboxEnter)
        }
      }

      const leaveHitboxOverlay = overlayApi.getOverlayById(
        overlayIds.hitboxLeave,
      )
      if (leaveHitboxOverlay) {
        overrideOverlayIfChanged({
          id: overlayIds.hitboxLeave,
          zLevel: TPSL_Z_LEVELS.hitbox,
          extendData: {
            width: actionLayout.leaveWidth,
            baseId: item.id,
            enableEnter: false,
            enableLeave: true,
            buttonOverlayIds,
            onHoverChange: lineHoverHandler,
          },
        })
      } else {
        const result = overlayApi.createOverlay(
          {
            id: overlayIds.hitboxLeave,
            name: mainLineHitboxTemplate.name,
            groupId: getTpslGroupId(item.id),
            paneId: KLINE_MAIN_PANE_ID,
            zLevel: TPSL_Z_LEVELS.hitbox,
            points: [{ timestamp: 0, value: item.mainValue }],
            extendData: {
              width: actionLayout.leaveWidth,
              baseId: item.id,
              enableEnter: false,
              enableLeave: true,
              buttonOverlayIds,
              onHoverChange: lineHoverHandler,
            },
          },
          { allowDuplicate: true },
        )
        if (result && existingOverlayIds) {
          existingOverlayIds.add(overlayIds.hitboxLeave)
        }
      }

      overrideOverlayIfChanged({
        id: overlayIds.horizontalLineSolid,
        extendData: {
          isLoss,
          dashed: false,
          startX: LEFT_OFFSET,
          width: LEFT_OFFSET + labelsWidth,
        },
      })

      if (isOrder) {
        overrideOverlayIfChanged({
          id: overlayIds.priceLabel,
          extendData: {
            text: item.orderPriceText,
            isLoss,
            offsetX: LEFT_OFFSET + labelWidths.limitWidth,
          },
        })
        overrideOverlayIfChanged({
          id: overlayIds.limitLabel,
          extendData: {
            text: getOrderLabelText(item, texts),
            isLoss,
            offsetX: LEFT_OFFSET,
          },
        })
      } else {
        const updateProfitLabelText = texts.profitAmountText
          ? `${texts.profitAmountText} ${item.profitPercent}`
          : item.profitPercent
        overrideOverlayIfChanged({
          id: overlayIds.profitLabel,
          extendData: {
            text: updateProfitLabelText,
            isLoss,
            offsetX: LEFT_OFFSET,
          },
        })
        overrideOverlayIfChanged({
          id: overlayIds.positionLabel,
          extendData: {
            text: item.positionAmount,
            isLoss,
            offsetX: LEFT_OFFSET + labelWidths.profitWidth,
          },
        })
      }

      const closeButtonOverlay = overlayApi.getOverlayById(
        overlayIds.closeButton,
      )
      const closeBase: CloseButtonExtendData = {
        offsetX: actionLayout.closeOffsetX,
        isLoss,
        hasLeftRadius: false,
        hasRightRadius: true,
        onClose: closeButtonHandlers.onClose,
        onHoverChange: closeButtonHandlers.onHoverChange,
      }
      const prevCloseExtend = isCloseButtonExtendData(
        closeButtonOverlay?.extendData,
      )
        ? closeButtonOverlay.extendData
        : undefined
      const shouldShowCloseButton = isLineHovered || isCloseHovered
      const closePatch: OverlayPatch = {
        id: overlayIds.closeButton,
        visible: shouldShowCloseButton,
      }
      if (!isCloseHovered || closeButtonOverlay?.visible === false) {
        closePatch.extendData = {
          ...(prevCloseExtend ?? {}),
          ...closeBase,
          _isHovered: prevCloseExtend?._isHovered,
          _hoverBgColor: prevCloseExtend?._hoverBgColor,
        }
      }
      overrideOverlayIfChanged(closePatch)

      if (!isOrder) {
        const hasTpUpdate = !isNil(item.takeProfitValue)
        const hasSlUpdate = !isNil(item.stopLossValue)
        const allowTpslButton = !(hasTpUpdate && hasSlUpdate)
        const tpslBase: TpslButtonExtendData = {
          offsetX: actionLayout.tpslOffsetX,
          isLoss,
          baseId: item.id,
          direction: item.direction,
          mainValue: item.mainValue,
          reducePrice: item.reducePrice,
          buttonText: buttonText ?? texts.tpslText,
          hasTakeProfit: hasTpUpdate,
          hasStopLoss: hasSlUpdate,
          takeProfitText: item.takeProfitText,
          stopLossText: item.stopLossText,
          estimatedProfitFallback: texts.estimatedProfitText,
          estimatedLossFallback: texts.estimatedLossText,
          onDragging: item.onDragging,
          onFirstDragEnd: item.onFirstDragEnd,
          onEstimateDragEnd: item.onEstimateDragEnd,
          onEstimateClose: item.onEstimateClose,
          onOpenTpslModal: item.onOpenEstimateModal ?? item.onOpenTpslModal,
          getEstimateText: item.getEstimateText,
        }
        if (isTpslButtonExtendData(tpslButtonOverlay?.extendData)) {
          const prevTpsl = tpslButtonOverlay.extendData
          const shouldShowTpslButton =
            allowTpslButton &&
            (isLineHovered ||
              Boolean(prevTpsl._isHovered) ||
              Boolean(prevTpsl._isDragging))
          if (prevTpsl._isHovered || prevTpsl._isDragging) {
            prevTpsl.onDragging = item.onDragging
            prevTpsl.onFirstDragEnd = item.onFirstDragEnd
            prevTpsl.onEstimateDragEnd = item.onEstimateDragEnd
            prevTpsl.onEstimateClose = item.onEstimateClose
            prevTpsl.onOpenTpslModal =
              item.onOpenEstimateModal ?? item.onOpenTpslModal
            prevTpsl.getEstimateText = item.getEstimateText
            overrideOverlayIfChanged({
              id: overlayIds.tpslButton,
              visible: shouldShowTpslButton,
            })
          } else {
            const tpslExtendData = { ...prevTpsl, ...tpslBase }
            overrideOverlayIfChanged({
              id: overlayIds.tpslButton,
              extendData: tpslExtendData,
              visible: shouldShowTpslButton,
            })
          }
        } else {
          const shouldShowTpslButton = allowTpslButton && isLineHovered
          overrideOverlayIfChanged({
            id: overlayIds.tpslButton,
            extendData: tpslBase,
            visible: shouldShowTpslButton,
          })
        }
      }

      for (const estimateType of [
        TpslEstimateType.TakeProfit,
        TpslEstimateType.StopLoss,
      ]) {
        const isTp = estimateType === TpslEstimateType.TakeProfit
        syncEstimateSide({
          item,
          overlayApi,
          existingOverlayIds,
          overrideOverlayIfChanged,
          labelOffsetX: actionLayout.tpslOffsetX,
          estimateType,
          estimateValue: isPosition
            ? isTp
              ? item.takeProfitValue
              : item.stopLossValue
            : null,
          estimateText: isTp ? item.takeProfitText : item.stopLossText,
          fallbackText: isTp
            ? texts.estimatedProfitText
            : texts.estimatedLossText,
          keepTemporary:
            isPosition &&
            (isTp ? item.keepTemporaryTakeProfit : item.keepTemporaryStopLoss),
          hovered: isLineHovered,
        })
      }
    })
  }, [
    initialized,
    overlayApi,
    data,
    overlayRevision,
    mountOverlayGroup,
    overlayMapRef,
    measureText,
    texts,
    overrideOverlayIfChanged,
    cleanupOverlayState,
    getCloseButtonHandlers,
    setCloseButtonCallback,
    closeHoverRevision,
    lineHoverRevision,
    ensureLineHoverHandler,
  ])
}
