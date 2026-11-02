import assert from 'node:assert/strict'
import test from 'node:test'
import { maximumOrderSize, sizeFromAmount } from './order-sizing.ts'

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
