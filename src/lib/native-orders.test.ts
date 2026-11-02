import assert from 'node:assert/strict'
import test from 'node:test'
import { ApiRequestError } from '@nktkas/hyperliquid/api/exchange'
import { nativeOrderResult } from './native-orders.ts'

test('原生订单只接受对应类型的有效编号，嵌套拒绝不能报成功', () => {
  assert.equal(
    nativeOrderResult(
      { status: 'ok', response: { type: 'trailingStop', data: { oid: 123 } } },
      'trailingStop',
    ),
    123,
  )
  assert.equal(
    nativeOrderResult(
      {
        status: 'ok',
        response: {
          type: 'twapOrder',
          data: { status: { running: { twapId: 456 } } },
        },
      },
      'twapOrder',
    ),
    456,
  )
  assert.throws(
    () =>
      nativeOrderResult(
        {
          status: 'ok',
          response: {
            type: 'twapOrder',
            data: { status: { error: 'Insufficient margin' } },
          },
        },
        'twapOrder',
      ),
    ApiRequestError,
  )
  assert.throws(
    () =>
      nativeOrderResult(
        { status: 'ok', response: { type: 'default' } },
        'trailingStop',
      ),
    /结果待核对/,
  )
})
