import assert from 'node:assert/strict'
import test from 'node:test'
import {
  balanceValues,
  fundingPages,
  historyKey,
  orderStatusLabel,
  recordsCsv,
} from './account-records.ts'

test('账户资产扣除冻结量，预测成本与盈亏用实际总量和报价计算', () => {
  assert.deepEqual(
    balanceValues({ total: '10', hold: '3', entryNtl: '4' }, '0.6'),
    { available: '7', value: '6', entryPrice: '0.4', pnl: '2', roe: '50' },
  )
  assert.equal(
    balanceValues({ total: '10', hold: '3', entryNtl: '0' }, '').value,
    null,
  )
  assert.equal(
    balanceValues({ total: '0', hold: '0', entryNtl: '0' }, '1').entryPrice,
    null,
  )
  assert.throws(
    () => balanceValues({ total: '10', hold: '-1', entryNtl: '0' }, '1'),
    /余额/,
  )
})

test('资金费分页保留同一时间的不同市场，去重重叠区块并拒绝不前进的满页', async () => {
  const row = (time: number, coin: string) => ({
    time,
    hash: '0x0' as const,
    delta: {
      type: 'funding' as const,
      coin,
      usdc: '1',
      szi: '1',
      fundingRate: '0.01',
      nSamples: 1,
    },
  })
  const starts: number[] = []
  const result = await fundingPages(async (start) => {
    starts.push(start)
    return starts.length === 1
      ? Array.from({ length: 500 }, (_, i) => row(i + 1, 'BTC'))
      : [row(500, 'BTC'), row(500, 'ETH'), row(501, 'BTC')]
  }, 0)
  assert.deepEqual(starts, [0, 500])
  assert.equal(result.length, 502)
  await assert.rejects(
    fundingPages(
      async () => Array.from({ length: 500 }, () => row(0, 'BTC')),
      0,
    ),
    /时间范围/,
  )
})
test('历史委托保留同订单不同状态，导出正确引用并防止电子表格公式执行', () => {
  assert.notEqual(historyKey(7, 'open', 1), historyKey(7, 'filled', 2))
  assert.equal(
    orderStatusLabel('outcomeSettledCanceled'),
    '预测已结算，订单取消',
  )
  assert.match(
    recordsCsv(['市场', '值'], [['=HYPERLINK("x")', 'a,b']]),
    /'=HYPERLINK\(""x""\)/,
  )
  assert.match(recordsCsv(['市场', '值'], [['BTC', 'a,b']]), /"a,b"/)
})
