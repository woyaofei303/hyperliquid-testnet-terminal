import type { CloseButtonExtendData } from './templates/closeButtonTemplate'
import type { EstimateLineExtendData } from './templates/index'
import type { TpslButtonExtendData } from './templates/tpslButtonTemplate'
import { type TPSLDirection, TpslDirection, TpslEstimateType } from './types'

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const isDirection = (value: unknown): value is TPSLDirection =>
  value === TpslDirection.Long || value === TpslDirection.Short

const isEstimateType = (value: unknown): value is TpslEstimateType =>
  value === TpslEstimateType.TakeProfit || value === TpslEstimateType.StopLoss

export const isCloseButtonExtendData = (
  value: unknown,
): value is CloseButtonExtendData =>
  isObject(value) &&
  typeof value.offsetX === 'number' &&
  typeof value.isLoss === 'boolean'

export const isTpslButtonExtendData = (
  value: unknown,
): value is TpslButtonExtendData =>
  isObject(value) &&
  typeof value.offsetX === 'number' &&
  typeof value.baseId === 'string' &&
  typeof value.mainValue === 'number' &&
  isDirection(value.direction)

export const isEstimateLineExtendData = (
  value: unknown,
): value is EstimateLineExtendData =>
  isObject(value) &&
  typeof value.estimateText === 'string' &&
  typeof value.baseId === 'string' &&
  typeof value.mainValue === 'number' &&
  isDirection(value.direction) &&
  isEstimateType(value.estimateType)

export { isDirection, isEstimateType, isObject as isRecord }
