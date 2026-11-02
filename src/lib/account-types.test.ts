import assert from 'node:assert/strict'
import test from 'node:test'
import {
  accountTypeName,
  parseAccountMode,
  sharedAccount,
} from './account-types.ts'

test('账户类型保留默认和旧版状态，只有统一与组合账户共用余额', () => {
  assert.equal(accountTypeName(parseAccountMode('disabled')), '手动')
  assert.equal(accountTypeName(parseAccountMode('default')), '默认')
  assert.equal(
    accountTypeName(parseAccountMode('dexAbstraction')),
    '旧版 DEX 模式',
  )
  assert.equal(sharedAccount('unifiedAccount'), true)
  assert.equal(sharedAccount('portfolioMargin'), true)
  assert.equal(sharedAccount('disabled'), false)
  assert.equal(sharedAccount('default'), false)
  assert.throws(() => parseAccountMode('unknown'))
})
