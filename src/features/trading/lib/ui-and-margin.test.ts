import assert from 'node:assert/strict'
import test from 'node:test'
import { classNames } from '../../../../packages/utils/classNames.ts'
import { validateLeverage } from './trading.ts'

test('FameEX 类名合并同时保留 Tailwind 字号和数字色值，覆盖重复字号', () => {
  assert.equal(classNames('text-xs', 'text-1'), 'text-xs text-1')
  assert.equal(classNames('text-body-s', 'text-3'), 'text-body-s text-3')
  assert.equal(classNames('text-sm text-xs'), 'text-xs')
})

test('杠杆只接受市场范围内的整数，逐仓市场不允许全仓', () => {
  for (const value of ['', '0', '-1', '1.5', '41', 'NaN'])
    assert.throws(
      () => validateLeverage(value, true, { maxLeverage: 40 }),
      /整数/,
    )
  assert.equal(validateLeverage('40', true, { maxLeverage: 40 }), 40)
  assert.equal(
    validateLeverage('1', false, { maxLeverage: 20, marginMode: 'noCross' }),
    1,
  )
  for (const market of [
    { maxLeverage: 20, onlyIsolated: true },
    { maxLeverage: 20, marginMode: 'strictIsolated' },
  ])
    assert.throws(() => validateLeverage('2', true, market), /仅支持逐仓/)
})
