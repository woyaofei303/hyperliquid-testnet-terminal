import assert from 'node:assert/strict'
import test from 'node:test'
import {
  AbstractWalletError,
  CanonicalizeError,
} from '@nktkas/hyperliquid/signing'
import {
  isOrderNotSent,
  marketOrderPrice,
  marketReferencePrice,
  OrderNotSentError,
  orderResult,
  prepareOrder,
  slippageBps,
} from './orders.ts'

test('市价参考盘口中间价，单边盘口回退标记价', () => {
  assert.equal(
    marketReferencePrice(
      { levels: [[{ px: '19.99' }], [{ px: '20.01' }]] },
      '21',
    ),
    '20',
  )
  assert.equal(
    marketReferencePrice({ levels: [[{ px: '19.99' }], []] }, '21'),
    '21',
  )
  assert.equal(marketReferencePrice(null, '21'), '21')
  assert.throws(() =>
    marketReferencePrice({ levels: [[{ px: 'NaN' }], [{ px: '20' }]] }, '21'),
  )
})

test('滑点设置保留价格保护范围，并拒绝小于一个基点的精度', () => {
  assert.equal(slippageBps('0.01'), 1)
  assert.equal(slippageBps('0.5'), 50)
  assert.equal(slippageBps('10'), 1000)
  assert.equal(slippageBps('0'), 0)
  assert.equal(slippageBps('100'), 10000)
  for (const value of ['', '-1', '0.001', '100.01', 'Infinity'])
    assert.throws(() => slippageBps(value))
})

test('官方市价卖出普通资产最多使用 70% 价格折扣，预测价格仍限制在有效区间', () => {
  const market = { name: 'BTC', asset: 3, szDecimals: 5, maxLeverage: 40 }
  assert.equal(marketOrderPrice('70000', market, 'sell', 10000), '21000')
  assert.equal(
    marketOrderPrice(
      '0.5',
      { ...market, kind: 'outcome', szDecimals: 0 },
      'sell',
      10000,
    ),
    '0.00001',
  )
})

test('用户输入超过市场数量精度时，在签名前拒绝下单', () => {
  assert.throws(
    () =>
      prepareOrder({
        market: { name: 'BTC', asset: 0, szDecimals: 5, maxLeverage: 40 },
        side: 'buy',
        kind: 'limit',
        price: '70000',
        size: '0.000001',
        reduceOnly: false,
        slippageBps: 50,
      }),
    /数量精度/,
  )
})

test('开仓不足 10 USDC 时拒绝，不能用低精度浮点数绕过金额下限', () => {
  assert.throws(
    () =>
      prepareOrder({
        market: { name: 'ETH', asset: 1, szDecimals: 4, maxLeverage: 25 },
        side: 'buy',
        kind: 'limit',
        price: '2000',
        size: '0.0049',
        reduceOnly: false,
        slippageBps: 50,
      }),
    /10 USDC/,
  )
})

test('市场单使用带滑点边界的 IOC，价格按官方规则向下取到有效报价', () => {
  const order = prepareOrder({
    market: { name: 'ETH', asset: 1, szDecimals: 4, maxLeverage: 25 },
    side: 'sell',
    kind: 'market',
    price: '3210.45',
    size: '0.01',
    reduceOnly: true,
    slippageBps: 50,
  })
  assert.equal(order.t.limit.tif, 'Ioc')
  assert.equal(order.p, '3194.3')
  assert.equal(order.r, true)
})

test('HTTP 和外层状态成功但单笔订单拒绝时，必须呈现拒单', () => {
  const result = orderResult(
    {
      status: 'ok',
      response: {
        type: 'order',
        data: { statuses: [{ error: 'Insufficient margin' }] },
      },
    },
    '1',
  )
  assert.equal(result.state, 'rejected')
  assert.match(result.message, /Insufficient margin/)
})

test('IOC 只成交一部分时不能宣称全部成交', () => {
  const result = orderResult(
    {
      status: 'ok',
      response: {
        type: 'order',
        data: {
          statuses: [
            { filled: { totalSz: '0.0005', avgPx: '70000', oid: 42 } },
          ],
        },
      },
    },
    '0.001',
  )
  assert.equal(result.state, 'partial')
  assert.equal(result.oid, 42)
})

test('价格精度校验允许六位整数，但拒绝超出有效数字的非整数', () => {
  const input = {
    market: { name: 'ETH', asset: 4, szDecimals: 4, maxLeverage: 25 },
    side: 'buy' as const,
    kind: 'limit' as const,
    price: '123456',
    size: '1',
    reduceOnly: false,
    slippageBps: 50,
  }
  assert.equal(prepareOrder(input).p, '123456')
  assert.throws(
    () => prepareOrder({ ...input, price: '1234.56' }),
    /价格不符合/,
  )
})

test('只减仓允许低于开仓最小金额的尾仓，且不更改市场真实索引', () => {
  const result = prepareOrder({
    market: { name: 'BTC', asset: 3, szDecimals: 5, maxLeverage: 40 },
    side: 'sell',
    kind: 'limit',
    price: '70000',
    size: '0.00001',
    reduceOnly: true,
    slippageBps: 50,
  })
  assert.equal(result.a, 3)
  assert.equal(result.r, true)
  assert.equal(result.s, '0.00001')
})

test('拒绝负数、NaN、指数、空输入和零数量', () => {
  for (const size of ['-1', 'NaN', '1e3', '', '0', 'Infinity']) {
    assert.throws(() =>
      prepareOrder({
        market: { name: 'BTC', asset: 3, szDecimals: 5, maxLeverage: 40 },
        side: 'buy',
        kind: 'limit',
        price: '70000',
        size,
        reduceOnly: false,
        slippageBps: 50,
      }),
    )
  }
})

test('只将明确发送前错误归为未发送，网络和未知异常保留核对保护', () => {
  assert.equal(isOrderNotSent(new OrderNotSentError('本地序号失败')), true)
  assert.equal(isOrderNotSent(new AbstractWalletError('wallet failed')), true)
  assert.equal(isOrderNotSent(new CanonicalizeError('invalid payload')), true)
  assert.equal(isOrderNotSent(new Error('network timeout')), false)
  assert.equal(isOrderNotSent(new Error('invalid response')), false)
  assert.equal(isOrderNotSent({ name: 'AbstractWalletError' }), false)
})
