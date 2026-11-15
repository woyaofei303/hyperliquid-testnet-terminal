import assert from 'node:assert/strict'
import test from 'node:test'
import { assessCandidate, buildSummaries } from './candidates.ts'
import type { Fill, Observation } from './opportunities.ts'

const now = 1_000_000
const fill = (overrides: Partial<Fill> = {}): Fill => ({
  coin: 'BTC',
  side: 'B',
  px: '60000',
  sz: '1',
  startPosition: '0',
  dir: 'Open Long',
  time: now - 1000,
  oid: 1,
  tid: 1,
  hash: `0x${'1'.repeat(64)}`,
  ...overrides,
})
const observation = (fills: Fill[], position: string): Observation => ({
  address: `0x${'a'.repeat(40)}`,
  startTime: now - 20 * 60_000,
  checkedAt: now,
  positions: { BTC: position, ETH: '0', SOL: '0' },
  fills,
})

test('同账户连续小单合并为一条摘要，新增仓位达到门槛才成为候选', () => {
  const summaries = buildSummaries(
    observation(
      [fill(), fill({ oid: 2, tid: 2, startPosition: '1', time: now - 500 })],
      '2',
    ),
  )
  assert.equal(summaries.length, 1)
  assert.equal(summaries[0].orderCount, 2)
  assert.equal(summaries[0].currentPosition, '2')
  assert.equal(summaries[0].origin, 'open')
  const result = assessCandidate(summaries[0], now)
  assert.equal(result.eligible, true)
  assert.equal(result.recentNotional, '120000')
})

test('近期增仓均价按数量加权，排除过期成交与平旧仓部分', () => {
  const summary = buildSummaries(
    observation(
      [
        fill({ sz: '8', time: now - 300_001, px: '50000' }),
        fill({ startPosition: '8', sz: '1', px: '60000', oid: 2, tid: 2 }),
        fill({ startPosition: '9', sz: '3', px: '64000', oid: 3, tid: 3 }),
      ],
      '12',
    ),
  )[0]
  const result = assessCandidate(summary, now)
  assert.equal(result.recentSize, '4')
  assert.equal(result.averageEntryPrice, '63000')
  const reverse = buildSummaries(
    observation(
      [
        fill({
          startPosition: '-8',
          sz: '9',
          px: '60000',
          dir: 'Short > Long',
        }),
        fill({ startPosition: '1', sz: '3', px: '64000', oid: 2, tid: 2 }),
      ],
      '4',
    ),
  )[0]
  assert.equal(assessCandidate(reverse, now).averageEntryPrice, '63000')
  const cover = buildSummaries(
    observation(
      [fill({ startPosition: '-4', sz: '2', dir: 'Close Short' })],
      '-2',
    ),
  )[0]
  assert.equal(assessCandidate(cover, now).averageEntryPrice, null)
})

test('平仓后重开只保留新持仓段，不拿旧开仓金额补新信号门槛', () => {
  const initial = fill({ sz: '8' })
  const old = buildSummaries(observation([initial], '8'))[0]
  const summary = buildSummaries(
    observation(
      [
        initial,
        fill({
          time: now - 700,
          side: 'A',
          sz: '8',
          startPosition: '8',
          dir: 'Close Long',
          oid: 2,
          tid: 2,
        }),
        fill({ time: now - 500, oid: 3, tid: 3 }),
      ],
      '1',
    ),
  )[0]
  assert.equal(summary.orderCount, 1)
  assert.equal(summary.hasReduction, false)
  assert.notEqual(summary.id, old.id)
  assert.equal(assessCandidate(summary, now).recentNotional, '60000')
  assert.equal(assessCandidate(summary, now).eligible, false)
})

test('反手只统计新方向开出的数量，不把平旧仓金额算入新增仓位', () => {
  const summary = buildSummaries(
    observation(
      [fill({ startPosition: '-8', sz: '9', dir: 'Short > Long' })],
      '1',
    ),
  )[0]
  assert.equal(summary.origin, 'reverse')
  assert.equal(summary.side, 'long')
  assert.equal(assessCandidate(summary, now).recentNotional, '60000')
  assert.equal(assessCandidate(summary, now).eligible, false)
})

test('小额减仓、清算及反复进出会给出明确排除原因', () => {
  const reduced = buildSummaries(
    observation(
      [
        fill({ sz: '8' }),
        fill({
          side: 'A',
          sz: '0.1',
          startPosition: '8',
          dir: 'Close Long',
          oid: 2,
          tid: 2,
          time: now - 500,
        }),
      ],
      '7.9',
    ),
  )[0]
  assert.equal(assessCandidate(reduced, now).eligible, false)
  assert.ok(
    assessCandidate(reduced, now).reasons.includes('本段持仓期间已发生减仓'),
  )
  const liquidation = buildSummaries(
    observation([fill({ sz: '8', liquidation: { method: 'market' } })], '8'),
  )[0]
  assert.ok(assessCandidate(liquidation, now).reasons.includes('包含清算成交'))
  const churn = buildSummaries(
    observation(
      Array.from({ length: 5 }, (_, i) =>
        fill({
          sz: '2',
          startPosition: i % 2 ? '2' : '0',
          side: i % 2 ? 'A' : 'B',
          dir: i % 2 ? 'Close Long' : 'Open Long',
          oid: i + 1,
          tid: i + 1,
          time: now - 1000 + i,
        }),
      ),
      '2',
    ),
  )[0]
  assert.equal(churn.hasReduction, false)
  assert.ok(
    assessCandidate(churn, now).reasons.includes(
      '近 20 分钟至少两次平仓或反手',
    ),
  )
})

test('不能用一笔小加仓刷新旧大额信号，时间流逝也会移出候选', () => {
  const summary = buildSummaries(
    observation(
      [
        fill({ sz: '8', time: now - 300_001 }),
        fill({ startPosition: '8', oid: 2, tid: 2 }),
      ],
      '9',
    ),
  )[0]
  assert.equal(assessCandidate(summary, now).recentNotional, '60000')
  assert.equal(assessCandidate(summary, now).eligible, false)
  const fresh = buildSummaries(observation([fill({ sz: '8' })], '8'))[0]
  assert.equal(assessCandidate(fresh, now).status, '候选')
  assert.equal(assessCandidate(fresh, now + 90_001).status, '待核验')
  assert.equal(assessCandidate(fresh, now, true).eligible, false)
  assert.equal(
    assessCandidate({ ...fresh, checkedAt: now + 300_000 }, now + 300_000)
      .status,
    '仅观察',
  )
})

test('所有成交参与摘要；交错的 TWAP 按父订单计数，不重复计算', () => {
  const summary = buildSummaries(
    observation(
      [
        fill({ twapId: 7 }),
        fill({ startPosition: '1', oid: 7, tid: 2 }),
        fill({ startPosition: '2', oid: 3, tid: 3, twapId: 7 }),
      ],
      '3',
    ),
  )[0]
  assert.equal(summary.orderCount, 2)
  assert.equal(summary.fills.length, 3)
  assert.equal(assessCandidate(summary, now).recentNotional, '180000')
  assert.equal(assessCandidate(summary, now).eligible, true)
})

test('空头加仓可入选，回补空仓及完全退出只观察；链不完整拒绝摘要', () => {
  const short = buildSummaries(
    observation(
      [fill({ side: 'A', startPosition: '-2', sz: '2', dir: 'Open Short' })],
      '-4',
    ),
  )[0]
  assert.equal(short.side, 'short')
  assert.equal(assessCandidate(short, now).eligible, true)
  const cover = buildSummaries(
    observation(
      [fill({ startPosition: '-4', sz: '2', dir: 'Close Short' })],
      '-2',
    ),
  )[0]
  assert.equal(assessCandidate(cover, now).eligible, false)
  const closed = buildSummaries(
    observation(
      [fill({ startPosition: '-2', sz: '2', dir: 'Close Short' })],
      '0',
    ),
  )[0]
  assert.equal(assessCandidate(closed, now).status, '已退出')
  assert.throws(() => buildSummaries(observation([fill()], '99')), /快照不一致/)
})
