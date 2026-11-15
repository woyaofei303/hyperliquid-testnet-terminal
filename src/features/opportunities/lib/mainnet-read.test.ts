import assert from 'node:assert/strict'
import test from 'node:test'
import {
  loadObservation,
  MAINNET_INFO,
  MainnetRateLimit,
  parseQuote,
  parseTrades,
  rankAccounts,
} from './mainnet-read.ts'
import { buildCards } from './opportunities.ts'

const address = `0x${'a'.repeat(40)}`
const seller = `0x${'b'.repeat(40)}`
const trade = {
  coin: 'BTC',
  time: 1000,
  tid: 1,
  px: '65000',
  sz: '2',
  users: [address, seller],
}

test('盘口取完整快照第一档；空侧保留为空，拒绝交叉或无效报价', () => {
  const data = {
    coin: 'BTC',
    time: 1000,
    levels: [[{ px: '60000', sz: '0.5' }], [{ px: '60001', sz: '0.3' }]],
  }
  const quote = parseQuote(data, 1100)
  assert.deepEqual(quote.bid, { px: '60000', sz: '0.5' })
  assert.deepEqual(quote.ask, { px: '60001', sz: '0.3' })
  assert.equal(quote.receivedAt, 1100)
  assert.equal(
    parseQuote({ ...data, levels: [[], data.levels[1]] }, 1100).bid,
    null,
  )
  assert.throws(
    () =>
      parseQuote({ ...data, levels: [data.levels[1], data.levels[0]] }, 1100),
    /交叉/,
  )
  assert.throws(() =>
    parseQuote({ ...data, levels: [[{ px: 'NaN', sz: '1' }], []] }, 1100),
  )
  assert.throws(() =>
    parseQuote({ ...data, levels: [[{ px: '1', sz: '0' }], []] }, 1100),
  )
  assert.throws(() => parseQuote({ ...data, time: 20000 }, 1100), /时间/)
  assert.throws(() => parseQuote({ ...data, coin: 'UNKNOWN' }, 1100), /币种/)
})

test('公开成交去重后发现双边账户；旧数据与无效地址不参与发现', () => {
  const rows = parseTrades([trade])
  assert.deepEqual(rankAccounts([...rows, ...rows], 2000), [
    { address, notional: 130000 },
    { address: seller, notional: 130000 },
  ])
  assert.deepEqual(rankAccounts(rows, 400000), [])
  assert.throws(() => parseTrades([{ ...trade, users: ['bad', seller] }]))
})

test('主网只读请求以仓位时间截断，补回 TWAP 后可核验仓位', async (t) => {
  const checkedAt = Date.now()
  const calls: Record<string, unknown>[] = []
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    assert.equal(url, MAINNET_INFO)
    const body = JSON.parse(String(init.body))
    calls.push(body)
    const fill = {
      ...trade,
      side: 'B',
      startPosition: '0',
      time: checkedAt - 100,
      oid: 7,
      dir: 'Open Long',
      hash: `0x${'0'.repeat(64)}`,
    }
    const data =
      body.type === 'clearinghouseState'
        ? {
            time: checkedAt,
            assetPositions: [{ position: { coin: 'BTC', szi: '2' } }],
          }
        : body.type === 'userFillsByTime'
          ? []
          : [{ fill, twapId: 19 }]
    return Response.json(data)
  })
  const result = await loadObservation(address, new AbortController().signal)
  assert.equal(result.checkedAt, checkedAt)
  assert.equal(buildCards(result)[0].orderKey, 'twap:19')
  assert.deepEqual(
    calls.map((call) => call.type),
    ['clearinghouseState', 'userFillsByTime', 'userTwapSliceFillsByTime'],
  )
  assert.ok(calls.slice(1).every((call) => call.endTime === checkedAt))
})

test('满页且相同毫秒无法推进时拒绝不完整历史', async (t) => {
  const now = Date.now()
  const bodies: Record<string, unknown>[] = []
  t.mock.method(
    globalThis,
    'fetch',
    async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body))
      bodies.push(body)
      if (body.type === 'clearinghouseState')
        return Response.json({ time: now, assetPositions: [] })
      return Response.json(
        Array.from({ length: 2000 }, (_, tid) => ({
          ...trade,
          time: now - 100,
          tid,
          oid: 1,
          side: 'B',
          dir: 'Open Long',
          startPosition: String(tid * 2),
          hash: '0x0',
        })),
      )
    },
  )
  await assert.rejects(
    loadObservation(address, new AbortController().signal),
    /分页上限/,
  )
  assert.equal(bodies[2].startTime, now - 100)
})

test('已核验快照后只拉增量，同毫秒重叠去重并保留 TWAP 归属', async (t) => {
  const now = Date.now()
  let round = 0
  const calls: Record<string, unknown>[] = []
  const opening = {
    ...trade,
    time: now - 30000,
    side: 'B',
    startPosition: '0',
    oid: 7,
    dir: 'Open Long',
    hash: '0x0',
  }
  const adding = {
    ...opening,
    time: now - 100,
    startPosition: '2',
    sz: '1',
    tid: 2,
    oid: 8,
  }
  t.mock.method(
    globalThis,
    'fetch',
    async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body))
      calls.push(body)
      return Response.json(
        body.type === 'clearinghouseState'
          ? {
              time: round ? now : now - 30000,
              assetPositions: [
                { position: { coin: 'BTC', szi: round ? '3' : '2' } },
              ],
            }
          : body.type === 'userFillsByTime'
            ? round
              ? [opening, adding]
              : [opening]
            : round
              ? []
              : [
                  {
                    fill: { ...opening, liquidation: { method: 'market' } },
                    twapId: 19,
                  },
                ],
      )
    },
  )
  const signal = new AbortController().signal
  const first = await loadObservation(address, signal)
  round = 1
  const next = await loadObservation(address, signal, first)
  assert.equal(next.fills.length, 2)
  assert.equal(next.fills[0].twapId, 19)
  assert.deepEqual(next.fills[0].liquidation, { method: 'market' })
  assert.equal(next.startTime, now - 20 * 60000)
  assert.ok(calls.slice(4).every((call) => call.startTime === first.checkedAt))
  assert.equal(buildCards(next)[0].currentPosition, '3')
  round = 0
  const conflict = {
    ...first,
    fills: first.fills.map((fill) => ({ ...fill, twapId: 20 })),
  }
  await assert.rejects(loadObservation(address, signal, conflict), /归属冲突/)
})

test('过期快照、HTTP 错误与取消请求不会生成观察结果', async (t) => {
  const mock = t.mock.method(globalThis, 'fetch', async () =>
    Response.json({ time: Date.now() - 100000, assetPositions: [] }),
  )
  await assert.rejects(
    loadObservation(address, new AbortController().signal),
    /过期/,
  )
  mock.mock.mockImplementation(async () => new Response('', { status: 429 }))
  await assert.rejects(
    loadObservation(address, new AbortController().signal),
    /429/,
  )
  mock.mock.mockImplementation(async (_url, init) => {
    init?.signal?.throwIfAborted()
    return Response.json({})
  })
  const abort = new AbortController()
  abort.abort()
  await assert.rejects(loadObservation(address, abort.signal), {
    name: 'AbortError',
  })
})

test('429 提供冷却截止时间，支持 Retry-After 秒数和日期，不在请求内部重试', async (t) => {
  const now = Date.now()
  t.mock.method(Date, 'now', () => now)
  const mock = t.mock.method(
    globalThis,
    'fetch',
    async () =>
      new Response('', { status: 429, headers: { 'retry-after': '120' } }),
  )
  await assert.rejects(
    loadObservation(address, new AbortController().signal),
    (error) =>
      error instanceof MainnetRateLimit && error.retryAt === now + 120000,
  )
  assert.equal(mock.mock.callCount(), 1)
  for (const header of [
    null,
    'invalid',
    '-1',
    new Date(now + 180000).toUTCString(),
  ]) {
    const error = new MainnetRateLimit(header)
    assert.ok(error.retryAt >= now + 60000)
  }
})

test('快照倒退不能复用缓存，过期或其他账户缓存退回完整窗口', async (t) => {
  const now = Date.now()
  const bodies: Record<string, unknown>[] = []
  t.mock.method(
    globalThis,
    'fetch',
    async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body))
      bodies.push(body)
      return Response.json(
        body.type === 'clearinghouseState'
          ? { time: now, assetPositions: [] }
          : [],
      )
    },
  )
  const previous = {
    address,
    checkedAt: now + 1,
    startTime: now - 20 * 60000,
    positions: { BTC: '0', ETH: '0', SOL: '0' },
    fills: [],
  }
  await assert.rejects(
    loadObservation(address, new AbortController().signal, previous),
    /倒退/,
  )
  for (const prior of [
    { ...previous, address: seller },
    { ...previous, checkedAt: now - 21 * 60000 },
  ]) {
    bodies.length = 0
    await loadObservation(address, new AbortController().signal, prior)
    assert.ok(
      bodies.slice(1).every((body) => body.startTime === now - 20 * 60000),
    )
  }
  await assert.rejects(
    loadObservation(address, new AbortController().signal, {
      ...previous,
      checkedAt: now,
      fills: Array.from({ length: 10001 }, (_, tid) => ({
        coin: 'BTC',
        side: 'B',
        time: now - 1,
        tid,
        oid: tid,
        sz: '1',
        px: '60000',
        startPosition: String(tid),
        dir: 'Open Long',
        hash: '0x0',
      })),
    }),
    /本机核验上限/,
  )
})

test('Retry-After 超出浏览器日期范围时回退一分钟，不生成不可展示的存档', (t) => {
  const now = Date.now()
  t.mock.method(Date, 'now', () => now)
  const error = new MainnetRateLimit('8800000000000')
  assert.equal(error.retryAt, now + 60000)
  assert.doesNotThrow(() =>
    new Intl.DateTimeFormat('zh-CN').format(error.retryAt),
  )
})
