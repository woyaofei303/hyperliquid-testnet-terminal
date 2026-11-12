import assert from 'node:assert/strict'
import test from 'node:test'
import type {
  AccountState,
  OpenOrder,
} from '../../../shared/lib/fameex-testnet.ts'
import {
  assertProtectionUnchanged,
  positionProtections,
  protectionKind,
} from './chart-trading.ts'

const position: AccountState['assetPositions'][number]['position'] = {
  coin: 'BTC',
  szi: '0.01',
  leverage: { type: 'cross', value: 2 },
  entryPx: '70000',
  positionValue: '700',
  unrealizedPnl: '0',
  returnOnEquity: '0',
  liquidationPx: null,
  marginUsed: '350',
  maxLeverage: 40,
  cumFunding: { allTime: '0', sinceChange: '0', sinceOpen: '0' },
}
const order: OpenOrder = {
  coin: 'BTC',
  side: 'A',
  sz: '0',
  origSz: '0',
  limitPx: '63000',
  oid: 10,
  timestamp: 1,
  reduceOnly: true,
  isPositionTpsl: true,
  orderType: 'Take Profit Market',
  triggerPx: '71000',
  triggerCondition: 'Price above 71000',
  isTrigger: true,
  children: [],
  tif: null,
  cloid: null,
}
test('交易线只合并同币种同方向的唯一整仓保护，保留部分仓位及重复保护单', () => {
  assert.equal(protectionKind(order), 'tp')
  assert.deepEqual(positionProtections(position, [order]), { tp: order })
  for (const changed of [
    { ...order, side: 'B' as const },
    { ...order, coin: 'ETH' },
    { ...order, sz: '0.005', origSz: '0.005' },
    { ...order, reduceOnly: false },
  ])
    assert.deepEqual(positionProtections(position, [changed]), {})
  assert.deepEqual(
    positionProtections(position, [order, { ...order, oid: 11 }]),
    {},
  )
  assert.deepEqual(
    positionProtections({ ...position, szi: '-0.01' }, [
      { ...order, side: 'B' },
    ]),
    { tp: { ...order, side: 'B' } },
  )
})
test('修改保护单必须核对订单身份、数量、方向、原价和触发类型', () => {
  assert.doesNotThrow(() =>
    assertProtectionUnchanged(order, { ...order }, 'BTC', '0.01', 'tp'),
  )
  for (const current of [
    undefined,
    { ...order, oid: 11 },
    { ...order, triggerPx: '72000' },
    { ...order, sz: '0.005' },
    { ...order, reduceOnly: false },
    { ...order, orderType: 'Stop Market' as const },
  ])
    assert.throws(() =>
      assertProtectionUnchanged(order, current, 'BTC', '0.01', 'tp'),
    )
  assert.throws(() =>
    assertProtectionUnchanged(order, order, 'ETH', '0.01', 'tp'),
  )
  assert.throws(() =>
    assertProtectionUnchanged(order, order, 'BTC', '-0.01', 'tp'),
  )
  assert.throws(() =>
    assertProtectionUnchanged(order, order, 'BTC', '0.01', 'sl'),
  )
})
