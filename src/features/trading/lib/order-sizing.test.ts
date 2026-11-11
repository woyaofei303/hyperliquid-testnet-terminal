import assert from 'node:assert/strict'
import test from 'node:test'
import {
  amountFromPercent,
  maximumOrderSize,
  sizeFromAmount,
} from './order-sizing.ts'

test('比例换算按最新额度和价格计算，数量向下取整且金额不超预算', () => {
  assert.equal(amountFromPercent('0.5', 50, 'base', '140000', 5), '0.25')
  assert.equal(
    amountFromPercent('0.5', 50, 'usdc', '140000', 5),
    '35000.000000',
  )
  assert.equal(amountFromPercent('24.7326', 50, 'base', '40', 4), '12.3663')
  assert.equal(amountFromPercent('95', 50, 'base', '0.51', 0), '47')
  assert.equal(
    amountFromPercent('0.000019', 100, 'base', '70000', 5),
    '0.00001',
  )
  assert.equal(amountFromPercent('1', 0, 'base', '70000', 5), '0')
  for (const percent of [-1, 101, Number.NaN, Infinity])
    assert.throws(() => amountFromPercent('1', percent, 'base', '70000', 5))
  assert.throws(() => amountFromPercent('-1', 50, 'base', '70000', 5))
  assert.throws(() => amountFromPercent('1', 50, 'usdc', '0', 5))
})

test('USDC 转数量只向下取整，不增加预算；只减仓最大值取反向仓位', () => {
  assert.equal(sizeFromAmount('100', 'usdc', '70000', 5), '0.00142')
  assert.equal(sizeFromAmount('0.001234', 'base', '70000', 5), '0.001234')
  const input = {
    maxTradeSize: '1',
    position: '0.25',
    side: 'sell' as const,
    reduceOnly: true,
    markPrice: '70000',
    orderPrice: '71000',
    precision: 5,
  }
  assert.equal(maximumOrderSize(input), '0.25')
  assert.equal(maximumOrderSize({ ...input, side: 'buy' }), '0')
  assert.equal(maximumOrderSize({ ...input, reduceOnly: false }), '0.98591')
})
