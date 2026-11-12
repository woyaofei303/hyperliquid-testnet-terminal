import assert from 'node:assert/strict'
import test from 'node:test'
import type { MarketContext } from '../../../shared/lib/fameex-testnet.ts'
import {
  preparePositionAction,
  protectionPrice,
  protectionReturn,
} from './position-actions.ts'

const market: MarketContext = {
  name: 'BTC',
  asset: 0,
  szDecimals: 5,
  maxLeverage: 40,
  context: {
    markPx: '70000',
    oraclePx: '70000',
    funding: '0',
    openInterest: '1',
    dayNtlVlm: '0',
    prevDayPx: '70000',
    premium: '0',
    impactPxs: null,
    midPx: '70000',
  },
}
test('仓位动作：限价和市价只减仓，反手恰好两倍仓位，移动止损交由交易所执行', () => {
  for (const signed of ['0.01', '-0.01']) {
    for (const kind of ['limit', 'market', 'reverse', 'trailing'] as const) {
      const result = preparePositionAction(market, signed, '70000', {
        kind,
        size: '0.004',
        price: '71000',
        retracement: '5',
        retracementUnit: 'pct',
        activationPrice: '',
      })
      if (result.kind === 'trailing') {
        assert.equal(result.action.reduceOnly, true)
        assert.equal(result.action.isBuy, signed.startsWith('-'))
        assert.deepEqual(result.action.retracement, { pct: '5%' })
      } else if (result.kind === 'orders') {
        assert.equal(result.orders[0].b, signed.startsWith('-'))
        assert.equal(result.orders[0].r, kind !== 'reverse')
        assert.equal(result.orders[0].s, kind === 'reverse' ? '0.02' : '0.004')
      } else assert.fail('类型错误')
    }
  }
  assert.throws(
    () =>
      preparePositionAction(market, '0.01', '70000', {
        kind: 'market',
        size: '0.02',
      }),
    /超过/,
  )
  assert.throws(
    () => preparePositionAction(market, '0', '70000', { kind: 'reverse' }),
    /仓位/,
  )
})
test('止盈止损 ROE 和 USD 双向换算考虑杠杆与多空方向', () => {
  assert.equal(protectionPrice('76938', '0.0013', 20, '10', 'roe'), '77322.69')
  assert.equal(protectionPrice('70000', '-0.01', 10, '20', 'usd'), '68000')
  assert.equal(protectionReturn('70000', '-0.01', 10, '68000', 'usd'), '20')
  assert.equal(protectionReturn('70000', '-0.01', 10, '70700', 'roe'), '-10')
})
