import { TPSL_OVERLAY_GROUP_PREFIX } from './constants'
import { TpslEstimateType } from './types'

// ─────────────────────────────────────────────────────
// Overlay Template Names
// Used as the `name` field in each OverlayTemplate definition
// ─────────────────────────────────────────────────────
export const TPSL_TEMPLATE_NAMES = {
  area: 'tpsl-area',
  closeButton: 'tpsl-close-button',
  estimateLine: 'tpsl-estimate-line',
  horizontalLine: 'tpsl-horizontal-line',
  limitLabel: 'tpsl-limit-label',
  mainLineHitbox: 'tpsl-main-line-hitbox',
  positionLabel: 'tpsl-position-label',
  priceLabel: 'tpsl-price-label',
  profitLabel: 'tpsl-profit-label',
  tpslButton: 'tpsl-tpsl-button',
  verticalConnector: 'tpsl-vertical-connector',
} as const

export type TpslTemplateName =
  (typeof TPSL_TEMPLATE_NAMES)[keyof typeof TPSL_TEMPLATE_NAMES]

// ─────────────────────────────────────────────────────
// Overlay Instance ID Suffixes
// Used to construct unique overlay IDs per position/order
// ─────────────────────────────────────────────────────
export const TPSL_OVERLAY_PART_SUFFIX = {
  horizontalLineBg: 'horizontal-line-bg',
  horizontalLineSolid: 'horizontal-line-solid',
  limitLabel: 'limit-label',
  priceLabel: 'price-label',
  profitLabel: 'profit-label',
  positionLabel: 'position-label',
  hitboxEnter: 'hitbox-enter',
  hitboxLeave: 'hitbox-leave',
  closeButton: 'close-button',
  tpslButton: 'tpsl-button',
  tpArea: 'tp-area',
  tpLine: 'tp-line',
  slArea: 'sl-area',
  slLine: 'sl-line',
  tpConnector: 'tp-connector',
  slConnector: 'sl-connector',
} as const

export type TpslOverlayPart = keyof typeof TPSL_OVERLAY_PART_SUFFIX

// ─────────────────────────────────────────────────────
// EstimateType → OverlayPart Mappings
// ─────────────────────────────────────────────────────
const ESTIMATE_TYPE_LINE_MAP: Record<TpslEstimateType, TpslOverlayPart> = {
  [TpslEstimateType.TakeProfit]: 'tpLine',
  [TpslEstimateType.StopLoss]: 'slLine',
}

const ESTIMATE_TYPE_AREA_MAP: Record<TpslEstimateType, TpslOverlayPart> = {
  [TpslEstimateType.TakeProfit]: 'tpArea',
  [TpslEstimateType.StopLoss]: 'slArea',
}

const ESTIMATE_TYPE_CONNECTOR_MAP: Record<TpslEstimateType, TpslOverlayPart> = {
  [TpslEstimateType.TakeProfit]: 'tpConnector',
  [TpslEstimateType.StopLoss]: 'slConnector',
}

const DRAG_AREA_SUFFIX: Record<TpslEstimateType, string> = {
  [TpslEstimateType.TakeProfit]: 'takeProfit-area',
  [TpslEstimateType.StopLoss]: 'stopLoss-area',
}

// ─────────────────────────────────────────────────────
// ID Builder Functions
// ─────────────────────────────────────────────────────
// baseId 必须由业务层区分订单/条件单/仓位；manager、模板和弹窗清理共用同一套派生规则。
const buildOverlayId = (baseId: string, suffix: string) => `${baseId}-${suffix}`

export const getTpslGroupId = (baseId: string): string =>
  `${TPSL_OVERLAY_GROUP_PREFIX}-${baseId}`

export const getTpslOverlayId = (
  baseId: string,
  part: TpslOverlayPart,
): string => buildOverlayId(baseId, TPSL_OVERLAY_PART_SUFFIX[part])

export const getTpslOverlayIds = (baseId: string) =>
  Object.entries(TPSL_OVERLAY_PART_SUFFIX).reduce(
    (acc, [part, suffix]) => {
      acc[part as TpslOverlayPart] = buildOverlayId(baseId, suffix)
      return acc
    },
    {} as Record<TpslOverlayPart, string>,
  )

export const getTpslButtonOverlayIds = (baseId: string) => ({
  close: getTpslOverlayId(baseId, 'closeButton'),
  tpsl: getTpslOverlayId(baseId, 'tpslButton'),
  tpConnector: getTpslOverlayId(baseId, 'tpConnector'),
  slConnector: getTpslOverlayId(baseId, 'slConnector'),
})

/** Get the estimate line overlay ID by estimateType */
export const getTpslLineId = (
  baseId: string,
  estimateType: TpslEstimateType,
): string => getTpslOverlayId(baseId, ESTIMATE_TYPE_LINE_MAP[estimateType])

/** manager 根据业务快照维护的正式区域，与拖拽预览区域使用不同 id。 */
export const getTpslAreaId = (
  baseId: string,
  estimateType: TpslEstimateType,
): string => getTpslOverlayId(baseId, ESTIMATE_TYPE_AREA_MAP[estimateType])

/** Get the vertical connector overlay ID by estimateType */
export const getTpslConnectorId = (
  baseId: string,
  estimateType: TpslEstimateType,
): string => getTpslOverlayId(baseId, ESTIMATE_TYPE_CONNECTOR_MAP[estimateType])

/** 拖拽模板创建的预览区域；取消弹窗/删除整组时也要清理，不能只删正式区域。 */
export const getTpslDragAreaId = (
  baseId: string,
  estimateType: TpslEstimateType,
): string => buildOverlayId(baseId, DRAG_AREA_SUFFIX[estimateType])
