import assert from 'node:assert/strict'
import test from 'node:test'
import { chasePrice, prepareTicket, type TicketInput } from './order-ticket.ts'
import { Money } from './orders.ts'

const input: TicketInput = {
  market: { name: 'BTC', asset: 3, szDecimals: 5, maxLeverage: 40 },
  side: 'buy',
  kind: 'limit',
  price: '70000',
  mark: '70000',
  size: '0.03',
  reduceOnly: false,
  slippageBps: 50,
  tif: 'Gtc',
  trigger: '71000',
  takeProfit: '',
  stopLoss: '',
  upperPrice: '73000',
  levels: '3',
  distribution: 'equal',
  minutes: '30',
  randomize: true,
  twapTrigger: '',
  twapAbove: true,
  twapLimit: '',
  retracement: '1',
  retracementUnit: 'pct',
  activationPrice: '',
}
test('限价有效方式与四种条件单分别使用正确 wire 类型', () => {
  const limit = prepareTicket({ ...input, tif: 'Alo' })
  assert.equal(limit.kind, 'orders')
  if (limit.kind !== 'orders') throw new Error('订单类型错误')
  assert.deepEqual(limit.orders[0].t, { limit: { tif: 'Alo' } })
  for (const kind of [
    'stop-market',
    'stop-limit',
    'take-market',
    'take-limit',
  ] as const) {
    const ticket = prepareTicket({
      ...input,
      kind,
      trigger: kind.startsWith('stop') ? '71000' : '69000',
    })
    if (ticket.kind !== 'orders') throw new Error('订单类型错误')
    const t = ticket.orders[0].t
    assert.ok('trigger' in t)
    assert.equal(t.trigger.isMarket, kind.endsWith('market'))
    assert.equal(t.trigger.tpsl, kind.startsWith('stop') ? 'sl' : 'tp')
  }
  assert.throws(
    () => prepareTicket({ ...input, kind: 'stop-market', trigger: '69000' }),
    /高于/,
  )
})
test('附带 TP/SL 反向只减仓，并与父订单按 normalTpsl 分组', () => {
  const ticket = prepareTicket({
    ...input,
    takeProfit: '72000',
    stopLoss: '68000',
  })
  if (ticket.kind !== 'orders') throw new Error('订单类型错误')
  assert.equal(ticket.grouping, 'normalTpsl')
  assert.equal(ticket.orders.length, 3)
  assert.equal(ticket.orders[1].b, false)
  assert.equal(ticket.orders[2].r, true)
  assert.throws(
    () => prepareTicket({ ...input, reduceOnly: true, takeProfit: '72000' }),
    /只减仓/,
  )
})
test('阶梯分配保持总数量，每档遵循价格和数量精度，拒绝不足最小金额', () => {
  for (const distribution of ['equal', 'increasing', 'decreasing'] as const) {
    const ticket = prepareTicket({
      ...input,
      kind: 'scale',
      size: '0.03101',
      distribution,
    })
    if (ticket.kind !== 'orders') throw new Error('订单类型错误')
    assert.equal(
      ticket.orders
        .reduce((sum, order) => sum.plus(order.s), new Money(0))
        .toFixed(),
      '0.03101',
    )
    assert.deepEqual(
      ticket.orders.map((order) => order.p),
      ['70000', '71500', '73000'],
    )
  }
  assert.throws(
    () => prepareTicket({ ...input, kind: 'scale', size: '0.0003' }),
    /10 USDC/,
  )
  assert.throws(
    () => prepareTicket({ ...input, kind: 'scale', levels: '1' }),
    /档数/,
  )
})
test('TWAP 校验 5 分钟到 7 天、100 USDC，并保留触发/成交价边界', () => {
  const ticket = prepareTicket({
    ...input,
    kind: 'twap',
    minutes: '10080',
    twapTrigger: '71000',
    twapLimit: '72000',
  })
  if (ticket.kind !== 'twap') throw new Error('订单类型错误')
  assert.equal(ticket.action.twap.m, 10080)
  assert.equal(ticket.action.twap.a, 3)
  assert.deepEqual(ticket.action.details, {
    t: { p: '71000', a: true },
    s: '72000',
  })
  assert.throws(
    () => prepareTicket({ ...input, kind: 'twap', minutes: '10081' }),
    /7 天/,
  )
  assert.throws(
    () => prepareTicket({ ...input, kind: 'twap', size: '0.001' }),
    /100 USDC/,
  )
})
test('移动止损生成原生 trailingStop，追价不会跨过对手价或用户限价', () => {
  const ticket = prepareTicket({
    ...input,
    kind: 'trailing',
    retracement: '1.25',
  })
  if (ticket.kind !== 'trailing') throw new Error('订单类型错误')
  assert.deepEqual(ticket.action.retracement, { pct: '1.25%' })
  assert.equal(
    chasePrice('70000', '70002', true, '70010', { szDecimals: 5 }),
    '70001',
  )
  assert.equal(
    chasePrice('70000', '70001', true, '70010', { szDecimals: 5 }),
    '70000',
  )
  assert.equal(
    chasePrice('70000', '70003', false, '70002', { szDecimals: 5 }),
    '70002',
  )
  assert.throws(
    () => prepareTicket({ ...input, kind: 'trailing', retracement: '100' }),
    /100%/,
  )
})

test('仓位保护按最新仓位数量反向只减仓，拒绝空仓与错误触发方向', async () => {
  const { preparePositionProtection } = await import('./order-ticket.ts')
  const ticket = preparePositionProtection(
    input.market,
    '70000',
    '0.01',
    '72000',
    '68000',
  )
  assert.equal(ticket.kind, 'orders')
  if (ticket.kind !== 'orders') throw new Error('类型错误')
  assert.equal(ticket.grouping, 'positionTpsl')
  assert.ok(
    ticket.orders.every((order) => !order.b && order.r && order.s === '0.01'),
  )
  assert.throws(
    () => preparePositionProtection(input.market, '70000', '0', '72000', ''),
    /仓位/,
  )
  assert.throws(
    () => preparePositionProtection(input.market, '70000', '0.01', '69000', ''),
    /高于/,
  )
})
