import assert from 'node:assert/strict'
import test from 'node:test'
import { marginDelta, removableMargin } from './isolated-margin.ts'

test('移除保证金同时保留初始保证金和至少 10% 仓位价值，严格逐仓不可移除', () => {
  assert.equal(removableMargin('200', '1000', 20, false), '100')
  assert.equal(removableMargin('200', '1000', 5, false), '0')
  assert.equal(removableMargin('500', '1000', 20, true), '0')
  assert.equal(marginDelta('12.34', '100', 'add'), 12340000)
  assert.equal(marginDelta('12.34', '100', 'remove'), -12340000)
  for (const value of ['0', '-1', '1.001', '101', '1e2'])
    assert.throws(() => marginDelta(value, '100', 'add'))
})
