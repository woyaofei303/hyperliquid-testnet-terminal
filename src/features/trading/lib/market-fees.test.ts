import assert from 'node:assert/strict'
import test from 'node:test'
import { marketFees } from './market-fees.ts'

const market = {
  name: 'test:ABC',
  kind: 'perp' as const,
  asset: 110000,
  szDecimals: 2,
  maxLeverage: 3,
  dex: 'test',
}
const fees = {
  userCrossRate: '0.00045',
  userAddRate: '0.00015',
  userSpotCrossRate: '0.0007',
  userSpotAddRate: '0.0004',
  activeReferralDiscount: '0.04',
}

test('普通合约、HIP-3 部署者加成与增长模式使用官方费率公式', () => {
  assert.deepEqual(marketFees({ ...market, dex: undefined }, fees, 'buy'), {
    taker: '0.000432',
    maker: '0.000144',
  })
  assert.deepEqual(
    marketFees({ ...market, deployerFeeScale: '1' }, fees, 'buy'),
    { taker: '0.000864', maker: '0.000288' },
  )
  assert.deepEqual(
    marketFees(
      { ...market, deployerFeeScale: '2', growthMode: 'enabled' },
      fees,
      'buy',
    ),
    { taker: '0.0001728', maker: '0.0000576' },
  )
})

test('稳定币现货折扣、对齐报价币优惠与 maker 返佣不会丢失或重复打折', () => {
  assert.deepEqual(
    marketFees(
      { ...market, kind: 'spot', stablePair: true, alignedQuote: true },
      fees,
      'sell',
    ),
    { taker: '0.00010752', maker: '0.0000768' },
  )
  assert.equal(
    marketFees(
      { ...market, alignedQuote: true, deployerFeeScale: '1' },
      { ...fees, userAddRate: '-0.00001' },
      'buy',
    ).maker,
    '-0.0000125',
  )
})

test('预测买入免费、卖出读取实时 feeScale，缺少费率不能假设已经收费', () => {
  const outcome = {
    ...market,
    kind: 'outcome' as const,
    feeScale: '1',
    deployerFeeScale: '1',
  }
  assert.deepEqual(marketFees(outcome, fees, 'buy'), { taker: '0', maker: '0' })
  assert.deepEqual(marketFees(outcome, fees, 'sell'), {
    taker: '0.001344',
    maker: '0.000768',
  })
  assert.deepEqual(
    marketFees({ ...outcome, feeScale: undefined }, fees, 'sell'),
    { taker: '0', maker: '0' },
  )
  assert.throws(
    () => marketFees({ ...market, deployerFeeScale: 'NaN' }, fees, 'buy'),
    /费率/,
  )
})
