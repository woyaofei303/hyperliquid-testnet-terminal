import assert from 'node:assert/strict'
import test from 'node:test'

test('intentional gate failure; never merge', () => {
  assert.fail('This unmerged drill must fail CI')
})
