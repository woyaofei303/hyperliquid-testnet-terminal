import assert from 'node:assert/strict'
import test from 'node:test'
import { predictionMarkets } from '../../market/lib/market-catalog.ts'
import { cashTicketValue } from './cash-order.ts'
import { defaultOrderFields } from './order-form-fields.ts'
import {
  predictionEstimate,
  predictionFees,
  preparePredictionTicket,
} from './prediction-order.ts'

const market = {
  name: '#120',
  kind: 'outcome' as const,
  asset: 100000120,
  outcome: 12,
  szDecimals: 0,
  maxLeverage: 1,
  context: { markPx: '0.5', prevDayPx: '0.5', dayNtlVlm: '0' },
}
const draft = {
  ...defaultOrderFields(market),
  market,
  mark: '0.5',
  price: '0.3',
  upperPrice: '0.7',
  levels: '3',
  sizeSkew: '2',
  kind: 'scale' as const,
  size: '30',
  amount: '30',
  unit: 'base' as const,
  slippageBps: 800,
}
test('预测分段订单按首尾数量偏差分配，并允许价格从高到低排列', () => {
  const ticket = preparePredictionTicket(draft)
  assert.equal(ticket.kind, 'orders')
  if (ticket.kind !== 'orders') throw new Error('订单类型错误')
  assert.deepEqual(
    ticket.orders.map(({ p, s }) => [p, s]),
    [
      ['0.3', '6'],
      ['0.5', '10'],
      ['0.7', '14'],
    ],
  )
  const reverse = preparePredictionTicket({
    ...draft,
    price: '0.7',
    upperPrice: '0.3',
  })
  if (reverse.kind !== 'orders') throw new Error('订单类型错误')
  assert.deepEqual(
    reverse.orders.map(({ p, s }) => [p, s]),
    [
      ['0.7', '6'],
      ['0.5', '10'],
      ['0.3', '14'],
    ],
  )
})
test('预测分段订单的 USDC 总额按加权价格换算，取整后不超输入金额', () => {
  const ticket = preparePredictionTicket({
    ...draft,
    unit: 'usdc',
    amount: '30',
  })
  if (ticket.kind !== 'orders') throw new Error('订单类型错误')
  assert.deepEqual(
    ticket.orders.map(({ p, s }) => [p, s]),
    [
      ['0.3', '12'],
      ['0.5', '18'],
      ['0.7', '24'],
    ],
  )
  assert.equal(ticket.size, '54')
  assert.equal(cashTicketValue(ticket).toFixed(), '29.4')
})
test('预测买入免费，卖出使用市场费率与用户折扣，拒绝异常元数据', () => {
  const fees = {
    userSpotCrossRate: '0.0007',
    userSpotAddRate: '0.0004',
    activeReferralDiscount: '0',
  }
  const metadata = {
    feeScale: '1',
    questions: [],
    outcomes: [
      {
        outcome: 12,
        name: '示例结果',
        description: '规则',
        quoteToken: 'USDC',
        sideSpecs: [{ name: 'Yes' }, { name: 'No' }],
        deployerFeeScale: '10',
      },
    ],
  }
  const [feeMarket] = predictionMarkets(metadata, [])
  assert.equal(feeMarket.deployerFeeScale, '10')
  assert.equal(feeMarket.feeScale, '1')
  assert.deepEqual(predictionFees(feeMarket, fees, 'buy'), {
    taker: '0',
    maker: '0',
  })
  assert.deepEqual(predictionFees(feeMarket, fees, 'sell'), {
    taker: '0.014',
    maker: '0.008',
  })
  assert.throws(
    () => predictionFees({ ...market, feeScale: '-1' }, fees, 'sell'),
    /费率/,
  )
})

test('预测金额和滑点使用可成交深度；深度不足不显示虚假的完整成交估算', () => {
  assert.deepEqual(
    predictionEstimate('20', [
      { px: '0.5', sz: '10' },
      { px: '0.6', sz: '10' },
    ]),
    { value: '11', slippage: '10.00%' },
  )
  assert.deepEqual(predictionEstimate('20', [{ px: '0.5', sz: '10' }]), {
    value: null,
    slippage: 'N/A',
  })
  assert.deepEqual(predictionEstimate('', []), { value: null, slippage: '0%' })
})
test('预测分段拒绝错误价格、档数、偏差、小数份额和过小的子单', () => {
  for (const invalid of [
    { price: '0' },
    { upperPrice: '1' },
    { price: '0.300001' },
    { levels: '1' },
    { levels: '2.5' },
    { levels: '51' },
    { sizeSkew: '0' },
    { sizeSkew: 'NaN' },
    { amount: '12.5' },
    { amount: '2' },
    { upperPrice: '0.30001', levels: '5' },
  ])
    assert.throws(() => preparePredictionTicket({ ...draft, ...invalid }))
})
