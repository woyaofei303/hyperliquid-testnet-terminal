import assert from 'node:assert/strict'
import test from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import type { KLineData } from 'klinecharts'
import type {
  Bar,
  ResolutionString,
} from '../../public/lib/charting_library/charting_library'
import { chartBars, chartPeriods, createChartFeed } from './chart-feed.ts'
import { candleHistoryStart } from './chart-periods.ts'
import type { Candle } from './market-data.ts'

const time = Math.floor(Date.now() / 300000) * 300000 - 300000
const candle = (t = time, close = '101'): Candle => ({
  t,
  T: t + 299999,
  s: 'BTC',
  i: '5m',
  o: '100',
  h: '102',
  l: '99',
  c: close,
  v: '2',
  n: 1,
})
const source = (history: (start: number, end: number) => Promise<Candle[]>) =>
  createChartFeed({
    coin: 'BTC',
    interval: '5m',
    szDecimals: 5,
    history,
    onError() {},
    onLoaded() {},
  })

test('图表仅接受当前币种/周期的有效 OHLCV，排序去重并保留毫秒', () => {
  const bars = chartBars(
    [
      candle(),
      candle(time - 300000),
      candle(time, '102'),
      { ...candle(), s: 'ETH' },
      { ...candle(), i: '1m' },
      { ...candle(time + 300000), c: 'NaN' },
      { ...candle(time + 600000), h: '90' },
    ],
    'BTC',
    '5m',
  )
  assert.equal(bars.length, 2)
  assert.equal(bars[0].time, time - 300000)
  assert.equal(bars[1].close, 102)
})

test('历史晚到不覆盖实时更新；历史和实时顺序正确；退订和销毁隔离旧回调', async () => {
  const pending = Promise.withResolvers<Candle[]>()
  const feed = source(() => pending.promise)
  const received: Bar[] = []
  const resolved = Promise.withResolvers<Bar[]>()
  feed.tradingView.getBars(
    feed.symbolInfo,
    '5' as ResolutionString,
    {
      from: (time - 300000) / 1000,
      to: (time + 300000) / 1000,
      countBack: 2,
      firstDataRequest: true,
    },
    (bars) => resolved.resolve(bars),
    (e) => resolved.reject(e),
  )
  feed.update([candle(time, '102')])
  pending.resolve([candle(time - 300000), candle(time)])
  const bars = await resolved.promise
  assert.equal(bars.at(-1)?.close, 102)
  feed.tradingView.subscribeBars(
    feed.symbolInfo,
    '5' as ResolutionString,
    (bar) => received.push(bar),
    'tv',
    () => {},
  )
  await delay(10)
  feed.update([candle(time - 300000), candle(time + 300000)])
  await delay(10)
  assert.deepEqual(
    received.map((b) => b.time),
    [time, time + 300000],
  )
  feed.tradingView.unsubscribeBars('tv')
  feed.update([candle(time + 600000)])
  await delay(10)
  assert.equal(received.length, 2)
  feed.dispose()
  feed.tradingView.resolveSymbol(
    'BTC',
    () => assert.fail('disposed callback'),
    () => assert.fail('disposed error'),
  )
  await delay(10)
})

test('KLineChart 翻页排除右边界，转换毫秒时间且失败会完成回调', async () => {
  let end = 0
  const feed = source(async (_start, to) => {
    end = to
    return [candle(time - 300000), candle()]
  })
  await feed.kline.getBars({
    type: 'forward',
    timestamp: time,
    symbol: { ticker: 'BTC', pricePrecision: 1, volumePrecision: 5 },
    period: chartPeriods['5m'],
    callback(bars) {
      assert.equal(bars.length, 1)
      assert.equal(bars[0].timestamp, time - 300000)
    },
  })
  assert.equal(end, time - 1)
  feed.dispose()
  let completed = false
  const failed = source(async () => {
    throw new Error('offline')
  })
  await failed.kline.getBars({
    type: 'init',
    timestamp: null,
    symbol: { ticker: 'BTC', pricePrecision: 1, volumePrecision: 5 },
    period: chartPeriods['5m'],
    callback(bars, more) {
      completed = true
      assert.deepEqual(bars, [])
      assert.equal(more, false)
    },
  })
  assert.equal(completed, true)
  failed.dispose()
})

test('切换市场复用 datafeed，旧历史与旧实时回调不污染新市场', async () => {
  const pending = Promise.withResolvers<Candle[]>()
  const feed = source(() => pending.promise)
  const kline = feed.kline
  const tv = feed.tradingView
  let oldCalls = 0
  const oldHistory = feed.kline.getBars({
    type: 'init',
    timestamp: null,
    symbol: { ticker: 'BTC', pricePrecision: 1, volumePrecision: 5 },
    period: chartPeriods['5m'],
    callback() {
      oldCalls++
    },
  })
  feed.tradingView.subscribeBars(
    feed.symbolInfo,
    '5' as ResolutionString,
    () => oldCalls++,
    'old',
    () => {},
  )
  feed.select({
    coin: 'ETH',
    interval: '1m',
    szDecimals: 4,
    history: async () => [{ ...candle(), s: 'ETH', i: '1m' }],
    onError() {},
    onLoaded() {},
  })
  pending.resolve([candle()])
  await oldHistory
  const received = Promise.withResolvers<Bar[]>()
  feed.tradingView.getBars(
    feed.symbolInfo,
    '1' as ResolutionString,
    {
      from: (time - 60000) / 1000,
      to: (time + 60000) / 1000,
      countBack: 2,
      firstDataRequest: true,
    },
    received.resolve,
    received.reject,
  )
  assert.equal((await received.promise)[0].close, 101)
  feed.update([{ ...candle(), s: 'ETH', i: '1m' }])
  await delay(10)
  assert.equal(oldCalls, 0)
  assert.equal(feed.kline, kline)
  assert.equal(feed.tradingView, tv)
  assert.equal(feed.symbolInfo.ticker, 'ETH')
  feed.dispose()
})

test('TradingView 切币后结束旧历史请求，不能让引擎永久等待', async () => {
  const pending = Promise.withResolvers<Candle[]>()
  const feed = source(() => pending.promise)
  const settled = Promise.withResolvers<string>()
  feed.tradingView.getBars(
    feed.symbolInfo,
    '5' as ResolutionString,
    {
      from: (time - 300000) / 1000,
      to: (time + 300000) / 1000,
      countBack: 2,
      firstDataRequest: true,
    },
    () => settled.reject(new Error('旧 BTC 数据不能送进 ETH 图表')),
    settled.resolve,
  )
  feed.select({
    coin: 'ETH',
    interval: '1m',
    szDecimals: 4,
    history: async () => [],
    onError() {},
    onLoaded() {},
  })
  pending.resolve([candle()])
  assert.match(await settled.promise, /已变更/)
  feed.dispose()
})

test('只更新市场展示名不清空订阅，也不丢弃未完成的历史查询', async () => {
  const pending = Promise.withResolvers<Candle[]>()
  const context = {
    coin: 'BTC',
    interval: '5m' as const,
    szDecimals: 5,
    history: () => pending.promise,
    onLoaded() {},
    onError() {},
  }
  const feed = createChartFeed(context)
  const result = Promise.withResolvers<Bar[]>()
  feed.tradingView.getBars(
    feed.symbolInfo,
    '5' as ResolutionString,
    {
      from: (time - 300000) / 1000,
      to: (time + 300000) / 1000,
      countBack: 2,
      firstDataRequest: true,
    },
    result.resolve,
    result.reject,
  )
  assert.equal(feed.select({ ...context, label: 'BTC / USDC 永续' }), false)
  pending.resolve([candle()])
  assert.equal((await result.promise).length, 1)
  assert.equal(feed.symbolInfo.description, 'BTC / USDC 永续')
  feed.dispose()
})

test('TradingView 历史请求按 300 根窗口分页，满足 countBack 且不重复右边界', async () => {
  const requests: [number, number][] = []
  const feed = source(async (start, end) => {
    requests.push([start, end])
    const rows: Candle[] = []
    for (let t = start; t <= end; t += 300000) rows.push(candle(t))
    return rows
  })
  const result = Promise.withResolvers<Bar[]>()
  feed.tradingView.getBars(
    feed.symbolInfo,
    '5' as ResolutionString,
    {
      from: (time - 649 * 300000) / 1000,
      to: (time + 300000) / 1000,
      countBack: 650,
      firstDataRequest: true,
    },
    result.resolve,
    result.reject,
  )
  const bars = await result.promise
  assert.equal(requests.length, 3)
  assert.ok(requests.every(([start, end]) => end - start + 1 === 300 * 300000))
  assert.equal(bars.length, 900)
  assert.equal(new Set(bars.map((b) => b.time)).size, bars.length)
  assert.equal(bars.at(-1)?.time, time)
  feed.dispose()
})

test('恢复历史时缓冲实时更新，并让图表重载复用校准后的蜡烛', async () => {
  const pending = Promise.withResolvers<Candle[]>()
  let requests = 0
  const feed = source(() => {
    requests++
    return pending.promise
  })
  const recovery = feed.recover(time - 300000, time + 600000)
  assert.equal(feed.recover(time - 300000, time + 600000), recovery)
  feed.update([{ ...candle(time, '104'), h: '104' }])
  pending.resolve([candle(time - 300000), { ...candle(time, '103'), h: '103' }])

  const result = await recovery
  assert.equal(result.complete, true)
  const requestCount = requests
  const barsPromise = Promise.withResolvers<Bar[]>()
  feed.tradingView.getBars(
    feed.symbolInfo,
    '5' as ResolutionString,
    {
      from: (time - 300000) / 1000,
      to: (time + 600000) / 1000,
      countBack: 300,
      firstDataRequest: true,
    },
    barsPromise.resolve,
    barsPromise.reject,
  )

  const bars = await barsPromise.promise
  assert.equal(requests, requestCount)
  assert.equal(bars.find((bar) => bar.time === time)?.close, 104)
  feed.dispose()
})

test('TradingView 历史重载先清缓存，再等新的 getBars 完成', async () => {
  const feed = source(async () => [candle(time)])
  feed.setVisibleEngine('tradingview')
  await feed.recover(time - 300000, time + 300000)
  const order: string[] = []
  feed.tradingView.subscribeBars(
    feed.symbolInfo,
    '5' as ResolutionString,
    () => {},
    'tv',
    () => order.push('clear'),
  )

  await feed.refreshEngine('tradingview', () => {
    order.push('reset')
    feed.tradingView.getBars(
      feed.symbolInfo,
      '5' as ResolutionString,
      {
        from: (time - 300000) / 1000,
        to: (time + 300000) / 1000,
        countBack: 300,
        firstDataRequest: true,
      },
      () => order.push('loaded'),
      (error) => assert.fail(error),
    )
  })

  assert.deepEqual(order, ['clear', 'reset', 'loaded'])
  feed.dispose()
})

test('KLineChart 重载后从校准缓存读取历史，不重复请求 REST', async () => {
  let requests = 0
  const feed = source(async () => {
    requests++
    return [candle(time - 300000), candle(time)]
  })
  feed.setVisibleEngine('kline')
  await feed.recover(time - 300000, time + 600000)
  const requestCount = requests
  const barsPromise = Promise.withResolvers<KLineData[]>()
  await feed.refreshEngine('kline', () => {
    void feed.kline.getBars({
      type: 'init',
      timestamp: null,
      symbol: { ticker: 'BTC', pricePrecision: 1, volumePrecision: 5 },
      period: chartPeriods['5m'],
      callback(bars) {
        barsPromise.resolve(bars)
      },
    })
  })

  assert.equal(requests, requestCount)
  assert.equal((await barsPromise.promise).length, 2)
  feed.dispose()
})

test('历史接口留存范围之外的恢复结果标记为不完整', async () => {
  const feed = source(async () => [])
  const end = Date.now()
  const oldest = candleHistoryStart(end, 5000, '5m')
  const result = await feed.recover(oldest - 300000, end)

  assert.equal(result.fromTime, oldest)
  assert.equal(result.complete, false)
  feed.dispose()
})

test('恢复失败后保留同步期间的实时更新供重试合并', async () => {
  let calls = 0
  const feed = source(async () => {
    calls++
    if (calls === 1) throw new Error('offline')
    return [candle(time - 300000), { ...candle(time, '103'), h: '103' }]
  })
  await assert.rejects(feed.recover(time - 300000, time + 600000), /offline/)
  feed.update([{ ...candle(time, '104'), h: '104' }])
  await feed.recover(time - 300000, time + 600000)
  const barsPromise = Promise.withResolvers<Bar[]>()
  feed.tradingView.getBars(
    feed.symbolInfo,
    '5' as ResolutionString,
    {
      from: (time - 300000) / 1000,
      to: (time + 600000) / 1000,
      countBack: 300,
      firstDataRequest: true,
    },
    barsPromise.resolve,
    barsPromise.reject,
  )

  assert.equal(
    (await barsPromise.promise).find((bar) => bar.time === time)?.close,
    104,
  )
  feed.dispose()
})

test('恢复缓存的左边界不是历史终点，基础版仍能向前翻页', async () => {
  const requests: number[] = []
  const feed = source(async (start, end) => {
    requests.push(start)
    const rows: Candle[] = []
    for (let t = start; t <= end; t += 300000) rows.push(candle(t))
    return rows
  })
  try {
    const recovered = await feed.recover(time - 300000, time + 300000)
    const before = requests.length
    let received: KLineData[] = []
    await feed.kline.getBars({
      type: 'forward',
      timestamp: recovered.fromTime,
      symbol: { ticker: 'BTC', pricePrecision: 1, volumePrecision: 5 },
      period: chartPeriods['5m'],
      callback(bars) {
        received = bars
      },
    })
    assert.ok(requests.length > before, '缓存之外应继续查询历史')
    assert.equal(received.length, 300)
    assert.ok(received.every((bar) => bar.timestamp < recovered.fromTime))
  } finally {
    feed.dispose()
  }
})

test('基础版重载后忽略同币种同周期的旧 init 回包', async () => {
  const pending = Promise.withResolvers<Candle[]>()
  let calls = 0
  const feed = source(() =>
    ++calls === 1 ? pending.promise : Promise.resolve([candle(time, '102')]),
  )
  const received: number[] = []
  const params = {
    type: 'init' as const,
    timestamp: null,
    symbol: { ticker: 'BTC', pricePrecision: 1, volumePrecision: 5 },
    period: chartPeriods['5m'],
    callback(bars: KLineData[]) {
      received.push(bars.at(-1)?.close ?? 0)
    },
  }
  try {
    const old = feed.kline.getBars(params)
    await feed.recover(time - 300000, time + 300000)
    await feed.refreshEngine('kline', () => {
      void feed.kline.getBars(params)
    })
    pending.resolve([candle()])
    await old
    assert.deepEqual(received, [102], '旧 init 不能再次重置图表数据')
  } finally {
    feed.dispose()
  }
})

test('恢复期间跨过新的蜡烛周期，不丢弃查询截止时间之后的推送', async () => {
  const pending = Promise.withResolvers<Candle[]>()
  const feed = source(() => pending.promise)
  try {
    const recovery = feed.recover(time - 300000, time + 1)
    feed.update([candle(time + 300000, '102')])
    pending.resolve([candle(time - 300000), candle(time)])
    await recovery
    const bars = Promise.withResolvers<Bar[]>()
    feed.tradingView.getBars(
      feed.symbolInfo,
      '5' as ResolutionString,
      {
        from: (time - 300000) / 1000,
        to: (time + 600000) / 1000,
        countBack: 2,
        firstDataRequest: true,
      },
      bars.resolve,
      bars.reject,
    )
    assert.equal((await bars.promise).at(-1)?.time, time + 300000)
  } finally {
    feed.dispose()
  }
})

test('隐藏引擎遗漏的数据超出实时缓冲时必须重载，连续数据可以直接追平', async () => {
  const feed = source(async () => [candle(time)])
  try {
    await feed.kline.getBars({
      type: 'init',
      timestamp: null,
      symbol: { ticker: 'BTC', pricePrecision: 1, volumePrecision: 5 },
      period: chartPeriods['5m'],
      callback() {},
    })
    feed.kline.subscribeBar?.({
      symbol: { ticker: 'BTC', pricePrecision: 1, volumePrecision: 5 },
      period: chartPeriods['5m'],
      callback() {},
    })
    feed.setVisibleEngine('tradingview')
    feed.update([candle(time + 300000)])
    assert.equal(feed.isEngineDirty('kline'), false)
    feed.update([candle(time + 900000)])
    assert.equal(feed.isEngineDirty('kline'), true)
  } finally {
    feed.dispose()
  }
})

test('挂起页面遗留的绘制队列不能覆盖恢复后的最新历史', async () => {
  const feed = source(async () => [candle(time, '102')])
  const received: number[] = []
  try {
    feed.update([candle(time, '100')])
    await feed.recover(time - 300000, time + 300000)
    await feed.refreshEngine('kline', () => {
      void feed.kline.getBars({
        type: 'init',
        timestamp: null,
        symbol: { ticker: 'BTC', pricePrecision: 1, volumePrecision: 5 },
        period: chartPeriods['5m'],
        callback() {
          feed.kline.subscribeBar?.({
            symbol: { ticker: 'BTC', pricePrecision: 1, volumePrecision: 5 },
            period: chartPeriods['5m'],
            callback: (bar) => received.push(bar.close),
          })
        },
      })
    })
    await delay(10)
    assert.ok(received.length > 0)
    assert.ok(received.every((close) => close === 102))
  } finally {
    feed.dispose()
  }
})
