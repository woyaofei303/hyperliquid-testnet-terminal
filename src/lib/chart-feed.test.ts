import assert from 'node:assert/strict'
import test from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import type {
  Bar,
  ResolutionString,
} from '../../public/lib/charting_library/charting_library'
import { chartBars, chartPeriods, createChartFeed } from './chart-feed.ts'
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
