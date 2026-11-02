import { ApiRequestError } from '@nktkas/hyperliquid/api/exchange'

export function nativeOrderResult(
  value: unknown,
  expected: 'twapOrder' | 'trailingStop',
) {
  if (
    !value ||
    typeof value !== 'object' ||
    !('status' in value) ||
    !('response' in value)
  )
    throw new Error('交易回报格式异常，结果待核对')
  if (value.status === 'err') throw new ApiRequestError(value)
  const response = value.response
  if (
    value.status !== 'ok' ||
    !response ||
    typeof response !== 'object' ||
    !('type' in response) ||
    response.type !== expected ||
    !('data' in response) ||
    !response.data ||
    typeof response.data !== 'object'
  )
    throw new Error('未收到对应订单类型的回报，结果待核对')
  const data = response.data
  if (
    expected === 'trailingStop' &&
    'oid' in data &&
    typeof data.oid === 'number' &&
    Number.isSafeInteger(data.oid) &&
    data.oid >= 0
  )
    return data.oid
  if ('status' in data && data.status && typeof data.status === 'object') {
    if ('error' in data.status) throw new ApiRequestError(value)
    if (
      'running' in data.status &&
      data.status.running &&
      typeof data.status.running === 'object' &&
      'twapId' in data.status.running &&
      typeof data.status.running.twapId === 'number' &&
      Number.isSafeInteger(data.status.running.twapId) &&
      data.status.running.twapId >= 0
    )
      return data.status.running.twapId
  }
  throw new Error('未收到订单编号，结果待核对，请勿重复提交')
}
