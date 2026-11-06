import assert from 'node:assert/strict'
import test from 'node:test'
import type { Market } from './orders.ts'
import { conversionMaximum, prepareConversion } from './outcome-conversion.ts'

const market: Market = {
  name: '#10',
  kind: 'outcome',
  asset: 100000010,
  outcome: 1,
  question: 8,
  questionOutcomes: [1, 2, 3],
  szDecimals: 0,
  maxLeverage: 1,
  quote: 'USDC',
}
const balances = [
  { coin: 'USDC', token: 0, total: '10', hold: '2', entryNtl: '0' },
  ...[10, 11, 20, 30].map((id, i) => ({
    coin: `+${id}`,
    token: id,
    total: String(5 + i),
    hold: '1',
    entryNtl: '1',
  })),
]
test('转换使用可用余额，合并覆盖后备结果，拒绝小数、超额与无关问题', () => {
  assert.equal(conversionMaximum('splitOutcome', market, balances), '8')
  assert.equal(conversionMaximum('mergeOutcome', market, balances), '4')
  assert.equal(conversionMaximum('mergeQuestion', market, balances), '4')
  assert.equal(conversionMaximum('negateOutcome', market, balances), '5')
  assert.deepEqual(prepareConversion('mergeQuestion', market, '4', balances), {
    mergeQuestion: { question: 8, amount: '4' },
  })
  assert.deepEqual(prepareConversion('negateOutcome', market, '5', balances), {
    negateOutcome: { question: 8, outcome: 1, amount: '5' },
  })
  assert.throws(
    () => prepareConversion('splitOutcome', market, '9', balances),
    /可用/,
  )
  assert.throws(
    () => prepareConversion('splitOutcome', market, '1.5', balances),
    /整数/,
  )
  assert.throws(
    () =>
      prepareConversion(
        'mergeQuestion',
        { ...market, question: undefined },
        '1',
        balances,
      ),
    /问题/,
  )
  assert.throws(
    () =>
      prepareConversion(
        'mergeOutcome',
        { ...market, kind: 'spot' },
        '1',
        balances,
      ),
    /预测/,
  )
})
