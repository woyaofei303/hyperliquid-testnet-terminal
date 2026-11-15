import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildCards,
  cardStatus,
  classify,
  type Fill,
  type Observation,
} from './opportunities.ts'

const fill = (overrides: Partial<Fill> = {}): Fill => ({
  coin: 'BTC',
  side: 'B',
  px: '64500',
  sz: '8',
  startPosition: '0',
  dir: 'Open Long',
  time: 1000,
  oid: 1,
  tid: 1,
  hash: `0x${'1'.repeat(64)}`,
  ...overrides,
})

test('交易标识不是成交顺序；相同毫秒保留接口顺序', () => {
  const cards = buildCards(
    observation(
      [
        fill({ sz: '3', tid: 99 }),
        fill({ sz: '5', startPosition: '3', tid: 1 }),
      ],
      '8',
    ),
  )
  assert.equal(cards[0].after, '8')
})

test('买入回补空仓、卖出减多、加仓、反手及小数归零准确区分', () => {
  for (const [startPosition, side, sz, dir, action] of [
    ['-8', 'B', '3', 'Close Short', 'reduce'],
    ['8', 'A', '3', 'Close Long', 'reduce'],
    ['8', 'B', '3', 'Open Long', 'add'],
    ['-8', 'A', '3', 'Open Short', 'add'],
    ['8', 'A', '10', 'Long > Short', 'reverse'],
    ['-8', 'B', '10', 'Short > Long', 'reverse'],
    ['0.1', 'A', '0.1', 'Close Long', 'close'],
  ] as const)
    assert.equal(
      classify(fill({ startPosition, side, sz, dir })).action,
      action,
    )
  assert.equal(
    buildCards(
      observation(
        [fill({ startPosition: '-8', sz: '3', dir: 'Close Short' })],
        '-5',
      ),
    )[0].status,
    'activity',
  )
})

test('旧开仓即使同向重开也不复活；过期或请求失败立刻待核验', () => {
  const cards = buildCards(
    observation(
      [
        fill(),
        fill({
          side: 'A',
          startPosition: '8',
          sz: '8',
          dir: 'Close Long',
          time: 2000,
          tid: 2,
          oid: 2,
        }),
        fill({ time: 3000, tid: 3, oid: 3 }),
      ],
      '8',
    ),
  )
  const old = cards.find((card) => card.orderKey === 'order:1')
  assert.ok(old)
  assert.equal(old.status, 'exited')
  assert.equal(cardStatus(old, 5001), '已退出')
  assert.equal(cardStatus(old, 96000), '待核验')
  assert.equal(cardStatus(old, 5001, true), '待核验')
})

test('缺失成交、方向冲突和快照不符拒绝生成卡片', () => {
  assert.throws(
    () =>
      buildCards(
        observation(
          [fill(), fill({ startPosition: '9', time: 2000, tid: 2 })],
          '17',
        ),
      ),
    /不连续/,
  )
  assert.throws(() => buildCards(observation([fill()], '9')), /快照不一致/)
  assert.throws(
    () => buildCards(observation([fill({ dir: 'Close Long' })], '8')),
    /方向/,
  )
  assert.throws(() => classify(fill({ px: 'NaN' })), /无效/)
})

test('TWAP 按父订单合并；交错订单及清算不标为仍持有', () => {
  const cards = buildCards(
    observation(
      [
        fill({ sz: '2', twapId: 7 }),
        fill({ sz: '1', startPosition: '2', oid: 2, tid: 2, time: 2000 }),
        fill({
          sz: '2',
          startPosition: '3',
          oid: 3,
          tid: 3,
          time: 3000,
          twapId: 7,
        }),
      ],
      '5',
    ),
  )
  const twap = cards.find((card) => card.orderKey === 'twap:7')
  assert.ok(twap)
  assert.equal(twap.fillCount, 2)
  assert.equal(twap.interleaved, true)
  assert.equal(twap.status, 'activity')
  assert.equal(
    buildCards(
      observation([fill({ liquidation: { method: 'market' } })], '8'),
    )[0].status,
    'activity',
  )
})
const observation = (fills: Fill[], position: string): Observation => ({
  address: `0x${'a'.repeat(40)}`,
  startTime: 0,
  checkedAt: 5000,
  positions: { BTC: position, ETH: '0', SOL: '0' },
  fills,
})

test('碎片开仓合并为一张卡；后续平仓让原开仓卡失效', () => {
  const cards = buildCards(
    observation(
      [
        fill({ sz: '3' }),
        fill({ sz: '5', startPosition: '3', tid: 2 }),
        fill({
          side: 'A',
          sz: '8',
          startPosition: '8',
          dir: 'Close Long',
          time: 3000,
          oid: 2,
          tid: 3,
        }),
      ],
      '0',
    ),
  )
  const opening = cards.find((card) => card.orderKey === 'order:1')
  assert.equal(cards.length, 2)
  assert.equal(opening?.action, 'open')
  assert.equal(opening?.notional, '516000')
  assert.equal(opening?.fillCount, 2)
  assert.equal(opening?.status, 'exited')
  assert.equal(
    cards.find((card) => card.orderKey === 'order:2')?.action,
    'close',
  )
})
