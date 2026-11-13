import { readFile } from 'node:fs/promises'
import { createL1ActionHash } from '@nktkas/hyperliquid/signing'
import { expect, type Page, test } from '@playwright/test'
import { recoverTypedDataAddress, serializeSignature } from 'viem'
import { cctpFixture, coreWallet } from './cctp-fixtures'

test('持续高频行情、资源回收与连接复用 @benchmark', async ({
  page,
  browser,
}, testInfo) => {
  test.skip(process.env.PERF_CHECK !== '1', '仅在显式性能验收时运行')
  test.setTimeout(180000)
  const { pushMarket, pushTrade, socketConnections, writes } =
    await mockExchange(page)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('/')
  await expect(page.getByText('实时连接', { exact: false })).toBeVisible()
  await expect(
    page.getByRole('region', { name: /基础版 K 线图/ }),
  ).toHaveAttribute('aria-label', /已加载 40 根/)
  await page.getByRole('button', { name: 'TradingView', exact: true }).click()
  await expect(
    page.frameLocator('iframe').locator('canvas').first(),
  ).toBeVisible()
  await page.getByRole('button', { name: '基础版', exact: true }).click()
  const cdp = await page.context().newCDPSession(page)
  const memory = async () => {
    await cdp.send('HeapProfiler.collectGarbage')
    return {
      heap: await cdp.send('Runtime.getHeapUsage'),
      dom: await cdp.send('Memory.getDOMCounters'),
    }
  }
  await page.waitForTimeout(5000)
  const baseline = await memory()
  await page.getByRole('button', { name: /性能 ·/ }).click()
  const capture = async () => {
    const download = page.waitForEvent('download')
    await page.getByRole('button', { name: '导出指标', exact: true }).click()
    const path = await (await download).path()
    if (!path) throw new Error('指标下载失败')
    const data = JSON.parse(await readFile(path, 'utf8'))
    return data as import('../src/shared/lib/performance').PerformanceSnapshot
  }
  const initial = await capture()
  const samples: (typeof initial)[] = []
  let cycles = 0
  const started = Date.now()
  // 每 100ms 发送 25 组盘口、标记价、K 线和成交，共目标 1000 条消息/秒。
  const pump = setInterval(() => {
    for (let i = 0; i < 25; i++) {
      cycles++
      pushMarket('BTC', 70000 + (cycles % 100))
      pushTrade('BTC', 1000 + cycles)
    }
  }, 100)
  try {
    while (Date.now() - started < 60000) {
      await page.waitForTimeout(1000)
      samples.push(await capture())
    }
  } finally {
    clearInterval(pump)
  }
  const elapsedMs = Date.now() - started
  const initialBook = initial.modules.find((row) => row.id === 'book')
  let drained = initial
  await expect
    .poll(
      async () => {
        drained = await capture()
        return (
          (drained.modules.find((row) => row.id === 'book')?.totalInput ?? 0) -
          (initialBook?.totalInput ?? 0)
        )
      },
      { timeout: 15000 },
    )
    .toBeGreaterThanOrEqual(cycles)
  const finalBook = drained.modules.find((row) => row.id === 'book')
  if (!finalBook) throw new Error('缺少订单簿性能指标')
  expect(finalBook.pending).toBeLessThanOrEqual(1)
  expect(finalBook.retained).toBeLessThanOrEqual(40)
  expect(
    finalBook.totalUpdates - (initialBook?.totalUpdates ?? 0),
  ).toBeLessThan(cycles)
  for (const sample of samples) {
    expect(sample.hidden).toBe(false)
    expect(
      sample.modules.find((row) => row.id === 'book')?.pending,
    ).toBeLessThanOrEqual(1)
    expect(
      sample.modules.find((row) => row.id === 'trades')?.retained,
    ).toBeLessThanOrEqual(100)
    expect(
      sample.modules.find((row) => row.id === 'candles')?.retained,
    ).toBeLessThanOrEqual(5000)
  }
  await page.screenshot({ path: testInfo.outputPath('metrics.png') })
  const recovery: (typeof initial)[] = []
  for (let i = 0; i < 5; i++) {
    await page.waitForTimeout(5000)
    recovery.push(await capture())
  }
  await page.getByRole('button', { name: '关闭', exact: true }).click()
  const expectedPrice = 70001 + (cycles % 100)
  await expect(
    page.locator('[data-side="sell"] [data-price]').last(),
  ).toHaveAttribute('data-price', String(expectedPrice))
  const afterLoad = await memory()
  for (let i = 0; i < 10; i++) {
    await page.getByRole('button', { name: 'TradingView', exact: true }).click()
    await page.getByRole('button', { name: '基础版', exact: true }).click()
    await page
      .getByRole('button', { name: i % 2 ? '5分' : '1分', exact: true })
      .click()
  }
  await page.waitForTimeout(3000)
  const afterSwitches = await memory()
  expect(socketConnections).toHaveLength(2)
  expect(errors).toEqual([])
  expect(writes).toEqual([])
  const result = {
    capturedAt: new Date().toISOString(),
    browser: browser.version(),
    environment:
      'local production build; synthetic WebSocket frames; 1440x1000',
    buildId: (await readFile('.next/BUILD_ID', 'utf8')).trim(),
    targetMessagesPerSecond: 1000,
    elapsedMs,
    cycles,
    sentMessages: cycles * 4,
    actualMessagesPerSecond: (cycles * 4000) / elapsedMs,
    baseline,
    afterLoad,
    afterSwitches,
    initial,
    samples,
    drained,
    recovery,
    socketConnections: socketConnections.length,
    exchangeWrites: writes.length,
    caveat:
      '同步提交耗时不等于整帧渲染耗时；回收后堆数据是短时观察，不证明无内存泄漏',
  }
  await testInfo.attach('benchmark.json', {
    body: JSON.stringify(result, null, 2),
    contentType: 'application/json',
  })
})

test('长任务故障注入触发降频并自动恢复 @benchmark', async ({
  page,
}, testInfo) => {
  test.skip(process.env.PERF_CHECK !== '1', '仅在显式性能验收时运行')
  test.setTimeout(90000)
  const exchange = await mockExchange(page)
  await page.goto('/')
  await expect(page.getByText('实时连接', { exact: false })).toBeVisible()
  await page.getByRole('button', { name: /性能 ·/ }).click()
  const capture = async () => {
    const download = page.waitForEvent('download')
    await page.getByRole('button', { name: '导出指标', exact: true }).click()
    const path = await (await download).path()
    if (!path) throw new Error('指标下载失败')
    return JSON.parse(
      await readFile(path, 'utf8'),
    ) as import('../src/shared/lib/performance').PerformanceSnapshot
  }
  const snapshots: Awaited<ReturnType<typeof capture>>[] = []
  let sent = 0
  const started = Date.now()
  const blocker = await page.evaluate(() =>
    window.setInterval(() => {
      const start = performance.now()
      while (performance.now() - start < 80) {
        /* 模拟外部脚本持续产生长任务。 */
      }
    }, 200),
  )
  const pump = setInterval(() => {
    for (let i = 0; i < 100; i++) {
      sent++
      exchange.pushFastBook(70000 + (sent % 100))
    }
  }, 100)
  let pressure: Awaited<ReturnType<typeof capture>> | undefined
  try {
    await expect
      .poll(
        async () => {
          pressure = await capture()
          snapshots.push(pressure)
          return pressure.level
        },
        { timeout: 25000, intervals: [1000] },
      )
      .toBeGreaterThan(0)
  } finally {
    clearInterval(pump)
    await page.evaluate((id) => window.clearInterval(id), blocker)
  }
  const injectionMs = Date.now() - started
  const stopped = Date.now()
  let recovered: Awaited<ReturnType<typeof capture>> | undefined
  await expect
    .poll(
      async () => {
        recovered = await capture()
        snapshots.push(recovered)
        return recovered.level
      },
      { timeout: 35000, intervals: [1000] },
    )
    .toBe(0)
  if (!pressure || !recovered) throw new Error('缺少降频或恢复快照')
  expect(recovered.modules.find((row) => row.id === 'book')?.pending).toBe(0)
  expect(exchange.writes).toEqual([])
  await testInfo.attach('pressure.json', {
    body: JSON.stringify(
      {
        capturedAt: new Date().toISOString(),
        injectionMs,
        recoveryMs: Date.now() - stopped,
        sent,
        pressure,
        recovered,
        snapshots,
        scope:
          'synthetic fast-book messages plus injected 80ms long tasks; no exchange writes',
      },
      null,
      2,
    ),
    contentType: 'application/json',
  })
})

const address = '0x1111111111111111111111111111111111111111'
interface WireOrder {
  a: number
  b: boolean
  p: string
  s: string
  r: boolean
  c: string
  t: {
    limit?: { tif: string }
    trigger?: { isMarket: boolean; triggerPx: string; tpsl: string }
  }
}
interface Order {
  coin: string
  side: string
  limitPx: string
  sz: string
  origSz: string
  oid: number
  timestamp: number
  cloid: string
  reduceOnly: boolean
  orderType: string
  isTrigger: boolean
  triggerPx: string
  triggerCondition: string
  isPositionTpsl: boolean
  children: never[]
}

async function mockExchange(
  page: Page,
  mode:
    | 'normal'
    | 'sparse-depth'
    | 'reject'
    | 'lost-response'
    | 'deny-signature'
    | 'delayed-history'
    | 'reject-leverage'
    | 'slow-history'
    | 'delayed-trades'
    | 'reject-trades'
    | 'empty-trades'
    | 'partial-batch'
    | 'lost-native' = 'normal',
) {
  const { promise: historyReady, resolve: releaseHistory } =
    Promise.withResolvers<void>()
  let nextOid = 100
  let bookOffset = 0
  let spotBookPrice = 20
  let candleHistoryRequests = 0
  let candleSnapshotGate: Promise<void> | null = null
  let cashReadGate: Promise<void> | null = null
  let cashReads = 0
  const cashBalances = [
    { coin: 'USDC', token: 0, total: '1000', hold: '10', entryNtl: '1000' },
    { coin: 'HYPE', token: 2, total: '10', hold: '2', entryNtl: '200' },
    { coin: '+120', total: '100', hold: '5', entryNtl: '50' },
    { coin: '+121', total: '100', hold: '0', entryNtl: '50' },
  ]
  const assetCoins: Record<number, string> = {
    3: 'BTC',
    10007: '@7',
    110000: 'test:ABC',
    100000120: '#120',
    100000121: '#121',
  }
  const statuses = new Map<number, string>()
  const twaps: {
    time: number
    state: {
      coin: string
      side: string
      sz: string
      executedSz: string
      executedNtl: string
      minutes: number
      randomize: boolean
    }
    status: { status: string }
    twapId: number
  }[] = []
  let position = 0
  let extraPositions: Record<string, number> = {}
  let leverage = 2
  let isCross = true
  let isolatedMargin = 35
  let agentAddress = ''
  let agentRegistrations = 0
  let agentRevoked = false
  let agentValidUntil: number | null = null
  let orders: Order[] = []
  const fills: object[] = []
  const writes: {
    type: string
    amount?: string
    toPerp?: boolean
    orders?: WireOrder[]
    modifies?: { oid: number; order: WireOrder }[]
    cancels?: { a: number; o: number }[]
    ntli?: number
    isBuy?: boolean
    sz?: string
    reduceOnly?: boolean
    leverage?: number
    isCross?: boolean
    asset?: number
    grouping?: string
    twap?: { a: number; b: boolean; m: number; s: string; t: boolean }
    details?: { t: { p: string; a: boolean } | null; s: string | null }
    a?: number | true
    t?: number
    retracement?: { pct: string }
  }[] = []
  const outcomes = new Map<string, Order>()
  const meta = {
    universe: ['SOL', 'APT', 'ATOM', 'BTC', 'ETH'].map((name) => ({
      name,
      szDecimals: name === 'BTC' ? 5 : 4,
      maxLeverage: 40,
      marginTableId: 1,
    })),
    marginTables: [],
  }
  const contexts = meta.universe.map(() => ({
    funding: '0.00001',
    openInterest: '100',
    prevDayPx: '69000',
    dayNtlVlm: '12000000',
    premium: '0.001',
    oraclePx: '70000',
    markPx: '70000',
    midPx: '70000',
    impactPxs: ['69999', '70001'],
    dayBaseVlm: '100',
  }))
  const book = (coin: string) => ({
    coin,
    time: Date.now(),
    levels: [
      Array.from({ length: mode === 'sparse-depth' ? 3 : 20 }, (_, i) => ({
        px: String(
          coin.startsWith('#')
            ? 0.49 - i * 0.001
            : coin === '@7'
              ? spotBookPrice - 0.01 - i * 0.01
              : 69999 + bookOffset - i,
        ),
        sz: '1',
        n: 1,
      })),
      Array.from({ length: mode === 'sparse-depth' ? 2 : 20 }, (_, i) => ({
        px: String(
          coin.startsWith('#')
            ? 0.51 + i * 0.001
            : coin === '@7'
              ? spotBookPrice + 0.01 + i * 0.01
              : 70001 + bookOffset + i,
        ),
        sz: '1',
        n: 1,
      })),
    ],
  })
  const tradeTime = Date.now()
  const trade = (coin: string, tid: number) => ({
    coin,
    tid,
    time: tradeTime + tid * 1000,
    side: tid % 2 ? 'B' : 'A',
    px: String(
      (coin === 'BTC' ? 70000 : coin === 'ETH' ? 2000 : 100) + tid / 10,
    ),
    sz: '0.1234',
    hash: `0x${'ab'.repeat(32)}`,
    users: [address, address],
  })
  let pushTrade = (_coin: string, _tid: number) => {}
  const tradeSubscriptions: string[] = []
  let pushMarket = (_coin: string, _price: number, _time?: number) => {}
  const candles = (
    coin: string,
    interval: string,
    count = 40,
    end = Date.now(),
  ) => {
    const step =
      Number.parseInt(interval, 10) *
      ({ m: 60000, h: 3600000, d: 86400000, w: 604800000, M: 2592000000 }[
        interval.slice(-1)
      ] ?? 300000)
    return Array.from({ length: count }, (_, i) => ({
      t: Math.floor(end / step) * step - (count - i) * step,
      T: Math.floor(end / step) * step - (count - i - 1) * step,
      s: coin,
      i: interval,
      o: '69900',
      h: '70100',
      l: '69800',
      c: '70000',
      v: '1',
      n: 1,
    }))
  }
  const state = () => ({
    marginSummary: {
      accountValue: '1000',
      totalNtlPos: String(Math.abs(position) * 70000),
      totalRawUsd: '1000',
      totalMarginUsed: '35',
    },
    crossMarginSummary: {
      accountValue: '1000',
      totalNtlPos: '0',
      totalRawUsd: '1000',
      totalMarginUsed: '0',
    },
    crossMaintenanceMarginUsed: '0',
    withdrawable: '965',
    time: Date.now(),
    assetPositions: Object.entries({
      ...extraPositions,
      ...(position ? { BTC: position } : {}),
    }).map(([coin, size]) => ({
      type: 'oneWay',
      position: {
        coin,
        szi: String(size),
        leverage: {
          type: isCross ? 'cross' : 'isolated',
          value: leverage,
        },
        entryPx: '70000',
        positionValue: String(Math.abs(size) * 70000),
        unrealizedPnl: '0',
        returnOnEquity: '0',
        liquidationPx: '35000',
        marginUsed: String(isolatedMargin),
        maxLeverage: 40,
        cumFunding: { allTime: '0', sinceOpen: '0', sinceChange: '0' },
      },
    })),
  })
  await page.addInitScript(
    ({ address, mode }) => {
      let current = address
      const callbacks = new Map<string, Set<(...args: unknown[]) => void>>()
      const provider = {
        request: async ({
          method,
          params,
        }: {
          method: string
          params?: string[]
        }): Promise<unknown> => {
          if (method === 'wallet_requestPermissions') {
            if (
              JSON.stringify(params) !== JSON.stringify([{ eth_accounts: {} }])
            )
              throw new Error('仅请求标准账户访问权限')
            sessionStorage.setItem(
              'mock-permission-requests',
              String(
                Number(
                  sessionStorage.getItem('mock-permission-requests') ?? 0,
                ) + 1,
              ),
            )
            return [{ parentCapability: 'eth_accounts' }]
          }
          if (method === 'eth_requestAccounts' || method === 'eth_accounts')
            return [current]
          if (method === 'eth_chainId') return '0x66eee'
          if (method === 'eth_signTypedData_v4') {
            sessionStorage.setItem(
              'mock-wallet-signs',
              String(
                Number(sessionStorage.getItem('mock-wallet-signs') ?? 0) + 1,
              ),
            )
            if (mode === 'deny-signature')
              throw { code: 4001, message: 'User rejected signature' }
            const typed = JSON.parse(params?.[1] ?? '{}')
            if (
              Number(typed.domain.chainId) !==
              Number(await provider.request({ method: 'eth_chainId' }))
            )
              throw new Error('钱包不接受跨网络签名')
            if (
              ![
                'HyperliquidTransaction:ApproveAgent',
                'HyperliquidTransaction:UsdClassTransfer',
                'HyperliquidTransaction:SendToEvmWithData',
                'HyperliquidTransaction:UserSetAbstraction',
              ].includes(typed.primaryType) ||
              typed.message.hyperliquidChain !== 'Testnet'
            )
              throw new Error('仅允许测试网会话授权')
            return `0x${'11'.repeat(64)}1b`
          }
          throw new Error(`Unexpected wallet method ${method}`)
        },
        on: (event: string, callback: (...args: unknown[]) => void) => {
          const set = callbacks.get(event) ?? new Set()
          set.add(callback)
          callbacks.set(event, set)
        },
        removeListener: (
          event: string,
          callback: (...args: unknown[]) => void,
        ) => {
          callbacks.get(event)?.delete(callback)
        },
      }
      Object.defineProperty(window, 'ethereum', {
        configurable: true,
        value: provider,
      })
      window.addEventListener('test-wallet-disconnect', () => {
        for (const callback of callbacks.get('disconnect') ?? [])
          callback({ code: 4900, message: 'Disconnected' })
      })
      window.addEventListener('test-wallet-empty-accounts', () => {
        for (const callback of callbacks.get('accountsChanged') ?? [])
          callback([])
      })
      window.addEventListener('test-network-change', () => {
        for (const callback of callbacks.get('chainChanged') ?? [])
          callback('0xa4b1')
      })
      window.addEventListener('test-account-change', () => {
        current = '0x2222222222222222222222222222222222222222'
        for (const callback of callbacks.get('accountsChanged') ?? [])
          callback([current])
      })
    },
    { address, mode },
  )
  await page.route('https://api.hyperliquid.xyz/**', () => {
    throw new Error('主网请求被测试拦截')
  })
  await page.route('https://api.hyperliquid-testnet.xyz/**', async (route) => {
    const request = route.request().postDataJSON()
    let data: unknown
    if (request.type) {
      switch (request.type) {
        case 'spotMetaAndAssetCtxs':
          data = [
            {
              universe: [
                { name: '@7', index: 7, tokens: [2, 0], isCanonical: true },
              ],
              tokens: [
                { name: 'USDC', index: 0, szDecimals: 8 },
                { name: 'HYPE', index: 2, szDecimals: 2 },
              ],
            },
            [{ coin: '@7', markPx: '20', prevDayPx: '19', dayNtlVlm: '1000' }],
          ]
          break
        case 'allPerpMetas':
          data = [
            meta,
            {
              universe: [{ name: 'test:ABC', szDecimals: 0, maxLeverage: 3 }],
              collateralToken: 0,
            },
          ]
          break
        case 'outcomeMeta':
          data = {
            outcomes: [
              {
                outcome: 12,
                name: 'BTC 达到目标价？',
                description: '按公开价格结算',
                sideSpecs: [{ name: 'Yes' }, { name: 'No' }],
                quoteToken: 'USDC',
              },
            ],
            questions: [],
            feeScale: '1',
          }
          break
        case 'userRole':
          data = { role: 'user' }
          break
        case 'userAbstraction':
          data = 'disabled'
          break
        case 'userNonFundingLedgerUpdates':
          data = []
          break
        case 'historicalOrders':
        case 'userFunding':
        case 'userTwapSliceFills':
          data = []
          break
        case 'outcomeTemplates':
          data = []
          break
        case 'spotClearinghouseState':
          cashReads++
          if (cashReadGate) await cashReadGate
          data = { balances: cashBalances }
          break
        case 'metaAndAssetCtxs':
          data = [meta, contexts]
          break
        case 'l2Book':
          data = book(request.coin)
          break
        case 'recentTrades':
          if (mode === 'reject-trades') {
            await route.fulfill({ status: 503, json: { error: 'Unavailable' } })
            return
          }
          if (mode === 'delayed-trades') await historyReady
          data =
            mode === 'empty-trades'
              ? []
              : Array.from({ length: 30 }, (_, i) => trade(request.coin, i + 1))
          break
        case 'candleSnapshot':
          if (request.req.endTime !== undefined) {
            candleHistoryRequests++
            if (candleSnapshotGate) await candleSnapshotGate
          }
          if (mode === 'slow-history')
            await new Promise((resolve) => setTimeout(resolve, 900))
          if (mode === 'delayed-history') await historyReady
          data =
            mode === 'slow-history'
              ? candles(
                  request.req.coin,
                  request.req.interval,
                  300,
                  request.req.endTime + 1,
                )
              : candles(request.req.coin, request.req.interval)
          break
        case 'twapHistory':
          data = twaps
          break
        case 'userFees':
          data = {
            userAddRate: '0.00015',
            userCrossRate: '0.00045',
            userSpotAddRate: '0.0004',
            userSpotCrossRate: '0.0007',
          }
          break
        case 'activeAssetData':
          data = {
            user: request.user,
            coin: request.coin,
            leverage: isCross
              ? { type: 'cross', value: leverage }
              : { type: 'isolated', value: leverage, rawUsd: '100' },
            maxTradeSzs: ['1', '1'],
            availableToTrade: ['1000', '1000'],
            markPx: '70000',
          }
          break
        case 'clearinghouseState':
          data = state()
          break
        case 'frontendOpenOrders':
          data = orders
          break
        case 'userFills':
          data = fills
          break
        case 'extraAgents':
          data =
            agentAddress && !agentRevoked
              ? [
                  {
                    address: agentAddress,
                    name: 'JulianTerminal',
                    validUntil: agentValidUntil,
                  },
                ]
              : []
          break
        case 'orderStatus': {
          const order =
            typeof request.oid === 'number'
              ? [...outcomes.values()].find((item) => item.oid === request.oid)
              : outcomes.get(request.oid)
          data = order
            ? {
                status: 'order',
                order: {
                  order,
                  status: statuses.get(order.oid) ?? 'open',
                  statusTimestamp: Date.now(),
                },
              }
            : { status: 'unknownOid' }
          break
        }
        default:
          throw new Error(`Unexpected info request ${request.type}`)
      }
    } else {
      const action = request.action
      if (action.type === 'approveAgent') {
        expect(action.hyperliquidChain).toBe('Testnet')
        expect(action.agentName).toMatch(
          /^JulianTerminal(?: valid_until \d+)?$/,
        )
        agentRegistrations++
        agentAddress = action.agentAddress
        agentRevoked = false
        agentValidUntil = null
        await route.fulfill({
          json: { status: 'ok', response: { type: 'default' } },
        })
        return
      }
      if (action.type === 'usdClassTransfer') {
        expect(action.hyperliquidChain).toBe('Testnet')
        writes.push(action)
        await route.fulfill({
          json: { status: 'ok', response: { type: 'default' } },
        })
        return
      }
      writes.push(action)
      expect(request.expiresAfter).toBeGreaterThan(Date.now() - 1000)
      const recovered = await recoverTypedDataAddress({
        domain: {
          name: 'Exchange',
          version: '1',
          chainId: 1337,
          verifyingContract: '0x0000000000000000000000000000000000000000',
        },
        types: {
          Agent: [
            { name: 'source', type: 'string' },
            { name: 'connectionId', type: 'bytes32' },
          ],
        },
        primaryType: 'Agent',
        message: {
          source: 'b',
          connectionId: createL1ActionHash({
            action,
            nonce: request.nonce,
            expiresAfter: request.expiresAfter,
          }),
        },
        signature: serializeSignature({
          ...request.signature,
          v: BigInt(request.signature.v),
        }),
      })
      expect(recovered.toLowerCase()).toBe(agentAddress.toLowerCase())
      if (action.type === 'order' || action.type === 'batchModify') {
        const previous = orders
        if (action.type === 'batchModify') {
          expect(action.a).toBe(true)
          orders = orders.filter(
            (order) =>
              !action.modifies.some(
                (modify: { oid: number }) => modify.oid === order.oid,
              ),
          )
        }
        const reports = (
          action.orders ??
          action.modifies.map((modify: { order: WireOrder }) => modify.order)
        ).map((order: WireOrder, index: number) => {
          expect([3, 10007, 110000, 100000120, 100000121]).toContain(order.a)
          if (mode === 'reject' || (mode === 'partial-batch' && index === 1))
            return { error: 'Insufficient margin' }
          const oid = nextOid++
          const item: Order = {
            coin: assetCoins[order.a],
            side: order.b ? 'B' : 'A',
            limitPx: order.p,
            sz: order.s,
            origSz: order.s,
            oid,
            timestamp: Date.now(),
            cloid: order.c,
            reduceOnly: order.r,
            orderType: order.t.trigger
              ? `${order.t.trigger.tpsl === 'tp' ? 'Take Profit' : 'Stop'} ${order.t.trigger.isMarket ? 'Market' : 'Limit'}`
              : 'Limit',
            isTrigger: !!order.t.trigger,
            triggerPx: order.t.trigger?.triggerPx ?? '0',
            triggerCondition: 'N/A',
            isPositionTpsl:
              action.grouping === 'positionTpsl' ||
              (action.type === 'batchModify' &&
                !!previous.find((old) => old.oid === action.modifies[index].oid)
                  ?.isPositionTpsl),
            children: [],
          }
          outcomes.set(order.c, item)
          if (order.t.limit?.tif !== 'Ioc') {
            orders.push(item)
            statuses.set(oid, 'open')
            return { resting: { oid, cloid: order.c } }
          }
          position = Number(
            (position + (order.b ? 1 : -1) * Number(order.s)).toFixed(5),
          )
          statuses.set(oid, 'filled')
          item.sz = '0'
          fills.unshift({
            coin: 'BTC',
            px: '70000',
            sz: order.s,
            side: order.b ? 'B' : 'A',
            time: Date.now(),
            startPosition: '0',
            dir: order.r ? 'Close Long' : 'Open Long',
            closedPnl: '0',
            hash: '0x1234',
            oid,
            crossed: true,
            fee: '0.01',
            tid: oid,
            feeToken: 'USDC',
          })
          return { filled: { totalSz: order.s, avgPx: '70000', oid } }
        })
        data = {
          status: 'ok',
          response: { type: 'order', data: { statuses: reports } },
        }
        if (mode === 'lost-response') {
          await route.abort('failed')
          return
        }
      } else if (action.type === 'cancel') {
        for (const cancel of action.cancels) statuses.set(cancel.o, 'canceled')
        orders = orders.filter(
          (o) =>
            !action.cancels.some((item: { o: number }) => item.o === o.oid),
        )
        data = {
          status: 'ok',
          response: { type: 'cancel', data: { statuses: ['success'] } },
        }
      } else if (action.type === 'twapOrder') {
        expect([3, 10007, 110000]).toContain(action.twap.a)
        const twapId = nextOid++
        twaps.unshift({
          time: Math.floor(Date.now() / 1000),
          twapId,
          state: {
            coin: assetCoins[action.twap.a],
            side: action.twap.b ? 'B' : 'A',
            sz: action.twap.s,
            executedSz: '0',
            executedNtl: '0',
            minutes: action.twap.m,
            randomize: action.twap.t,
          },
          status: { status: 'activated' },
        })
        data = {
          status: 'ok',
          response: {
            type: 'twapOrder',
            data: { status: { running: { twapId } } },
          },
        }
        if (mode === 'lost-native') {
          await route.abort('failed')
          return
        }
      } else if (action.type === 'twapCancel') {
        const item = twaps.find((item) => item.twapId === action.t)
        if (item) item.status.status = 'terminated'
        data = {
          status: 'ok',
          response: { type: 'twapCancel', data: { status: 'success' } },
        }
      } else if (action.type === 'userOutcome') {
        data = { status: 'ok', response: { type: 'default' } }
      } else if (action.type === 'trailingStop') {
        data = {
          status: 'ok',
          response: { type: 'trailingStop', data: { oid: nextOid++ } },
        }
      } else if (action.type === 'updateIsolatedMargin') {
        isolatedMargin += action.ntli / 1000000
        data = { status: 'ok', response: { type: 'default' } }
      } else if (action.type === 'updateLeverage') {
        if (mode === 'reject-leverage') {
          await route.fulfill({
            json: {
              status: 'err',
              response: 'Cannot switch margin mode with open positions',
            },
          })
          return
        }
        leverage = action.leverage
        isCross = action.isCross
        data = { status: 'ok', response: { type: 'default' } }
      } else throw new Error(`Unexpected exchange action ${action.type}`)
    }
    await route.fulfill({ json: data })
  })
  const socketConnections: string[] = []
  let disconnectMarket = () => {}
  let pushFastBook = (_price: number) => {}
  let pushAccount = () => {}
  await page.routeWebSocket('wss://api.hyperliquid-testnet.xyz/ws', (ws) => {
    socketConnections.push(ws.url())
    ws.onMessage((raw) => {
      const request = JSON.parse(String(raw))
      if (request.method === 'ping') {
        ws.send(JSON.stringify({ channel: 'pong' }))
        return
      }
      if (!['subscribe', 'unsubscribe'].includes(request.method)) return
      const s = request.subscription
      ws.send(
        JSON.stringify({
          channel: 'subscriptionResponse',
          data: {
            method: request.method,
            subscription: s,
          },
        }),
      )
      if (request.method !== 'subscribe') return
      if (s.type === 'activeAssetCtx') {
        ws.send(
          JSON.stringify({
            channel: 'activeAssetCtx',
            data: {
              coin: s.coin,
              ctx: {
                ...contexts[0],
                markPx:
                  s.coin === '@7'
                    ? '20'
                    : s.coin.startsWith('#')
                      ? '0.5'
                      : '70000',
              },
            },
          }),
        )
        pushMarket = (coin, price, time) => {
          const depth = book(coin)
          depth.levels[0].forEach((row, i) => {
            row.px = String(price - 1 - i)
          })
          depth.levels[1].forEach((row, i) => {
            row.px = String(price + 1 + i)
          })
          ws.send(JSON.stringify({ channel: 'l2Book', data: depth }))
          ws.send(
            JSON.stringify({
              channel: 'activeAssetCtx',
              data: { coin, ctx: { ...contexts[0], markPx: String(price) } },
            }),
          )
          ws.send(
            JSON.stringify({
              channel: 'candle',
              data: {
                ...candles(coin, '5m').at(-1),
                ...(time === undefined ? {} : { t: time, T: time + 299999 }),
                c: String(price),
                h: String(Math.max(70100, price)),
                l: String(Math.min(69800, price)),
              },
            }),
          )
        }
      }
      if (s.type === 'trades') {
        tradeSubscriptions.push(s.coin)
        pushTrade = (coin, tid) =>
          ws.send(
            JSON.stringify({ channel: 'trades', data: [trade(coin, tid)] }),
          )
        if (!['empty-trades', 'reject-trades'].includes(mode))
          pushTrade(s.coin, 31)
      }
      if (s.type === 'l2Book') {
        const depth = book(s.coin)
        if (s.fast) depth.levels = depth.levels.map((rows) => rows.slice(0, 5))
        ws.send(JSON.stringify({ channel: 'l2Book', data: depth }))
        if (s.fast)
          pushFastBook = (price) => {
            const next = book(s.coin)
            next.levels = next.levels.map((rows, side) =>
              rows.slice(0, 5).map((row, i) => ({
                ...row,
                px: String(side ? price + 1 + i : price - 1 - i),
              })),
            )
            ws.send(JSON.stringify({ channel: 'l2Book', data: next }))
          }
      }
      if (s.type === 'clearinghouseState') {
        pushAccount = () =>
          ws.send(
            JSON.stringify({
              channel: 'clearinghouseState',
              data: {
                user: address,
                dex: s.dex ?? '',
                clearinghouseState: state(),
              },
            }),
          )
      }
      if (s.type === 'candle') {
        disconnectMarket = () => ws.close({ code: 1001 })
        ws.send(
          JSON.stringify({
            channel: 'candle',
            data: candles(s.coin, s.interval).at(-1),
          }),
        )
      }
    })
  })
  return {
    disconnectMarket: () => disconnectMarket(),
    pushFastBook(price: number) {
      pushFastBook(price)
    },
    pushAccount() {
      pushAccount()
    },
    setIsolated(margin: number, value = 20) {
      isCross = false
      isolatedMargin = margin
      leverage = value
    },
    setExtraPositions(value: Record<string, number>) {
      extraPositions = value
    },
    setOrders(value: Order[]) {
      orders = value
      for (const order of value) {
        statuses.set(order.oid, 'open')
        outcomes.set(order.cloid, order)
      }
    },
    setPosition(value: number) {
      position = value
    },
    setSpotBookPrice(value: number) {
      spotBookPrice = value
    },
    setCashBalance(coin: string, total: string, hold: string) {
      const row = cashBalances.find((row) => row.coin === coin)
      if (!row) throw new Error('Unknown fixture balance')
      row.total = total
      row.hold = hold
    },
    pauseCashReads() {
      const gate = Promise.withResolvers<void>()
      cashReadGate = gate.promise
      return {
        reads: () => cashReads,
        release: () => {
          cashReadGate = null
          gate.resolve()
        },
      }
    },
    setBookPrice(value: number) {
      bookOffset = value - 70000
    },
    partialFill(oid: number, remaining: string) {
      const item = [...outcomes.values()].find((item) => item.oid === oid)
      if (item) item.sz = remaining
    },
    writes,
    candleHistoryRequests: () => candleHistoryRequests,
    pauseCandleHistory() {
      const gate = Promise.withResolvers<void>()
      candleSnapshotGate = gate.promise
      return () => {
        candleSnapshotGate = null
        gate.resolve()
      }
    },
    agentRegistrations: () => agentRegistrations,
    expireAgent: () => {
      agentValidUntil = Date.now() - 1
    },
    revokeAgent: () => {
      agentRevoked = true
    },
    releaseHistory,
    socketConnections,
    tradeSubscriptions,
    pushMarket: (coin: string, price: number, time?: number) =>
      pushMarket(coin, price, time),
    pushTrade: (coin: string, tid: number) => pushTrade(coin, tid),
  }
}

async function ready(page: Page) {
  await page.goto('/')
  await expect(page.getByText('实时连接', { exact: false })).toBeVisible()
  await page.getByRole('button', { name: '连接钱包', exact: true }).click()
  await page.getByRole('button', { name: '浏览器钱包 连接 →' }).click()
  await expect(
    page.getByRole('button', { name: '下单', exact: true }),
  ).toBeEnabled()
}

async function confirmOrder(page: Page) {
  await page
    .getByRole('dialog')
    .getByRole('button', { name: /^(买入|卖出|确认止盈)/ })
    .click()
}

test('连接后先读取余额，未完成查询时不签名，查询后在连接中完成授权', async ({
  page,
}) => {
  const exchange = await mockExchange(page)
  const balanceQuery = exchange.pauseCashReads()
  await page.goto('/')
  await page.getByRole('button', { name: '连接钱包', exact: true }).click()
  await page.getByRole('button', { name: '浏览器钱包 连接 →' }).click()
  await expect(
    page.locator('header').getByRole('button', {
      name: /^0x[0-9a-f]{4}…[0-9a-f]{4}$/i,
      includeHidden: true,
    }),
  ).toBeVisible()
  await expect.poll(balanceQuery.reads).toBeGreaterThan(0)
  await expect(
    page.getByRole('button', { name: '启用交易', exact: true }),
  ).toHaveCount(0)
  await expect(
    page.getByRole('region', { name: '账户概览', includeHidden: true }),
  ).toContainText('正在读取余额')
  expect(exchange.agentRegistrations()).toBe(0)
  balanceQuery.release()
  await expect(
    page.getByRole('region', { name: '账户概览', includeHidden: true }),
  ).toContainText('1,000.00')
  await expect(
    page.getByRole('button', { name: '下单', exact: true }),
  ).toBeEnabled()
  expect(exchange.agentRegistrations()).toBe(1)
  expect(exchange.writes).toHaveLength(0)
})

test('已有交易连接核验期间先展示余额，通过后直接下单且不重复签名', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  const exchange = await mockExchange(page)
  await ready(page)
  const registration = Promise.withResolvers<void>()
  await page.route(
    'https://api.hyperliquid-testnet.xyz/info',
    async (route) => {
      if (route.request().postDataJSON().type === 'extraAgents')
        await registration.promise
      await route.fallback()
    },
  )
  await page.reload()
  const overview = page.getByRole('region', { name: '账户概览' })
  try {
    await expect(overview).toContainText('1,000.00')
    await expect(overview).toContainText('正在核验交易连接')
    await expect(
      page.getByRole('button', { name: '启用交易', exact: true }),
    ).toHaveCount(0)
    await page.screenshot({
      path: 'output-tdd/playwright/connection-state/checking.png',
    })
  } finally {
    registration.resolve()
  }
  await expect(
    page.getByRole('button', { name: '下单', exact: true }),
  ).toBeEnabled()
  await expect(overview).toContainText('已连接 · 可交易')
  expect(exchange.agentRegistrations()).toBe(1)
  expect(
    await page.evaluate(() => sessionStorage.getItem('mock-wallet-signs')),
  ).toBe('1')
  expect(exchange.writes).toHaveLength(0)
})

test('恢复连接期间钱包静默换账户，丢弃原地址与签名能力', async ({ page }) => {
  const exchange = await mockExchange(page)
  await ready(page)
  const registration = Promise.withResolvers<void>()
  await page.route(
    'https://api.hyperliquid-testnet.xyz/info',
    async (route) => {
      if (route.request().postDataJSON().type === 'extraAgents')
        await registration.promise
      await route.fallback()
    },
  )
  await page.reload()
  try {
    await expect(page.getByRole('region', { name: '账户概览' })).toContainText(
      '正在核验交易连接',
    )
    await page.evaluate(() => {
      const provider = window.ethereum
      if (!provider) throw new Error('测试钱包不存在')
      Object.defineProperty(provider, 'request', {
        value: async ({ method }: { method: string }) => {
          if (method === 'eth_accounts')
            return ['0x2222222222222222222222222222222222222222']
          throw new Error(`Unexpected wallet request: ${method}`)
        },
      })
    })
  } finally {
    registration.resolve()
  }
  await expect(
    page
      .locator('header')
      .getByRole('button', { name: '连接钱包', exact: true }),
  ).toBeVisible()
  await expect(
    page
      .locator('header')
      .getByRole('button', { name: /^0x[0-9a-f]{4}…[0-9a-f]{4}$/i }),
  ).toHaveCount(0)
  expect(exchange.agentRegistrations()).toBe(1)
  expect(exchange.writes).toHaveLength(0)
})

test('余额读取失败不误判新用户，重试查询后再显示交易状态', async ({ page }) => {
  const exchange = await mockExchange(page)
  let fail = true
  await page.route(
    'https://api.hyperliquid-testnet.xyz/info',
    async (route) => {
      if (
        fail &&
        route.request().postDataJSON().type === 'clearinghouseState'
      ) {
        await route.fulfill({ status: 503, json: { error: 'Unavailable' } })
        return
      }
      await route.fallback()
    },
  )
  await page.goto('/')
  await page.getByRole('button', { name: '连接钱包', exact: true }).click()
  await page.getByRole('button', { name: '浏览器钱包 连接 →' }).click()
  await expect(
    page
      .getByRole('dialog')
      .getByRole('alert')
      .filter({ hasText: '连接未完成' }),
  ).toBeVisible()
  await page.getByRole('button', { name: '关闭钱包面板' }).click()
  const overview = page.getByRole('region', { name: '账户概览' })
  await expect(overview).toContainText('账户核验失败')
  await expect(
    page.getByRole('button', { name: '启用交易', exact: true }),
  ).toHaveCount(0)
  fail = false
  await expect(
    page.getByRole('button', { name: '刷新', exact: true }),
  ).toHaveCount(0)
  await expect(overview).toContainText('1,000.00', { timeout: 20000 })
  expect(exchange.agentRegistrations()).toBe(0)
  await page.getByRole('button', { name: '完成钱包连接', exact: true }).click()
  await page.getByRole('button', { name: '重新连接并核验' }).click()
  exchange.pushMarket('BTC', 70000)
  await expect(
    page.getByRole('button', { name: '下单', exact: true }),
  ).toBeEnabled()
  expect(exchange.agentRegistrations()).toBe(1)
  expect(exchange.writes).toHaveLength(0)
})

test('市价滑点在下单摘要中设置，取消不修改，切换订单类型不重置', async ({
  page,
}) => {
  const { writes } = await mockExchange(page)
  await page.setViewportSize({ width: 1440, height: 1000 })
  await ready(page)
  const panel = page.getByRole('region', { name: '下单面板', exact: true })
  await panel.getByRole('tab', { name: '市价单', exact: true }).click()
  await expect(
    panel.getByRole('textbox', { name: '滑点上限（%）' }),
  ).toHaveCount(0)
  const setting = panel.getByRole('button', { name: '调整最大滑点' })
  await expect(setting).toContainText('0.50%')
  await setting.click()
  const dialog = page.getByRole('dialog', { name: '调整最大滑点' })
  await dialog.getByLabel('最大滑点（%）').fill('1')
  await dialog.getByRole('button', { name: '关闭滑点设置' }).click()
  await expect(setting).toContainText('0.50%')
  await setting.click()
  await dialog.getByLabel('最大滑点（%）').fill('0.001')
  await dialog.getByRole('button', { name: '确认', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText('0.01%')
  await dialog.getByLabel('最大滑点（%）').fill('1')
  await dialog.getByRole('button', { name: '确认', exact: true }).click()
  await expect(dialog).toBeHidden()
  await selectAdvanced(page, '止损市价')
  await expect(setting).toHaveCount(0)
  await expect(panel.locator('dl[aria-label="订单摘要"]')).toContainText('10%')
  await panel.getByRole('tab', { name: '限价单', exact: true }).click()
  await expect(setting).toHaveCount(0)
  await panel.getByRole('tab', { name: '市价单', exact: true }).click()
  await expect(setting).toContainText('1.00%')
  expect(writes).toHaveLength(0)
  await panel.getByLabel('数量（BTC）', { exact: true }).fill('0.001')
  const button = panel.getByRole('button', { name: '下单', exact: true })
  const summary = panel.locator('dl[aria-label="订单摘要"]')
  const buttonBox = await button.boundingBox(),
    summaryBox = await summary.boundingBox()
  expect(
    buttonBox && summaryBox && buttonBox.y + buttonBox.height <= summaryBox.y,
  ).toBe(true)
  await page.screenshot({
    path: 'output-tdd/playwright/order-form-audit/market.png',
  })
  await button.click()
  await confirmOrder(page)
  await expect.poll(() => writes.length).toBe(1)
  expect(writes[0].orders?.[0]).toMatchObject({
    p: '70701',
    s: '0.001',
    t: { limit: { tif: 'Ioc' } },
  })
})

for (const [category, name, unit, size, asset, price] of [
  ['现货', 'HYPE / USDC', 'HYPE', '2', 10007, '20.41'],
  ['预测', 'BTC 达到目标价？ · Yes', 'Yes', '20', 100000120, '0.5202'],
] as const) {
  test(`${category}市价共用滑点弹窗，设置实际限制成交价格`, async ({
    page,
  }) => {
    const { writes } = await mockExchange(page)
    await ready(page)
    await page.getByRole('button', { name: '交易市场', exact: true }).click()
    await page
      .getByRole('region', { name: '市场选择器', exact: true })
      .getByRole('tab', { name: category, exact: true })
      .click()
    await page.getByRole('option', { name, exact: true }).click()
    const panel = page.getByRole('region', { name: '下单面板', exact: true })
    if (category === '预测') await predictionUnit(page, 'Yes')
    else await panel.getByRole('tab', { name: '市价单', exact: true }).click()
    await expect(
      panel.getByRole('textbox', { name: '滑点上限（%）' }),
    ).toHaveCount(0)
    await panel.getByRole('button', { name: '调整最大滑点' }).click()
    const dialog = page.getByRole('dialog', { name: '调整最大滑点' })
    await dialog.getByLabel('最大滑点（%）').fill('2')
    await dialog.getByRole('button', { name: '确认', exact: true }).click()
    await expect(dialog).toBeHidden()
    expect(writes).toHaveLength(0)
    await panel
      .getByRole('textbox', { name: `数量（${unit}）`, exact: true })
      .fill(size)
    await signPreview(page)
    await expect.poll(() => writes.length).toBe(1)
    expect(writes[0].orders?.[0]).toMatchObject({
      a: asset,
      p: price,
      s: size,
      r: false,
      t: { limit: { tif: 'Ioc' } },
    })
  })
}

test('账户类型读取真实模式，确认后才签名，更新后合约与现货同步', async ({
  page,
}) => {
  await mockExchange(page)
  await page.setViewportSize({ width: 1440, height: 1000 })
  let accountType = 'disabled'
  const changes: Record<string, unknown>[] = []
  await page.route(
    'https://api.hyperliquid-testnet.xyz/info',
    async (route) => {
      if (route.request().postDataJSON().type === 'userAbstraction')
        await route.fulfill({ json: accountType })
      else await route.fallback()
    },
  )
  await page.route(
    'https://api.hyperliquid-testnet.xyz/exchange',
    async (route) => {
      const request = route.request().postDataJSON()
      if (request.action.type !== 'userSetAbstraction') return route.fallback()
      changes.push(request.action)
      accountType = request.action.abstraction
      await route.fulfill({
        json: { status: 'ok', response: { type: 'default' } },
      })
    },
  )
  await page.goto('/')
  await page.getByRole('button', { name: '连接钱包', exact: true }).click()
  await page.getByRole('button', { name: '浏览器钱包 连接 →' }).click()
  const panel = page.getByRole('region', { name: '下单面板', exact: true })
  const button = panel.getByRole('button', { name: '账户类型', exact: true })
  await expect(button).toContainText('手动')
  await button.click()
  const dialog = page.getByRole('dialog', { name: '账户类型', exact: true })
  await dialog
    .getByRole('radio', { name: '统一账户（推荐）', exact: true })
    .check()
  expect(changes).toHaveLength(0)
  await expect(
    dialog.getByRole('radio', { name: '投资组合保证金', exact: true }),
  ).toBeVisible()
  await dialog
    .getByRole('button', { name: '确认账户类型', exact: true })
    .click()
  await expect(dialog).toBeHidden()
  await expect(button).toContainText('统一')
  expect(changes).toEqual([
    expect.objectContaining({
      user: address,
      abstraction: 'unifiedAccount',
      hyperliquidChain: 'Testnet',
    }),
  ])
  const overview = page.getByRole('region', { name: '账户概览' })
  await expect(overview).toContainText('账户类型统一账户')
  await expect(overview).toContainText('连接状态')
  await expect(overview).not.toContainText('已用保证金')
  await page.getByRole('button', { name: '关闭提示' }).click()
  await button.click()
  await dialog
    .getByRole('radio', { name: '投资组合保证金', exact: true })
    .check()
  await page.screenshot({
    path: 'output-tdd/playwright/order-form-audit/account-type.png',
  })
  await dialog
    .getByRole('button', { name: '确认账户类型', exact: true })
    .click()
  await expect(dialog).toBeHidden()
  await expect(button).toContainText('组合')
  await button.click()
  await dialog.getByRole('radio', { name: '手动', exact: true }).check()
  await dialog
    .getByRole('button', { name: '确认账户类型', exact: true })
    .click()
  await expect(dialog).toBeHidden()
  await expect(button).toContainText('手动')
  expect(changes.map((item) => item.abstraction)).toEqual([
    'unifiedAccount',
    'portfolioMargin',
    'disabled',
  ])
  await page.getByRole('button', { name: '交易市场', exact: true }).click()
  await page.getByRole('tab', { name: '现货', exact: true }).click()
  await page.getByRole('option', { name: 'HYPE / USDC', exact: true }).click()
  await expect(button).toContainText('手动')
})

test('账户类型加载期间打开弹窗，数据到达后可以切换而不静默返回', async ({
  page,
}) => {
  await mockExchange(page)
  const { promise, resolve } = Promise.withResolvers<void>()
  await page.route(
    'https://api.hyperliquid-testnet.xyz/info',
    async (route) => {
      if (route.request().postDataJSON().type === 'userAbstraction') {
        await promise
        await route.fulfill({ json: 'disabled' })
      } else await route.fallback()
    },
  )
  await page.addInitScript(() => {
    const provider = window.ethereum
    if (!provider) throw new Error('Missing mock wallet')
    const request = provider.request.bind(provider)
    provider.request = (async (params: {
      method: string
      params?: unknown[]
    }) => {
      if (
        params.method === 'eth_signTypedData_v4' &&
        String(params.params?.[1]).includes('UserSetAbstraction')
      )
        throw { code: 4001, message: 'User rejected account type' }
      return request(params as Parameters<typeof request>[0])
    }) as typeof provider.request
  })
  await page.goto('/')
  await page.getByRole('button', { name: '连接钱包', exact: true }).click()
  await page.getByRole('button', { name: '浏览器钱包 连接 →' }).click()
  await expect(
    page.getByRole('dialog', { name: '连接', exact: true }),
  ).toHaveCount(0)
  await page.getByRole('button', { name: '账户类型', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '账户类型', exact: true })
  await dialog
    .getByRole('radio', { name: '统一账户（推荐）', exact: true })
    .check()
  await expect(
    dialog.getByRole('button', { name: '确认账户类型', exact: true }),
  ).toBeDisabled()
  resolve()
  await expect(
    dialog.getByRole('button', { name: '确认账户类型', exact: true }),
  ).toBeEnabled()
  await dialog
    .getByRole('button', { name: '确认账户类型', exact: true })
    .click()
  await expect(dialog.getByRole('alert')).toContainText('已取消签名')
})

test('账户类型拒绝切换时保留原状态，不误报成功', async ({ page }) => {
  await mockExchange(page)
  let attempts = 0
  await page.route(
    'https://api.hyperliquid-testnet.xyz/info',
    async (route) => {
      if (route.request().postDataJSON().type === 'userAbstraction')
        await route.fulfill({ json: 'unifiedAccount' })
      else await route.fallback()
    },
  )
  await page.route(
    'https://api.hyperliquid-testnet.xyz/exchange',
    async (route) => {
      if (route.request().postDataJSON().action.type !== 'userSetAbstraction')
        return route.fallback()
      attempts++
      await route.fulfill({
        json: { status: 'err', response: '请先关闭仓位并撤销挂单' },
      })
    },
  )
  await page.goto('/')
  await page.getByRole('button', { name: '连接钱包', exact: true }).click()
  await page.getByRole('button', { name: '浏览器钱包 连接 →' }).click()
  const button = page.getByRole('button', { name: '账户类型', exact: true })
  await expect(button).toContainText('统一')
  await button.click()
  const dialog = page.getByRole('dialog', { name: '账户类型', exact: true })
  await dialog.getByRole('radio', { name: '手动', exact: true }).check()
  await dialog
    .getByRole('button', { name: '确认账户类型', exact: true })
    .click()
  await expect(dialog.getByRole('alert')).toContainText('交易所拒绝')
  await expect(dialog.getByRole('alert')).toContainText('关闭仓位')
  await dialog.getByRole('button', { name: '关闭账户类型' }).click()
  await expect(button).toContainText('统一')
  expect(attempts).toBe(1)
})

test('账户类型未连接或取消签名，不发送切换请求', async ({ page }) => {
  const { writes } = await mockExchange(page)
  await page.addInitScript(() => {
    const provider = window.ethereum
    if (!provider) throw new Error('Missing mock wallet')
    const request = provider.request.bind(provider)
    provider.request = (async (params: {
      method: string
      params?: unknown[]
    }) => {
      if (
        params.method === 'eth_signTypedData_v4' &&
        String(params.params?.[1]).includes('UserSetAbstraction')
      )
        throw { code: 4001, message: 'User rejected account type' }
      return request(params as Parameters<typeof request>[0])
    }) as typeof provider.request
  })
  await page.goto('/')
  const button = page.getByRole('button', { name: '账户类型', exact: true })
  await button.click()
  const dialog = page.getByRole('dialog', { name: '账户类型', exact: true })
  await expect(
    dialog.getByRole('button', { name: '确认账户类型', exact: true }),
  ).toBeDisabled()
  await dialog.getByRole('button', { name: '关闭账户类型' }).click()
  await expect(page.getByRole('textbox', { name: '只读钱包地址' })).toHaveCount(
    0,
  )
  await page.getByRole('button', { name: '连接钱包', exact: true }).click()
  await page.getByRole('button', { name: '浏览器钱包 连接 →' }).click()
  await expect(
    page.getByRole('dialog', { name: '连接', exact: true }),
  ).toHaveCount(0)
  await expect(button).toContainText('手动')
  await button.click()
  await dialog
    .getByRole('radio', { name: '统一账户（推荐）', exact: true })
    .check()
  await dialog
    .getByRole('button', { name: '确认账户类型', exact: true })
    .click()
  await expect(dialog.getByRole('alert')).toContainText('已取消签名')
  await dialog.getByRole('button', { name: '关闭账户类型' }).click()
  await expect(button).toContainText('手动')
  expect(writes).toHaveLength(0)
})

test('手机盘口精简档位后仍保留最优买卖价', async ({ page }) => {
  await mockExchange(page)
  await page.setViewportSize({ width: 375, height: 812 })
  await page.goto('/')
  const book = page.getByRole('region', { name: '订单簿', exact: true })
  await expect(book.getByText('70,001', { exact: true })).toBeVisible()
  await expect(book.getByText('69,999', { exact: true })).toBeVisible()
  await expect(book.getByText('70,009', { exact: true })).toBeHidden()
  await expect(book.getByText('69,991', { exact: true })).toBeHidden()
})

test('实时蜡烛先到达时，历史补齐后图表仍展示完整走势', async ({ page }) => {
  const { releaseHistory } = await mockExchange(page, 'delayed-history')
  await page.goto('/')
  await expect(
    page.getByRole('region', { name: /基础版 K 线图，已加载 0 根/ }),
  ).toBeVisible()
  releaseHistory()
  await expect(
    page.getByRole('region', { name: /基础版 K 线图，已加载 40 根/ }),
  ).toBeVisible()
  // 直接检查实际画出的蜡烛，避免 DOM 数量正确但画布只显示一根。
  await expect
    .poll(() =>
      page
        .getByRole('region', { name: /基础版 K 线图/ })
        .locator('canvas')
        .evaluateAll((canvases) => {
          const greenRgb = getComputedStyle(document.documentElement)
            .getPropertyValue('--fx-sem-g')
            .trim()
            .split(/\s+/)
            .map(Number)
          let maximumBars = 0
          for (const canvas of canvases) {
            if (!(canvas instanceof HTMLCanvasElement)) continue
            const ctx = canvas.getContext('2d')
            if (!ctx || !canvas.width || !canvas.height) continue
            const pixels = ctx.getImageData(
              0,
              0,
              canvas.width,
              canvas.height,
            ).data
            for (let y = 0; y < canvas.height; y += 4) {
              let bars = 0,
                previousGreen = false
              for (let x = 0; x < canvas.width; x++) {
                const i = (y * canvas.width + x) * 4
                const green =
                  pixels[i] === greenRgb[0] &&
                  pixels[i + 1] === greenRgb[1] &&
                  pixels[i + 2] === greenRgb[2]
                if (green && !previousGreen) bars++
                previousGreen = green
              }
              maximumBars = Math.max(maximumBars, bars)
            }
          }
          return maximumBars
        }),
    )
    .toBeGreaterThan(20)
})

test('限价挂单与撤单使用测试网真实资产索引，更新当前委托', async ({ page }) => {
  const { writes } = await mockExchange(page)
  await ready(page)
  await page.getByLabel('价格（USDC）').fill('65000')
  await page.getByLabel('数量（BTC）', { exact: true }).fill('0.001')
  await page.getByRole('button', { name: '下单', exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText('65,000 USDC')
  await confirmOrder(page)
  await expect(
    page.getByRole('status').filter({ hasText: '已挂单' }),
  ).toBeVisible()
  await page.getByRole('tab', { name: '当前委托', exact: true }).click()
  await page.getByRole('button', { name: '撤单', exact: true }).click()
  await expect(
    page.getByRole('status').filter({ hasText: '已撤销' }),
  ).toBeVisible()
  await expect(page.getByText('暂无记录', { exact: true })).toBeVisible()
  expect(writes.map((a) => a.type)).toEqual(['order', 'cancel'])
  expect(writes[0].orders?.[0].a).toBe(3)
})

test('市价成交后可以部分减仓、全部平仓，并使用 reduce-only', async ({
  page,
}) => {
  const { writes } = await mockExchange(page)
  await ready(page)
  await page.getByRole('tab', { name: '市价单', exact: true }).click()
  await page.getByLabel('数量（BTC）', { exact: true }).fill('0.001')
  await page.getByRole('button', { name: '下单', exact: true }).click()
  await confirmOrder(page)
  await page.getByRole('button', { name: '市价', exact: true }).click()
  await expect(
    page.getByRole('dialog').getByLabel('数量（BTC）', { exact: true }),
  ).toHaveValue('0.001')
  await page
    .getByRole('dialog')
    .getByLabel('数量（BTC）', { exact: true })
    .fill('0.0005')
  await expect(page.getByRole('dialog')).toContainText('只减仓已启用')
  await page.getByRole('button', { name: '市价平仓', exact: true }).click()
  await expect(
    page.getByRole('cell', { name: '0.0005', exact: true }),
  ).toBeVisible()
  await page.getByRole('button', { name: '市价', exact: true }).click()
  await page.getByRole('button', { name: '市价平仓', exact: true }).click()
  await expect(page.getByText('暂无记录', { exact: true })).toBeVisible()
  expect(writes[1].orders?.[0]).toMatchObject({
    a: 3,
    b: false,
    r: true,
    s: '0.0005',
    t: { limit: { tif: 'Ioc' } },
  })
  expect(writes.length).toBe(3)
})

test('只减仓没有仓位时立即阻止下单，取消勾选恢复普通订单', async ({ page }) => {
  const { writes } = await mockExchange(page)
  await ready(page)
  await page.getByLabel('数量（BTC）', { exact: true }).fill('0.001')
  await page.getByRole('checkbox', { name: '只减仓 Reduce-only' }).check()
  await expect(
    page.getByRole('button', { name: '当前方向没有可减仓位', exact: true }),
  ).toBeDisabled()
  await expect(page.getByRole('slider', { name: '下单比例' })).toBeDisabled()
  await page.getByRole('checkbox', { name: '只减仓 Reduce-only' }).uncheck()
  await expect(
    page.getByRole('button', { name: '下单', exact: true }),
  ).toBeEnabled()
  await expect(page.getByLabel('数量（BTC）', { exact: true })).toHaveValue(
    '0.001',
  )
  expect(writes).toHaveLength(0)
})

for (const held of [0.01, -0.01]) {
  test(`只减仓${held > 0 ? '平多' : '平空'}校验方向和上限，隐藏的止盈止损不提交`, async ({
    page,
  }) => {
    const exchange = await mockExchange(page)
    exchange.setPosition(held)
    await ready(page)
    const openSide = held > 0 ? '买入 / 做多' : '卖出 / 做空'
    const closeSide = held > 0 ? '卖出 / 做空' : '买入 / 做多'
    await page.getByRole('tab', { name: openSide, exact: true }).click()
    await page.getByRole('tab', { name: '市价单', exact: true }).click()
    await page
      .getByRole('checkbox', { name: '止盈 / 止损', exact: true })
      .check()
    await page
      .getByLabel('止盈价格', { exact: true })
      .fill(held > 0 ? '72000' : '68000')
    await page.getByRole('checkbox', { name: '只减仓 Reduce-only' }).check()
    await expect(
      page.getByRole('button', { name: '当前方向没有可减仓位' }),
    ).toBeDisabled()
    await page.getByRole('tab', { name: closeSide, exact: true }).click()
    await page.getByLabel('数量（BTC）', { exact: true }).fill('0.02')
    await expect(
      page.getByRole('button', { name: '只减仓数量超过可平仓位' }),
    ).toBeDisabled()
    await page.getByRole('slider', { name: '下单比例' }).focus()
    await page.getByRole('slider', { name: '下单比例' }).press('Home')
    await page.getByRole('slider', { name: '下单比例' }).press('End')
    await expect(page.getByLabel('数量（BTC）', { exact: true })).toHaveValue(
      '0.01',
    )
    await page.getByRole('button', { name: '下单', exact: true }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toContainText(held > 0 ? '平多' : '平空')
    await expect(dialog).toContainText('0.01 BTC')
    await confirmOrder(page)
    await expect.poll(() => exchange.writes.length).toBe(1)
    expect(exchange.writes[0].orders).toHaveLength(1)
    expect(exchange.writes[0].orders?.[0]).toMatchObject({
      r: true,
      b: held < 0,
      s: '0.01',
    })
    expect(exchange.writes[0].grouping).toBe('na')
    await expect(
      page.getByRole('button', { name: '当前方向没有可减仓位' }),
    ).toBeDisabled()
  })
}

test('成功 HTTP 中的拒单不能展示为下单成功', async ({ page }) => {
  await mockExchange(page, 'reject')
  await ready(page)
  await page.getByLabel('数量（BTC）', { exact: true }).fill('0.001')
  await page.getByRole('button', { name: '下单', exact: true }).click()
  await confirmOrder(page)
  await expect(
    page.getByRole('status').filter({ hasText: 'Insufficient margin' }),
  ).toBeVisible()
  await expect(page.locator('[data-feedback="error"]')).toContainText(
    'Insufficient margin',
  )
  await expect(
    page.getByRole('button', { name: '查询未确认订单' }),
  ).toHaveCount(0)
})

test('响应丢失后刷新仍阻止重复下单，通过 cloid 核对恢复', async ({ page }) => {
  const { writes } = await mockExchange(page, 'lost-response')
  await ready(page)
  const chart = page.getByRole('region', { name: '行情图表', exact: true })
  const before = await chart.boundingBox()
  await page.getByLabel('数量（BTC）', { exact: true }).fill('0.001')
  await page.getByRole('button', { name: '下单', exact: true }).click()
  await confirmOrder(page)
  const reconcile = page.getByRole('button', { name: '查询未确认订单' })
  await expect(reconcile).toBeEnabled()
  expect(await chart.boundingBox()).toEqual(before)
  await page.reload()
  await expect(
    page.getByRole('button', {
      name: '等待账户数据 / 核对未确认订单',
      exact: true,
    }),
  ).toBeDisabled()
  await expect(reconcile).toBeEnabled()
  await reconcile.click()
  await expect(
    page
      .getByRole('status')
      .filter({ hasText: '订单核对：1/1 笔查到记录。#100 open' }),
  ).toBeVisible()
  expect(await chart.boundingBox()).toEqual(before)
  expect(writes).toHaveLength(1)
})

test('用户拒绝会话授权后保持只读，不发送交易请求', async ({ page }) => {
  const { writes } = await mockExchange(page, 'deny-signature')
  await page.goto('/')
  await page.getByRole('button', { name: '连接钱包', exact: true }).click()
  await page.getByRole('button', { name: '浏览器钱包 连接 →' }).click()
  await expect(
    page.getByRole('status').filter({ hasText: '签名已取消' }),
  ).toBeVisible()
  await expect(page.locator('[data-feedback="warning"]')).toContainText(
    '签名已取消',
  )
  await expect(
    page.getByRole('button', { name: '重新连接并核验' }),
  ).toBeEnabled()
  expect(writes).toHaveLength(0)
})

test('账户切换使待签名预览失效，不能继续发送旧账户订单', async ({ page }) => {
  const { writes } = await mockExchange(page)
  await ready(page)
  await page.getByLabel('数量（BTC）', { exact: true }).fill('0.001')
  await page.getByRole('button', { name: '下单', exact: true }).click()
  await page.evaluate(() =>
    window.dispatchEvent(new Event('test-account-change')),
  )
  await expect(page.getByRole('dialog', { name: '确认订单' })).toHaveCount(0)
  await expect(
    page.getByRole('dialog', { name: '连接', exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: '浏览器钱包 连接 →' }),
  ).toBeEnabled()
  expect(writes).toHaveLength(0)
})

test('杠杆独立确认，超精度输入被阻止在签名前', async ({ page }) => {
  const { writes } = await mockExchange(page)
  await ready(page)
  await page.getByRole('button', { name: '调整杠杆', exact: true }).click()
  await page.getByLabel('杠杆倍数').fill('3')
  await page.getByRole('button', { name: '应用杠杆设置' }).click()
  await expect(
    page.getByRole('status').filter({ hasText: '3 倍杠杆' }),
  ).toBeVisible()
  await page.getByLabel('数量（BTC）', { exact: true }).fill('0.000001')
  await page.getByRole('button', { name: '下单', exact: true }).click()
  await expect(
    page.getByRole('region', { name: '下单面板' }).getByRole('alert'),
  ).toContainText('数量精度')
  expect(writes).toHaveLength(1)
  expect(writes[0]).toMatchObject({
    type: 'updateLeverage',
    asset: 3,
    leverage: 3,
    isCross: true,
  })
})

test('深度图双侧累计、悬停实时更新并保留 K 线实例和周期', async ({ page }) => {
  const { pushMarket, writes, socketConnections } = await mockExchange(page)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('/')
  const basic = page.getByRole('region', { name: /基础版 K 线图/ })
  await expect(basic).toHaveAttribute('aria-label', /已加载 40 根/)
  await page.getByRole('button', { name: '1分', exact: true }).click()
  await basic
    .locator('canvas')
    .first()
    .evaluate((canvas) => canvas.setAttribute('data-preserved', 'true'))
  await page.getByRole('button', { name: '深度图', exact: true }).click()
  const depth = page.getByRole('region', { name: '市场深度图' })
  await expect(depth).toBeVisible()
  await expect(basic).toBeHidden()
  await expect(
    page.getByRole('button', { name: '指标', exact: true }),
  ).toBeHidden()
  const slider = depth.getByRole('slider')
  await slider.focus()
  await slider.press('End')
  await expect(depth.getByRole('tooltip', { name: '买盘' })).toContainText(
    '69,980.0',
  )
  await expect(depth.getByRole('tooltip', { name: '卖盘' })).toContainText(
    '70,020.0',
  )
  await expect(depth.getByRole('tooltip', { name: '卖盘' })).toContainText(
    '20.00000',
  )
  const oldPath = await depth
    .locator('[data-depth-side="buy"]')
    .getAttribute('d')
  expect(oldPath).toContain(' H ')
  expect(oldPath).not.toMatch(/NaN|Infinity/)
  await pushMarket('BTC', 71000)
  await expect(depth.getByRole('tooltip', { name: '卖盘' })).toContainText(
    '71,020.0',
  )
  await slider.press('Escape')
  await expect(depth.getByRole('tooltip')).toHaveCount(0)
  await slider.hover({ position: { x: 20, y: 60 } })
  await expect(depth.getByRole('tooltip')).toHaveCount(2)
  await page.screenshot({
    path: 'output-tdd/playwright/depth-chart/desktop.png',
  })
  await page.getByRole('button', { name: '全屏图表' }).click()
  await expect(depth).toBeVisible()
  await expect
    .poll(async () => (await depth.boundingBox())?.width ?? 0)
    .toBeGreaterThan(1300)
  await page.getByRole('button', { name: '退出全屏' }).click()
  await page.getByRole('button', { name: '基础版', exact: true }).click()
  await expect(basic).toBeVisible()
  await expect(basic.locator('canvas[data-preserved]')).toHaveCount(1)
  await expect(
    page.getByRole('button', { name: '1分', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: 'TradingView', exact: true }).click()
  const tvCanvas = page.frameLocator('iframe').locator('canvas').first()
  await expect(tvCanvas).toBeVisible()
  await tvCanvas.evaluate((canvas) =>
    canvas.setAttribute('data-preserved', 'true'),
  )
  await page.getByRole('button', { name: '深度图', exact: true }).click()
  await expect(tvCanvas).toBeHidden()
  await page.getByRole('button', { name: 'TradingView', exact: true }).click()
  await expect(tvCanvas).toBeVisible()
  await expect(tvCanvas).toHaveAttribute('data-preserved', 'true')
  expect(socketConnections).toHaveLength(2)
  expect(writes).toEqual([])
  expect(errors).toEqual([])
})

test('手机深度图适应窄屏，切币清除悬停且使用新市场单位', async ({ page }) => {
  await mockExchange(page, 'sparse-depth')
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await page.getByRole('button', { name: '深度图', exact: true }).click()
  const depth = page.getByRole('region', { name: '市场深度图' })
  await expect(depth).toContainText('累计挂单 (BTC)')
  await depth.getByRole('slider').focus()
  await depth.getByRole('slider').press('End')
  await expect(depth.getByRole('tooltip')).toHaveCount(2)
  for (const tooltip of await depth.getByRole('tooltip').all()) {
    const box = await tooltip.boundingBox()
    expect(box && box.x >= 0 && box.x + box.width <= 390).toBeTruthy()
  }
  await page.screenshot({
    path: 'output-tdd/playwright/depth-chart/mobile.png',
  })
  await page.getByRole('button', { name: '交易市场' }).click()
  await page.getByRole('option', { name: 'ETH / USDC', exact: true }).click()
  await expect(depth).toContainText('累计挂单 (ETH)')
  await expect(depth.getByRole('tooltip')).toHaveCount(0)
  await expect(
    page.getByRole('button', { name: '深度图', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true')
})

test('实际图表引擎可切换，切币和切周期继续使用 Hyperliquid 行情', async ({
  page,
}) => {
  const { writes } = await mockExchange(page)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/')
  await expect(
    page.getByRole('region', { name: /基础版 K 线图，已加载 40 根/ }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'TradingView', exact: true }).click()
  await expect(
    page.getByRole('region', {
      name: /TradingView K 线图，已加载 [1-9]\d* 根/,
    }),
  ).toBeVisible({ timeout: 15000 })
  await expect(
    page.frameLocator('iframe').locator('canvas').first(),
  ).toBeVisible()
  await page.getByRole('button', { name: '交易市场' }).click()
  await page.getByRole('option', { name: 'ETH / USDC', exact: true }).click()
  await page.getByRole('button', { name: '1分', exact: true }).click()
  await expect(page.getByRole('heading', { name: '交易 ETH' })).toHaveText(
    '交易 ETH',
  )
  await expect(
    page.getByRole('region', {
      name: /TradingView K 线图，已加载 [1-9]\d* 根/,
    }),
  ).toBeVisible()
  await page.getByRole('button', { name: '基础版', exact: true }).click()
  await expect(
    page.getByRole('region', { name: /基础版 K 线图，已加载 [1-9]\d* 根/ }),
  ).toBeVisible()
  await expect(
    page
      .getByRole('region', { name: /基础版 K 线图/ })
      .locator('canvas')
      .first(),
  ).toBeVisible()
  expect(errors).toEqual([])
  expect(writes).toEqual([])
})

test('网络恢复后重新校准当前显示的 KLineChart 和 TradingView', async ({
  page,
}) => {
  const exchange = await mockExchange(page)
  await page.goto('/')
  await expect(
    page.getByRole('region', { name: /基础版 K 线图，已加载 40 根/ }),
  ).toBeVisible()

  const syncing = page.getByText('正在更新 K 线…', { exact: true })
  let releaseHistory = exchange.pauseCandleHistory()
  let before = exchange.candleHistoryRequests()
  exchange.disconnectMarket()
  await expect
    .poll(() => exchange.candleHistoryRequests())
    .toBeGreaterThan(before)
  if (await page.getByRole('button', { name: '关闭提示' }).isVisible())
    await page.getByRole('button', { name: '关闭提示' }).click()
  await expect(syncing).toBeVisible()
  releaseHistory()
  await expect(syncing).toHaveCount(0)

  releaseHistory = exchange.pauseCandleHistory()
  await page.getByRole('button', { name: 'TradingView', exact: true }).click()
  await expect(syncing).toBeVisible()
  const tradingViewRegion = page.getByRole('region', {
    name: /TradingView K 线图，已加载 [1-9]\d* 根/,
  })
  const klineRegion = page.getByRole('region', {
    name: /基础版 K 线图，已加载 40 根/,
  })
  await expect(klineRegion).toBeVisible()
  await expect(tradingViewRegion).toBeHidden()
  releaseHistory()
  await expect(syncing).toHaveCount(0)
  await expect(tradingViewRegion).toBeVisible()
  releaseHistory = exchange.pauseCandleHistory()
  before = exchange.candleHistoryRequests()
  exchange.disconnectMarket()
  await expect
    .poll(() => exchange.candleHistoryRequests())
    .toBeGreaterThan(before)
  await expect(syncing).toBeVisible()
  releaseHistory()
  await expect(syncing).toHaveCount(0)
  if (await page.getByRole('button', { name: '关闭提示' }).isVisible())
    await page.getByRole('button', { name: '关闭提示' }).click()
  await page.getByRole('button', { name: '基础版', exact: true }).click()
  await expect(syncing).toHaveCount(0)
  await expect(klineRegion).toBeVisible()
  before = exchange.candleHistoryRequests()
  for (let i = 0; i < 3; i++) {
    await page.getByRole('button', { name: 'TradingView', exact: true }).click()
    await expect(tradingViewRegion).toBeVisible()
    await expect(syncing).toHaveCount(0)
    await page.getByRole('button', { name: '基础版', exact: true }).click()
    await expect(klineRegion).toBeVisible()
    await expect(syncing).toHaveCount(0)
  }
  expect(exchange.candleHistoryRequests()).toBe(before)
})

test('K 线恢复期间连续切换引擎，最终显示最后一次选择并继续接收推送', async ({
  page,
}) => {
  const exchange = await mockExchange(page)
  await recordChartText(page)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/')
  const basic = page.getByRole('region', { name: /基础版 K 线图/ })
  await expect(basic).toHaveAttribute('aria-label', /已加载 40 根/)
  await page.getByRole('button', { name: 'TradingView', exact: true }).click()
  await expect(page.frameLocator('iframe').locator('body')).toContainText(
    /开=\d/,
  )
  const before = exchange.candleHistoryRequests()
  const release = exchange.pauseCandleHistory()
  exchange.disconnectMarket()
  await expect
    .poll(() => exchange.candleHistoryRequests())
    .toBeGreaterThan(before)
  if (await page.getByRole('button', { name: '关闭提示' }).isVisible())
    await page.getByRole('button', { name: '关闭提示' }).click()
  await page.getByRole('button', { name: '基础版', exact: true }).click()
  await page.getByRole('button', { name: 'TradingView', exact: true }).click()
  await page.getByRole('button', { name: '基础版', exact: true }).click()
  release()
  await expect(page.getByText('正在更新 K 线…', { exact: true })).toHaveCount(0)
  await expect(basic).toBeVisible()
  exchange.pushMarket('BTC', 70087)
  await expect.poll(() => chartTextPoint(page, '70,087')).not.toBeNull()
  expect(errors).toEqual([])
  expect(exchange.writes).toEqual([])
})

test('健康连接返回标签页不请求历史，两个图表实例保持不变', async ({ page }) => {
  const exchange = await mockExchange(page)
  await page.goto('/')
  const basic = page.getByRole('region', { name: /基础版 K 线图/ })
  await expect(basic).toHaveAttribute('aria-label', /已加载 40 根/)
  await page.getByRole('button', { name: 'TradingView', exact: true }).click()
  await expect(page.frameLocator('iframe').locator('body')).toContainText(
    /开=\d/,
  )
  const iframe = await page.locator('iframe').getAttribute('id')
  for (const name of ['TradingView', '基础版']) {
    const toast = page.getByRole('button', { name: '关闭提示' })
    if (await toast.isVisible()) await toast.click()
    await page.getByRole('button', { name, exact: true }).click()
    const before = exchange.candleHistoryRequests()
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        value: 'hidden',
      })
      document.dispatchEvent(new Event('visibilitychange'))
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        value: 'visible',
      })
      document.dispatchEvent(new Event('visibilitychange'))
      window.dispatchEvent(new Event('online'))
    })
    exchange.pushMarket('BTC', 70087)
    await expect(page.getByText('正在更新 K 线…', { exact: true })).toHaveCount(
      0,
    )
    await page.waitForTimeout(400)
    expect(exchange.candleHistoryRequests()).toBe(before)
    expect(await page.locator('iframe').getAttribute('id')).toBe(iframe)
  }
  expect(exchange.writes).toEqual([])
})

test('K 线页面长时间隐藏后恢复，基础版仍能向左加载历史', async ({ page }) => {
  await mockExchange(page)
  const ends: number[] = []
  await page.route(
    'https://api.hyperliquid-testnet.xyz/info',
    async (route) => {
      const request = route.request().postDataJSON()
      if (
        request.type !== 'candleSnapshot' ||
        request.req.endTime === undefined
      ) {
        await route.fallback()
        return
      }
      const { startTime, endTime, coin, interval } = request.req
      ends.push(endTime)
      const data = []
      for (let t = startTime; t <= endTime; t += 300000) {
        data.push({
          t,
          T: t + 299999,
          s: coin,
          i: interval,
          o: '69900',
          h: '70100',
          l: '69800',
          c: '70000',
          v: '1',
          n: 1,
        })
      }
      await route.fulfill({ json: data })
    },
  )
  await page.clock.install()
  await page.goto('/')
  const basic = page.getByRole('region', { name: /基础版 K 线图/ })
  await expect(basic).toHaveAttribute('aria-label', /已加载 300 根/)
  await expect(basic.locator('.pointer-events-auto')).toHaveCount(0)
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'hidden',
    })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await page.clock.fastForward(2 * 60 * 60 * 1000)
  const before = ends.length
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await expect.poll(() => ends.length).toBeGreaterThan(before)
  await expect(page.getByText('正在更新 K 线…', { exact: true })).toHaveCount(0)
  await expect(basic.locator('.pointer-events-auto')).toHaveCount(0)
  const oldestRequest = Math.min(...ends)
  const canvas = await basic.locator('canvas').first().boundingBox()
  if (!canvas) throw new Error('缺少基础版画布')
  for (let i = 0; i < 8; i++) {
    await page.mouse.move(canvas.x + 80, canvas.y + 100)
    await page.mouse.down()
    await page.mouse.move(canvas.x + canvas.width - 80, canvas.y + 100, {
      steps: 12,
    })
    await page.mouse.up()
  }
  await expect.poll(() => Math.min(...ends)).toBeLessThan(oldestRequest)
})

test('TradingView 模拟休眠十二小时后只补缺口，重复返回事件不叠加请求', async ({
  page,
}) => {
  const exchange = await mockExchange(page)
  await recordChartText(page)
  const requests: { startTime: number; endTime: number }[] = []
  await page.route(
    'https://api.hyperliquid-testnet.xyz/info',
    async (route) => {
      const request = route.request().postDataJSON()
      if (request.type !== 'candleSnapshot') return route.fallback()
      const { startTime, endTime, coin, interval } = request.req
      requests.push({ startTime, endTime })
      const data = []
      for (let t = startTime; t <= endTime; t += 300000)
        data.push({
          t,
          T: t + 299999,
          s: coin,
          i: interval,
          o: '69900',
          h: '70100',
          l: '69800',
          c: '70000',
          v: '1',
          n: 1,
        })
      await route.fulfill({ json: data })
    },
  )
  await page.clock.install()
  await page.goto('/')
  await expect(
    page.getByRole('region', { name: /基础版 K 线图/ }),
  ).toHaveAttribute('aria-label', /已加载 300 根/)
  await page.getByRole('button', { name: 'TradingView', exact: true }).click()
  await expect(page.frameLocator('iframe').locator('body')).toContainText(
    /开=\d/,
  )
  const iframe = await page.locator('iframe').getAttribute('id')
  const before = requests.length
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'hidden',
    })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await page.clock.fastForward(12 * 60 * 60 * 1000)
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    })
    for (let i = 0; i < 4; i++) {
      document.dispatchEvent(new Event('visibilitychange'))
      window.dispatchEvent(new Event('online'))
    }
  })
  await expect.poll(() => requests.length).toBeGreaterThan(before)
  await expect(page.getByText('正在更新 K 线…', { exact: true })).toHaveCount(0)
  await page.waitForTimeout(500)
  const recovered = requests.slice(before)
  expect(recovered).toHaveLength(1)
  expect(recovered[0].endTime - recovered[0].startTime).toBeLessThan(
    150 * 300000,
  )
  expect(recovered[0].endTime - recovered[0].startTime).toBeGreaterThan(
    12 * 60 * 60 * 1000,
  )
  expect(await page.locator('iframe').getAttribute('id')).toBe(iframe)
  await expect(page.frameLocator('iframe').locator('body')).toContainText(
    /开=\d/,
  )
  const current = await page.evaluate(
    () => Math.floor(Date.now() / 300000) * 300000,
  )
  exchange.pushMarket('BTC', 70089, current)
  await expect(page.frameLocator('iframe').locator('body')).toContainText(
    /收=70,?089/,
  )
  const toast = page.getByRole('button', { name: '关闭提示' })
  if (await toast.isVisible()) await toast.click()
  await page.getByRole('button', { name: '基础版', exact: true }).click()
  await expect.poll(() => chartTextPoint(page, '70,089')).not.toBeNull()
  expect(requests).toHaveLength(before + 1)
  await page.screenshot({
    path: 'output-tdd/playwright/chart-recovery/after-simulated-sleep.png',
  })
  expect(exchange.writes).toEqual([])
})

test('K 线历史请求失败后自动重试，WebSocket 断开重连后继续实时更新', async ({
  page,
}) => {
  const exchange = await mockExchange(page)
  await recordChartText(page)
  let rejected = false
  await page.route(
    'https://api.hyperliquid-testnet.xyz/info',
    async (route) => {
      const request = route.request().postDataJSON()
      if (
        !rejected &&
        request.type === 'candleSnapshot' &&
        request.req.endTime !== undefined
      ) {
        rejected = true
        await route.fulfill({ status: 503, json: { error: 'Unavailable' } })
      } else await route.fallback()
    },
  )
  await page.goto('/')
  const basic = page.getByRole('region', { name: /基础版 K 线图/ })
  const syncing = page.getByText('正在更新 K 线…', { exact: true })
  await expect(basic).toHaveAttribute('aria-label', /已加载 40 根/)
  await expect(syncing).toHaveCount(0)
  expect(rejected).toBe(true)
  const connections = exchange.socketConnections.length
  const requests = exchange.candleHistoryRequests()
  const release = exchange.pauseCandleHistory()
  exchange.disconnectMarket()
  await expect
    .poll(() => exchange.socketConnections.length)
    .toBeGreaterThan(connections)
  await expect
    .poll(() => exchange.candleHistoryRequests())
    .toBeGreaterThan(requests)
  await expect(syncing).toBeVisible()
  release()
  await expect(syncing).toHaveCount(0)
  exchange.pushMarket('BTC', 70093)
  await expect.poll(() => chartTextPoint(page, '70,093')).not.toBeNull()
  expect(exchange.writes).toEqual([])
})

test('切币与周期复用图表和行情连接，切换引擎保留实例', async ({ page }) => {
  let navigations = 0
  page.on('request', (r) => {
    if (r.isNavigationRequest() && r.frame() === page.mainFrame()) navigations++
  })
  const { socketConnections } = await mockExchange(page, 'slow-history')
  await page.goto('/')
  const chart = page.getByRole('region', { name: /基础版 K 线图/ })
  await expect(chart.locator('canvas').first()).toBeVisible()
  await chart
    .locator('canvas')
    .first()
    .evaluate((el) => el.setAttribute('data-instance-proof', 'original'))
  await page.getByRole('button', { name: '交易市场' }).click()
  await page.getByRole('option', { name: 'ETH / USDC', exact: true }).click()
  await page.getByRole('button', { name: '1分', exact: true }).click()
  await expect(page.getByRole('heading', { name: '交易 ETH' })).toHaveText(
    '交易 ETH',
  )
  await expect(chart.locator('canvas').first()).toHaveAttribute(
    'data-instance-proof',
    'original',
  )
  await page.getByRole('button', { name: 'TradingView', exact: true }).click()
  await expect(
    page.frameLocator('iframe').locator('canvas').first(),
  ).toBeVisible()
  await page
    .locator('iframe')
    .evaluate((el) => el.setAttribute('data-instance-proof', 'tv'))
  await page.getByRole('button', { name: '基础版', exact: true }).click()
  await expect(chart.locator('canvas').first()).toHaveAttribute(
    'data-instance-proof',
    'original',
  )
  await page.getByRole('button', { name: 'TradingView', exact: true }).click()
  await expect(page.locator('iframe')).toHaveAttribute(
    'data-instance-proof',
    'tv',
  )
  for (const name of ['BTC', 'SOL']) {
    await page.getByRole('button', { name: '交易市场' }).click()
    await page
      .getByRole('option', { name: `${name} / USDC`, exact: true })
      .click()
  }
  const tvBody = page.frameLocator('iframe').locator('body')
  await expect(tvBody).toContainText('SOL / USDC 永续')
  await expect(tvBody).toContainText(/开=\d/, { timeout: 15000 })
  expect(navigations).toBe(1)
  expect(socketConnections).toHaveLength(2)
})

test('输入框仅外框高亮，账户在交易侧栏，订单类型使用直线 Tab', async ({
  page,
}) => {
  await mockExchange(page)
  await page.setViewportSize({ width: 1440, height: 1080 })
  await page.goto('/')
  const input = page.getByLabel('价格（USDC）')
  await input.focus()
  expect(await input.evaluate((el) => getComputedStyle(el).boxShadow)).toBe(
    'none',
  )
  await expect(
    page.getByRole('tab', { name: '限价单', exact: true }),
  ).toBeVisible()
  const order = await page
    .getByRole('region', { name: '下单面板' })
    .boundingBox()
  const account = await page
    .getByRole('region', { name: '账户概览' })
    .boundingBox()
  expect(
    account &&
      order &&
      Math.abs(account.x - order.x) < 2 &&
      Math.abs(account.width - order.width) < 2,
  ).toBeTruthy()
  const records = await page
    .getByRole('region', { name: '交易记录', exact: true })
    .boundingBox()
  const chart = await page
    .getByRole('region', { name: '行情图表', exact: true })
    .boundingBox()
  const market = await page
    .getByRole('region', { name: '市场概览', exact: true })
    .boundingBox()
  const book = await page
    .getByRole('region', { name: '订单簿', exact: true })
    .boundingBox()
  expect(account && records && Math.abs(account.y - records.y) < 2).toBeTruthy()
  expect(
    chart &&
      book &&
      order &&
      Math.abs(chart.y - book.y) < 2 &&
      Math.abs(book.y - order.y) < 2,
  ).toBeTruthy()
  expect(
    market && chart && Math.abs(market.width - chart.width) < 2,
  ).toBeTruthy()
})

test('保证金模式草稿可取消；确认后发送正确参数并回读设置', async ({ page }) => {
  const { writes } = await mockExchange(page)
  await ready(page)
  const trigger = page.getByRole('button', {
    name: '调整保证金模式',
    exact: true,
  })
  await expect(trigger).toContainText('全仓')
  await trigger.click()
  await page.getByRole('radio', { name: '逐仓', exact: true }).check()
  await page
    .getByRole('dialog')
    .getByRole('button', { name: '关闭设置', exact: true })
    .click()
  expect(writes).toHaveLength(0)
  await expect(trigger).toContainText('全仓')
  await trigger.click()
  await expect(
    page.getByRole('radio', { name: '全仓', exact: true }),
  ).toBeChecked()
  await page.getByRole('radio', { name: '逐仓', exact: true }).check()
  await page
    .getByRole('button', { name: '确认保证金模式', exact: true })
    .click()
  await expect(trigger).toContainText('逐仓')
  expect(writes).toEqual([
    { type: 'updateLeverage', asset: 3, leverage: 2, isCross: false },
  ])
})

test('交易所拒绝保证金调整后保留已生效设置', async ({ page }) => {
  const { writes } = await mockExchange(page, 'reject-leverage')
  await ready(page)
  await page
    .getByRole('button', { name: '调整保证金模式', exact: true })
    .click()
  await page.getByRole('radio', { name: '逐仓', exact: true }).check()
  await page
    .getByRole('button', { name: '确认保证金模式', exact: true })
    .click()
  await expect(
    page.getByRole('status').filter({ hasText: 'Cannot switch margin mode' }),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: '调整保证金模式', exact: true }),
  ).toContainText('全仓')
  expect(writes).toHaveLength(1)
})

test('按钮 hover、禁用态和 Tab 键盘切换沿用共享组件', async ({ page }) => {
  await mockExchange(page)
  await page.goto('/')
  const connect = page.getByRole('button', { name: '连接钱包', exact: true })
  await connect.hover()
  await expect(connect).toHaveCSS('background-color', 'rgb(141, 91, 246)')
  const onboarding = page.getByRole('button', { name: '连接钱包开始交易' })
  await expect(onboarding).toBeEnabled()
  await onboarding.hover()
  await expect(onboarding).toHaveCSS('background-color', 'rgb(141, 91, 246)')
  await expect(
    page.getByRole('button', { name: '5分', exact: true }),
  ).toHaveCSS('font-size', '14px')
  const limit = page.getByRole('tab', { name: '限价单', exact: true })
  await limit.focus()
  await page.keyboard.press('ArrowRight')
  await expect(
    page.getByRole('tab', { name: '市价单', exact: true }),
  ).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByLabel('价格（USDC）')).toBeHidden()
  const sell = page.getByRole('tab', { name: '卖出 / 做空', exact: true })
  await sell.click()
  await expect(sell).toHaveAttribute('aria-selected', 'true')
  const cursor = page
    .getByRole('tablist', { name: '交易方向' })
    .locator('[data-slot="cursor"]')
  await expect(cursor).toHaveCSS('background-color', 'rgb(235, 71, 71)')
  const box = await cursor.boundingBox()
  expect(box && box.width > 90 && box.height >= 27).toBeTruthy()
})

test('基础版完整周期、真实工具图标、指标和全屏可操作', async ({ page }) => {
  const { writes, socketConnections } = await mockExchange(page)
  await page.setViewportSize({ width: 1440, height: 1080 })
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/')
  const chart = page.getByRole('region', {
    name: /基础版 K 线图，已加载/,
    includeHidden: true,
  })
  await expect(page.getByRole('button', { name: '重置图表' })).toBeEnabled()
  for (const name of [
    '分时',
    '1分',
    '5分',
    '15分',
    '30分',
    '1时',
    '4时',
    '1日',
  ])
    await expect(page.getByRole('button', { name, exact: true })).toBeVisible()
  await page.getByRole('button', { name: '更多时间周期' }).click()
  await expect(
    page.getByRole('button', { name: '1月', exact: true }),
  ).toBeVisible()
  await page.getByRole('button', { name: '3分', exact: true }).click()
  await page.getByRole('button', { name: '更多时间周期' }).click()
  await expect(
    page.getByRole('button', { name: '3分', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: '3分', exact: true }).click()
  await page.getByRole('button', { name: '分时', exact: true }).click()
  await expect(
    page.getByRole('button', { name: '分时', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true')

  await page.getByRole('button', { name: '图表类型', exact: true }).click()
  await page.getByRole('button', { name: '实心蜡烛', exact: true }).click()
  await expect(
    page.getByRole('button', { name: '分时', exact: true }),
  ).toHaveAttribute('aria-pressed', 'false')
  const canvasCount = await chart.locator('canvas').count()
  await page.getByRole('button', { name: '指标', exact: true }).click()
  await page.getByRole('tab', { name: '副图指标' }).click()
  await page.getByRole('checkbox', { name: '成交量 VOL' }).uncheck()
  await expect
    .poll(() => chart.locator('canvas').count())
    .toBeLessThan(canvasCount)
  await page.getByRole('checkbox', { name: '成交量 VOL' }).check()
  await expect.poll(() => chart.locator('canvas').count()).toBe(canvasCount)
  await page
    .getByRole('dialog')
    .getByRole('button', { name: '关闭', exact: true })
    .click()
  await page.getByRole('button', { name: '重置图表' }).click()
  const fullscreen = page.getByRole('button', { name: '全屏图表' })
  await expect(fullscreen.locator('use')).toHaveAttribute(
    'href',
    '/fameex-chart-icons.svg#aspect-ratio-open2',
  )
  await fullscreen.click()
  await expect
    .poll(() => page.evaluate(() => !!document.fullscreenElement))
    .toBe(true)
  await page.getByRole('button', { name: '退出全屏' }).click()
  await expect
    .poll(() => page.evaluate(() => !!document.fullscreenElement))
    .toBe(false)
  expect(socketConnections).toHaveLength(2)
  expect(errors).toEqual([])
  expect(writes).toEqual([])
})

test('图表全屏时菜单和弹窗可操作，退出后保留输入与焦点', async ({ page }) => {
  test.setTimeout(60000)
  const { writes, socketConnections } = await mockExchange(page)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('/')
  await expect(page.getByRole('button', { name: '重置图表' })).toBeEnabled()
  await page.getByRole('button', { name: '全屏图表' }).click()
  await expect
    .poll(() => page.evaluate(() => !!document.fullscreenElement))
    .toBe(true)
  const marketPicker = page.getByRole('button', {
    name: '交易市场',
    exact: true,
  })
  await marketPicker.focus()
  await expect(marketPicker).not.toBeFocused()

  await page.getByRole('button', { name: '更多时间周期' }).click()
  // 普通 visible 断言无法识别被浏览器全屏层遮住的 body 弹层，必须实际命中按钮。
  await page.getByRole('button', { name: '3分', exact: true }).click()
  await page.getByRole('button', { name: '图表类型', exact: true }).click()
  await page.getByRole('button', { name: '空心蜡烛', exact: true }).click()
  await page.getByRole('button', { name: '交易线', exact: true }).click()
  await page.getByRole('checkbox', { name: '订单线', exact: true }).uncheck()
  await expect(
    page.getByRole('checkbox', { name: '订单线', exact: true }),
  ).not.toBeChecked()
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: '线段工具', exact: true }).click()
  await page.getByRole('button', { name: '垂直射线', exact: true }).click()
  await page.getByRole('button', { name: '光标', exact: true }).click()

  const indicators = page.getByRole('button', { name: '指标', exact: true })
  await indicators.click()
  const dialog = page.getByRole('dialog', { name: '指标', exact: true })
  await dialog.getByRole('tab', { name: '副图指标' }).click()
  await dialog.getByRole('textbox', { name: '搜索指标' }).fill('rsi')
  await dialog.getByRole('checkbox', { name: 'RSI', exact: true }).check()
  await page.screenshot({
    path: 'output-tdd/playwright/chart-fullscreen/indicators.png',
  })
  // 模拟浏览器退出全屏，弹窗仍打开，草稿和焦点应随弹层一起恢复。
  await page.evaluate(() => document.exitFullscreen())
  await expect
    .poll(() => page.evaluate(() => !!document.fullscreenElement))
    .toBe(false)
  await expect(dialog.getByRole('textbox', { name: '搜索指标' })).toHaveValue(
    'rsi',
  )
  await expect(
    dialog.getByRole('checkbox', { name: 'RSI', exact: true }),
  ).toBeChecked()
  await dialog.getByRole('textbox', { name: '搜索指标' }).fill('macd')
  await dialog.getByRole('button', { name: '关闭', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(indicators).toBeFocused()
  await expect(
    page.getByRole('button', { name: '交易市场', exact: true }),
  ).toBeVisible()

  await page.getByRole('button', { name: '全屏图表' }).click()
  await page.getByRole('button', { name: 'TradingView', exact: true }).click()
  await expect(
    page.frameLocator('iframe').locator('canvas').first(),
  ).toBeVisible()
  await expect(page.getByRole('button', { name: '重置图表' })).toBeEnabled()
  await page.getByRole('button', { name: '更多时间周期' }).click()
  await page.getByRole('button', { name: '2时', exact: true }).click()
  await page.getByRole('button', { name: '图表类型', exact: true }).click()
  await page.getByRole('button', { name: '面积图', exact: true }).click()
  await page.getByRole('button', { name: '退出全屏' }).click()
  await expect
    .poll(() => page.evaluate(() => !!document.fullscreenElement))
    .toBe(false)
  await page.getByRole('button', { name: '更多时间周期' }).click()
  await expect(
    page.getByRole('button', { name: '2时', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: '3分', exact: true }).click()
  expect(socketConnections).toHaveLength(2)
  await page.getByRole('link', { name: '预测', exact: true }).click()
  await expect(page).toHaveURL(/\/outcomes$/)
  await page.getByRole('link', { name: '交易', exact: true }).click()
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByRole('button', { name: '重置图表' })).toBeEnabled()
  await page.getByRole('button', { name: '全屏图表' }).click()
  await page.goBack()
  await expect(page).toHaveURL(/\/outcomes$/)
  await expect
    .poll(() => page.evaluate(() => !!document.fullscreenElement))
    .toBe(false)
  await page.getByRole('link', { name: '交易', exact: true }).click()
  await expect(page.getByRole('button', { name: '全屏图表' })).toBeVisible()
  expect(errors).toEqual([])
  expect(writes).toEqual([])
})

for (const mode of ['normal', 'sparse-depth'] as const) {
  test(`盘口满深度铺满、稀疏深度保持行高且贴近价差：${mode}`, async ({
    page,
  }) => {
    await mockExchange(page, mode)
    await page.setViewportSize({ width: 2560, height: 1300 })
    await page.goto('/')
    const book = page.getByRole('region', { name: '订单簿', exact: true })
    await expect(book.getByText('70,001', { exact: true })).toBeVisible()
    if (mode === 'sparse-depth') {
      await expect(book.locator('[data-side="sell"] > button')).toHaveCount(2)
      await expect(book.locator('[data-side="buy"] > button')).toHaveCount(3)
    }
    for (const height of [1300, 900, 1600]) {
      await page.setViewportSize({ width: 2560, height })
      for (const price of ['70,001', '69,999']) {
        await expect
          .poll(async () =>
            book.getByText(price, { exact: true }).evaluate((el) => {
              const rows = el.parentElement?.parentElement
              if (!rows) throw new Error('盘口容器缺失')
              const children = [...rows.children].map((child) =>
                child.getBoundingClientRect(),
              )
              const bounds = rows.getBoundingClientRect()
              const full =
                children.length >= Math.max(1, Math.floor(bounds.height / 24))
              const rowHeight = full ? bounds.height / children.length : 24
              return Math.max(
                ...children.map((child) => Math.abs(child.height - rowHeight)),
                full || rows.getAttribute('data-side') === 'sell'
                  ? Math.abs(
                      bounds.bottom - children[children.length - 1].bottom,
                    )
                  : 0,
                full || rows.getAttribute('data-side') === 'buy'
                  ? Math.abs(children[0].top - bounds.top)
                  : 0,
              )
            }),
          )
          .toBeLessThan(2)
      }
    }
  })
}

test('最新成交合并晚到历史和推送，切周期保留数据、切币对隔离且不刷新页面', async ({
  page,
}) => {
  const {
    writes,
    releaseHistory,
    socketConnections,
    tradeSubscriptions,
    pushTrade,
  } = await mockExchange(page, 'delayed-trades')
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  let navigations = 0
  page.on('request', (request) => {
    if (request.isNavigationRequest() && request.frame() === page.mainFrame())
      navigations++
  })
  await page.goto('/')
  await page.getByRole('tab', { name: '最新成交', exact: true }).click()
  const trades = page.getByRole('table', { name: 'BTC 最新成交' })
  await expect(trades.locator('tbody tr')).toHaveCount(1)
  await expect(trades.locator('tbody tr').first()).toContainText('70003.1')
  releaseHistory()
  await expect(trades.locator('tbody tr')).toHaveCount(31)
  await expect(trades.locator('tbody tr').first()).toContainText('70003.1')
  pushTrade('BTC', 31)
  pushTrade('BTC', 32)
  await expect(trades.locator('tbody tr')).toHaveCount(32)
  await expect(trades.locator('tbody tr').first()).toContainText('70003.2')
  await expect(
    trades.locator('tbody tr').first().locator('td').first(),
  ).toHaveCSS('color', 'rgb(235, 71, 71)')
  await page.getByRole('button', { name: '1分', exact: true }).click()
  await expect(
    page.getByRole('button', { name: '1分', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true')
  await expect(trades.locator('tbody tr')).toHaveCount(32)
  expect(tradeSubscriptions).toEqual(['BTC'])
  await page.getByRole('button', { name: '交易市场' }).click()
  await page.getByRole('option', { name: 'ETH / USDC', exact: true }).click()
  const eth = page.getByRole('table', { name: 'ETH 最新成交' })
  await expect(eth.locator('tbody tr')).toHaveCount(31)
  pushTrade('BTC', 99)
  pushTrade('ETH', 32)
  await expect(eth.locator('tbody tr').first()).toContainText('2003.2')
  await expect(eth).not.toContainText('700')
  await page.getByRole('tab', { name: '订单簿', exact: true }).click()
  await expect(page.getByText('70,001', { exact: true })).toBeVisible()
  expect(socketConnections).toHaveLength(2)
  expect(navigations).toBe(1)
  expect(writes).toEqual([])
  expect(errors).toEqual([])
  await expect(page.getByText(/永续 · .* · 成交价/)).toHaveCount(0)
})

for (const mode of ['reject-trades', 'empty-trades'] as const) {
  test(`最新成交明确显示${mode === 'reject-trades' ? '请求错误' : '空数据'}且盘口仍可用`, async ({
    page,
  }) => {
    await mockExchange(page, mode)
    await page.goto('/')
    await page.getByRole('tab', { name: '最新成交', exact: true }).click()
    await expect(
      page.getByText(mode === 'reject-trades' ? /成交数据异常/ : '暂无成交'),
    ).toBeVisible()
    await page.getByRole('tab', { name: '订单簿', exact: true }).click()
    await expect(page.getByText('70,001', { exact: true })).toBeVisible()
  })
}

test('突发行情按帧合并，盘口三列累计正确且标记价实时更新', async ({ page }) => {
  const { pushMarket, pushTrade, socketConnections, writes } =
    await mockExchange(page)
  await page.setViewportSize({ width: 1440, height: 1080 })
  await page.goto('/')
  const book = page.getByRole('region', { name: '订单簿', exact: true })
  await expect(book.getByText('合计 (BTC)', { exact: true })).toBeVisible()
  await expect(
    book.locator('[data-side="sell"] > button').last(),
  ).toContainText('70,0011.000001.00000')
  await expect(book.locator('[data-side="buy"] > button').nth(1)).toContainText(
    '69,9981.000002.00000',
  )
  await expect(page.getByText('实时连接', { exact: false })).toBeVisible()
  for (let i = 0; i < 1000; i++) {
    pushMarket('BTC', 70000 + i)
    pushTrade('BTC', 1000 + i)
  }
  await expect(
    book.locator('[data-side="sell"] > button').last(),
  ).toContainText('71,000')
  await expect(page.getByRole('region', { name: '市场概览' })).toContainText(
    '70,999.0',
  )
  if (process.env.PERF_CHECK === '1') {
    await page.getByRole('button', { name: /性能 ·/ }).click()
    await expect(
      page.getByRole('table', { name: '模块性能指标' }),
    ).toContainText('订单簿数据')
    await expect(
      page.getByRole('table', { name: '模块性能指标' }),
    ).toContainText('标记价 / 市场数据')
    let measured = {
      retained: 0,
      pending: 0,
      coalesced: 0,
      totalInput: 0,
      totalUpdates: 0,
    }
    await expect
      .poll(async () => {
        const download = page.waitForEvent('download')
        await page
          .getByRole('button', { name: '导出指标', exact: true })
          .click()
        const result = await download
        const path = await result.path()
        if (!path) throw new Error('指标下载失败')
        const data = JSON.parse(await readFile(path, 'utf8'))
        measured = data.modules.find((row: { id: string }) => row.id === 'book')
        return measured.totalInput
      })
      .toBeGreaterThanOrEqual(1000)
    expect(measured.retained).toBeLessThanOrEqual(40)
    expect(measured.pending).toBeLessThanOrEqual(1)
    expect(measured.coalesced).toBeGreaterThan(0)
    expect(measured.totalUpdates).toBeLessThan(measured.totalInput)
    await page.screenshot({
      path: 'output-tdd/playwright/market-performance/metrics.png',
      fullPage: true,
    })
  }
  expect(socketConnections).toHaveLength(2)
  expect(writes).toEqual([])
})

test('桌面在不同高度均占满一屏，记录与下单溢出留在面板内部', async ({
  page,
}) => {
  await mockExchange(page)
  await page.goto('/')
  for (const size of [
    { width: 1440, height: 900 },
    { width: 1366, height: 768 },
    { width: 1920, height: 1080 },
    { width: 1024, height: 600 },
  ]) {
    await page.setViewportSize(size)
    const records = await page
      .getByRole('region', { name: '交易记录', exact: true })
      .boundingBox()
    const overview = await page
      .getByRole('region', { name: '账户概览', exact: true })
      .boundingBox()
    expect(
      records && records.y <= size.height * 0.72 && records.height >= 260,
    ).toBeTruthy()
    expect(
      overview && records && Math.abs(overview.y - records.y) < 1,
    ).toBeTruthy()
    await expect(
      page.locator('#account-panel').getByRole('textbox'),
    ).toHaveCount(0)
    await expect(
      page
        .locator('#account-panel')
        .getByRole('button', { name: '查看', exact: true }),
    ).toHaveCount(0)
    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollHeight - innerHeight,
        ),
      )
      .toBeLessThanOrEqual(1)
    for (const name of [
      '行情图表',
      '订单簿',
      '下单面板',
      '交易记录',
      '账户概览',
    ]) {
      const rect = await page
        .getByRole('region', { name, exact: true })
        .boundingBox()
      expect(
        rect &&
          rect.height > 80 &&
          rect.y >= 0 &&
          rect.y + rect.height <= size.height,
      ).toBeTruthy()
    }
  }
})

test('盘口浮层跟随档位、实时更新且成交可打开测试网交易详情', async ({
  page,
}) => {
  const { pushMarket } = await mockExchange(page)
  await page.setViewportSize({ width: 1920, height: 1080 })
  await page.goto('/')
  const book = page.getByRole('region', { name: '订单簿', exact: true })
  const row = book.locator('[data-side="sell"] [data-price]').last()
  await row.hover()
  const tooltip = page.getByRole('tooltip', { name: '档位详情' })
  await expect(tooltip).toContainText('70,001.00')
  await expect(
    book.locator('[data-side="sell"] [data-in-range="true"]'),
  ).toHaveCount(1)
  await expect(
    book.locator('[data-side="buy"] [data-in-range="true"]'),
  ).toHaveCount(0)
  const sellLine = await row.locator('[data-hover-boundary]').boundingBox()
  expect(sellLine?.y).toBe((await row.boundingBox())?.y)

  const first = await tooltip.boundingBox()
  const bounds = await book.boundingBox()
  expect((first?.x ?? 0) + (first?.width ?? 0)).toBeLessThan(bounds?.x ?? 0)
  await book.locator('[data-side="sell"] [data-price]').nth(0).hover()
  await expect
    .poll(async () => (await tooltip.boundingBox())?.y)
    .toBeLessThan(first?.y ?? 0)
  await row.hover()
  await pushMarket('BTC', 71000)
  await expect(tooltip).toContainText('71,001.00')
  const bid = book.locator('[data-side="buy"] [data-price]').nth(3)
  await bid.hover()
  await expect(
    book.locator('[data-side="buy"] [data-in-range="true"]'),
  ).toHaveCount(4)
  await expect(
    book.locator('[data-side="sell"] [data-in-range="true"]'),
  ).toHaveCount(0)
  const buyLine = await bid.locator('[data-hover-boundary]').boundingBox()
  const bidBox = await bid.boundingBox()
  expect(
    buyLine &&
      bidBox &&
      Math.abs(buyLine.y + buyLine.height - bidBox.y - bidBox.height) < 1,
  ).toBeTruthy()
  await page.getByRole('tab', { name: '最新成交', exact: true }).click()
  await expect(tooltip).toBeHidden()
  const link = book.getByRole('link', { name: /查看成交.*链上交易/ }).first()
  await expect(link).toHaveAttribute(
    'href',
    `https://app.hyperliquid-testnet.xyz/explorer/tx/0x${'ab'.repeat(32)}`,
  )
  await expect(link).toHaveAttribute('target', '_blank')
  await expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  await page.screenshot({
    path: 'output-tdd/playwright/market-detail/trades.png',
  })
  await page.getByRole('tab', { name: '订单簿', exact: true }).click()
  await row.focus()
  await expect(tooltip).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(tooltip).toBeHidden()
  await row.hover()
  await page.screenshot({
    path: 'output-tdd/playwright/market-detail/hover.png',
  })
})

async function selectAdvanced(page: Page, name: string) {
  await page.getByRole('button', { name: '高级订单类型' }).click()
  await page.getByRole('menuitemradio', { name, exact: true }).click()
}
async function signPreview(page: Page) {
  await page.getByRole('button', { name: '下单', exact: true }).click()
  await confirmOrder(page)
}
test('高级订单：四种触发单、附带保护和阶梯单使用正确请求并保留部分拒单', async ({
  page,
}) => {
  // 连续完成六组签名与下单，使用 Playwright 的长流程时限。
  test.slow()
  const { writes, pushMarket } = await mockExchange(page, 'partial-batch')
  await ready(page)
  await page.getByRole('textbox', { name: '数量（BTC）' }).fill('0.03')
  for (const [name, trigger, type, market] of [
    ['止损市价', '71000', 'sl', true],
    ['止损限价', '71000', 'sl', false],
    ['止盈市价', '69000', 'tp', true],
    ['止盈限价', '69000', 'tp', false],
  ] as const) {
    await selectAdvanced(page, name)
    await page.getByRole('textbox', { name: '触发价格（USDC）' }).fill(trigger)
    pushMarket('BTC', 70000)
    await signPreview(page)
    await expect
      .poll(() => writes.filter((write) => write.type === 'order').length)
      .toBeGreaterThan(0)
    await expect(
      page.locator('output').filter({ hasText: `${name}回报` }),
    ).toBeVisible()
    expect(writes.at(-1)?.orders?.[0].t.trigger).toEqual({
      isMarket: market,
      triggerPx: trigger,
      tpsl: type,
    })
    if (market) {
      expect(writes.at(-1)?.orders?.[0].p).toBe(
        type === 'sl' ? '78100' : '75900',
      )
    }
  }
  await selectAdvanced(page, '阶梯单')
  await page
    .getByRole('textbox', { name: '价格（USDC）', exact: true })
    .fill('69000')
  await page
    .getByRole('textbox', { name: '最高价格（USDC）', exact: true })
    .fill('71000')
  await page.getByRole('textbox', { name: '阶梯档数（2–50）' }).fill('3')
  pushMarket('BTC', 70000)
  await signPreview(page)
  await expect(
    page.locator('output').filter({ hasText: '2 笔非拒绝、1 笔拒绝' }),
  ).toBeVisible()
  expect(writes.at(-1)?.orders?.map((order) => order.s)).toEqual([
    '0.01',
    '0.01',
    '0.01',
  ])
  expect(new Set(writes.at(-1)?.orders?.map((order) => order.c)).size).toBe(3)
  await page.getByRole('tab', { name: '限价单', exact: true }).click()
  await page.getByRole('checkbox', { name: '止盈 / 止损', exact: true }).check()
  await page.getByRole('textbox', { name: '止盈价格' }).fill('72000')
  await page
    .getByRole('textbox', { name: '止损价格', exact: true })
    .fill('68000')
  pushMarket('BTC', 70000)
  await signPreview(page)
  await expect.poll(() => writes.at(-1)?.grouping).toBe('normalTpsl')
  expect(
    writes
      .at(-1)
      ?.orders?.slice(1)
      .every((order) => !order.b && order.r),
  ).toBe(true)
})
test('高级订单：原生 TWAP 支持七天、列表撤销和原生移动止损', async ({
  page,
}) => {
  const { writes } = await mockExchange(page)
  await ready(page)
  await selectAdvanced(page, 'TWAP')
  await page.getByRole('textbox', { name: '数量（BTC）' }).fill('0.01')
  await page
    .getByRole('textbox', { name: '执行时长（分钟，5–10080）' })
    .fill('10080')
  await signPreview(page)
  await expect(
    page.locator('output').filter({ hasText: 'TWAP已受理' }),
  ).toBeVisible()
  expect(writes.at(-1)?.twap?.m).toBe(10080)
  await page.getByRole('tab', { name: 'TWAP', exact: true }).last().click()
  await expect(page.getByRole('region', { name: '交易记录' })).toContainText(
    '执行中',
  )
  await page.getByRole('button', { name: '停止 TWAP', exact: true }).click()
  await expect(page.getByRole('region', { name: '交易记录' })).toContainText(
    '已取消',
  )
  expect(writes.at(-1)?.type).toBe('twapCancel')
  await selectAdvanced(page, '移动止损')
  await page.getByRole('textbox', { name: '回撤距离' }).fill('1.5')
  await signPreview(page)
  await expect(
    page.locator('output').filter({ hasText: '移动止损已受理' }),
  ).toBeVisible()
  expect(writes.at(-1)?.retracement).toEqual({ pct: '1.5%' })
})
test('高级订单：TWAP 响应丢失保留保护，查询不会拿本地 ID 冒充链上订单', async ({
  page,
}) => {
  const { writes } = await mockExchange(page, 'lost-native')
  await ready(page)
  await selectAdvanced(page, 'TWAP')
  await page.getByRole('textbox', { name: '数量（BTC）' }).fill('0.01')
  await signPreview(page)
  await expect(
    page.getByRole('button', { name: '查询未确认订单' }),
  ).toBeVisible()
  await page.getByRole('button', { name: '查询未确认订单' }).click()
  await expect(
    page.locator('output').filter({ hasText: '此请求没有客户端订单 ID' }),
  ).toBeVisible()
  await expect(
    page.getByRole('button', {
      name: '等待账户数据 / 核对未确认订单',
      exact: true,
    }),
  ).toBeDisabled()
  expect(writes.filter((write) => write.type === 'twapOrder')).toHaveLength(1)
})
test('高级订单：追价撤销后仅重挂最终剩余量，停止后不再自动下单', async ({
  page,
}) => {
  const { writes, setBookPrice, partialFill } = await mockExchange(page)
  await ready(page)
  await selectAdvanced(page, '追价单')
  await page
    .getByRole('textbox', { name: '价格（USDC）', exact: true })
    .fill('72000')
  await page.getByRole('textbox', { name: '数量（BTC）' }).fill('0.01')
  await signPreview(page)
  await expect(
    page.locator('output').filter({ hasText: '追价单：委托已挂单' }),
  ).toBeVisible()
  expect(writes.at(-1)?.orders?.[0].t.limit?.tif).toBe('Alo')
  partialFill(100, '0.006')
  setBookPrice(71000)
  await expect
    .poll(() => writes.filter((write) => write.type === 'order').length, {
      timeout: 10000,
    })
    .toBe(2)
  expect(writes.at(-1)?.orders?.[0].s).toBe('0.006')
  expect(writes.at(-2)?.type).toBe('cancel')
  await page.getByRole('tab', { name: '追价策略', exact: true }).click()
  await page.getByRole('button', { name: '停止改价', exact: true }).click()
  setBookPrice(71500)
  await page.waitForTimeout(2500)
  expect(writes.filter((write) => write.type === 'order')).toHaveLength(2)
})

test('仓位保护查询最新仓位后提交反向只减仓 TP/SL', async ({ page }) => {
  const { writes } = await mockExchange(page)
  await ready(page)
  await page.getByRole('tab', { name: '市价单', exact: true }).click()
  await page.getByRole('textbox', { name: '数量（BTC）' }).fill('0.01')
  await signPreview(page)
  await page.getByRole('button', { name: '止盈 / 止损', exact: true }).click()
  await page.getByRole('textbox', { name: '止盈价格' }).fill('72000')
  await page.getByRole('textbox', { name: '止损价格' }).fill('68000')
  await page
    .getByRole('dialog')
    .getByRole('button', { name: '确认', exact: true })
    .click()
  await expect.poll(() => writes.at(-1)?.grouping).toBe('positionTpsl')
  expect(
    writes
      .at(-1)
      ?.orders?.every((order) => order.r && !order.b && order.s === '0'),
  ).toBe(true)
  await page.getByRole('tab', { name: '当前委托', exact: true }).click()
  await expect(page.getByRole('region', { name: '交易记录' })).toContainText(
    '触发 72000',
  )
})

test('追价被明确拒绝时解除本地待确认状态', async ({ page }) => {
  const { writes } = await mockExchange(page, 'reject')
  await ready(page)
  await selectAdvanced(page, '追价单')
  await page.getByRole('textbox', { name: '数量（BTC）' }).fill('0.01')
  await signPreview(page)
  await expect(
    page.locator('output').filter({ hasText: '交易所拒绝' }),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: '查询未确认订单' }),
  ).toBeHidden()
  await expect(
    page.getByRole('button', { name: '下单', exact: true }),
  ).toBeEnabled()
  expect(writes.filter((write) => write.type === 'order')).toHaveLength(1)
})

test('分类下拉切换现货、预测和 HIP-3，使用各自资产 ID 与下单区', async ({
  page,
}) => {
  const { writes, socketConnections } = await mockExchange(page)
  await ready(page)
  const navigationCount = await page.evaluate(
    () => performance.getEntriesByType('navigation').length,
  )
  async function choose(category: string, name: string) {
    await page.getByRole('button', { name: '交易市场', exact: true }).click()
    await page
      .getByRole('region', { name: '市场选择器', exact: true })
      .getByRole('tab', { name: category, exact: true })
      .click()
    await page.getByRole('option', { name, exact: true }).click()
  }
  await choose('现货', 'HYPE / USDC')
  const panel = page.getByRole('region', { name: '下单面板', exact: true })
  await expect(panel.getByText('现货交易', { exact: true })).toBeVisible()
  await expect(panel.getByRole('button', { name: '保证金模式' })).toHaveCount(0)
  await panel.getByRole('textbox', { name: '价格（USDC）' }).fill('20')
  await panel.getByRole('textbox', { name: '数量（HYPE）' }).fill('2')
  await signPreview(page)
  await expect.poll(() => writes.at(-1)?.orders?.[0]?.a).toBe(10007)
  await panel.getByRole('tab', { name: '卖出', exact: true }).click()
  await panel.getByRole('textbox', { name: '数量（HYPE）' }).fill('9')
  await panel.getByRole('button', { name: '下单', exact: true }).click()
  await expect(panel.getByRole('alert')).toContainText('持有量')
  await choose('预测', 'BTC 达到目标价？ · Yes')
  await predictionType(page, '限价')
  await predictionUnit(page, 'Yes')
  await panel.getByRole('textbox', { name: '价格（USDC）' }).fill('0.5')
  await panel.getByRole('textbox', { name: '数量（Yes）' }).fill('100')
  await signPreview(page)
  await expect.poll(() => writes.at(-1)?.orders?.[0]?.a).toBe(100000120)
  await panel.getByRole('button', { name: 'No', exact: true }).click()
  await expect(
    panel.getByRole('button', { name: 'No', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true')
  await choose('HIP-3', 'ABC / USDC')
  await expect(panel.getByRole('button', { name: '保证金模式' })).toBeVisible()
  await panel.getByRole('textbox', { name: '价格（USDC）' }).fill('70000')
  await panel.getByRole('textbox', { name: '数量（ABC）' }).fill('1')
  await signPreview(page)
  await expect.poll(() => writes.at(-1)?.orders?.[0]?.a).toBe(110000)
  expect(
    await page.evaluate(
      () => performance.getEntriesByType('navigation').length,
    ),
  ).toBe(navigationCount)
  expect(socketConnections).toHaveLength(4) // 快速盘口与完整行情各一个连接；默认 DEX 与 HIP-3 账户各一次。
})

test('成交量在两套引擎均为 60% 不透明度，关闭再打开 VOL 不恢复高亮', async ({
  page,
}) => {
  await mockExchange(page)
  await page.setViewportSize({ width: 1920, height: 1080 })
  await page.goto('/')
  const kline = page.getByRole('region', { name: /基础版 K 线图/ })
  const volumePixels = () =>
    kline.locator('canvas').evaluateAll((canvases) =>
      canvases.reduce((sum, c) => {
        if (!(c instanceof HTMLCanvasElement)) return sum
        const ctx = c.getContext('2d')
        if (!ctx) return sum
        const data = ctx.getImageData(0, 0, c.width, c.height).data
        for (let i = 0; i < data.length; i += 4)
          if (
            Math.abs(data[i] - 20) < 2 &&
            Math.abs(data[i + 1] - 184) < 2 &&
            Math.abs(data[i + 2] - 129) < 2 &&
            Math.abs(data[i + 3] - 153) < 2
          )
            sum++
        return sum
      }, 0),
    )
  await expect.poll(volumePixels).toBeGreaterThan(100)
  await page.getByRole('button', { name: '指标', exact: true }).click()
  await page.getByRole('tab', { name: '副图指标' }).click()
  await page.getByRole('checkbox', { name: '成交量 VOL' }).uncheck()
  await page.getByRole('checkbox', { name: '成交量 VOL' }).check()
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: '重置图表', exact: true }).click()
  await expect.poll(volumePixels).toBeGreaterThan(100)
  await page.getByRole('button', { name: 'TradingView', exact: true }).click()
  const frame = page.frameLocator('iframe').first()
  await expect(frame.locator('canvas').first()).toBeVisible()
  await page.getByRole('button', { name: '重置图表', exact: true }).click()
  await expect
    .poll(() =>
      frame.locator('canvas').evaluateAll((canvases) =>
        canvases.reduce((sum, c) => {
          if (!(c instanceof HTMLCanvasElement)) return sum
          const ctx = c.getContext('2d')
          if (!ctx) return sum
          const data = ctx.getImageData(0, 0, c.width, c.height).data
          for (let i = 0; i < data.length; i += 4)
            if (
              Math.abs(data[i] - 21) < 2 &&
              Math.abs(data[i + 1] - 120) < 2 &&
              Math.abs(data[i + 2] - 89) < 2 &&
              data[i + 3] === 255
            )
              sum++
          return sum
        }, 0),
      ),
    )
    .toBeGreaterThan(100)
})

test('切回基础版恢复最新蜡烛、默认间距和右侧留白，保留周期及实例', async ({
  page,
}) => {
  const { socketConnections, writes } = await mockExchange(page)
  await page.setViewportSize({ width: 1920, height: 1080 })
  await page.goto('/')
  const chart = page.getByRole('region', { name: /基础版 K 线图/ })
  const canvas = chart.locator('canvas').first()
  await expect(chart).toHaveAttribute('aria-label', /已加载 40 根/)
  const candleExtent = () =>
    canvas.evaluate((element) => {
      if (!(element instanceof HTMLCanvasElement)) throw Error('缺少画布')
      if (!element.width || !element.height)
        return { left: 0, right: 0, rightGap: 0, span: 0 }
      const ctx = element.getContext('2d')
      if (!ctx) throw Error('缺少画布上下文')
      const data = ctx.getImageData(0, 0, element.width, element.height).data
      const columns = []
      for (let x = 0; x < element.width; x++) {
        let hits = 0
        for (let y = 45; y < element.height - 20; y++) {
          const i = (y * element.width + x) * 4
          if (
            data[i] <= 20 &&
            data[i + 1] > 100 &&
            data[i + 2] > 60 &&
            data[i + 1] > data[i + 2] &&
            data[i + 3] > 250
          )
            hits++
        }
        if (hits > 10) columns.push(x)
      }
      const left = columns[0] ?? 0
      const right = columns.at(-1) ?? 0
      // 价格轴可因刻度文字变宽；校验相对绘图区的留白与蜡烛跨度。
      return {
        left,
        right,
        rightGap: element.width - right,
        span: right - left,
      }
    })
  await expect
    .poll(async () => (await candleExtent()).right ?? 0)
    .toBeGreaterThan(0)
  await expect(chart.locator('.pointer-events-auto')).toHaveCount(0)
  const initial = await candleExtent()
  const host = await canvas.elementHandle()
  const box = await canvas.boundingBox()
  if (!box) throw Error('缺少图表边界')
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.wheel(0, -240)
  await expect
    .poll(async () => (await candleExtent()).left)
    .not.toBe(initial.left)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 + 280, box.y + box.height / 2, {
    steps: 12,
  })
  await page.mouse.up()
  await expect(chart.getByRole('button', { name: '回到实时' })).toBeVisible()
  await page.getByRole('button', { name: 'TradingView', exact: true }).click()
  await expect(
    page.frameLocator('iframe').locator('canvas').first(),
  ).toBeVisible()
  await page.getByRole('button', { name: '基础版', exact: true }).click()
  await expect(chart.getByRole('button', { name: '回到实时' })).toBeHidden()
  await expect
    .poll(async () => (await candleExtent()).rightGap)
    .toBe(initial.rightGap)
  await expect.poll(async () => (await candleExtent()).span).toBe(initial.span)
  expect(
    await canvas.evaluate((element, original) => element === original, host),
  ).toBe(true)
  await page.getByRole('button', { name: 'TradingView', exact: true }).click()
  await page.getByRole('button', { name: '1时', exact: true }).click()
  await page.getByRole('button', { name: '基础版', exact: true }).click()
  await expect(
    page.getByRole('button', { name: '1时', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true')
  await expect(chart.getByRole('button', { name: '回到实时' })).toBeHidden()
  await expect
    .poll(async () => (await candleExtent()).rightGap)
    .toBe(initial.rightGap)
  await expect.poll(async () => (await candleExtent()).span).toBe(initial.span)
  for (let i = 0; i < 3; i++) {
    await page.getByRole('button', { name: 'TradingView', exact: true }).click()
    await page.getByRole('button', { name: '基础版', exact: true }).click()
    await expect
      .poll(async () => (await candleExtent()).rightGap)
      .toBe(initial.rightGap)
  }
  await page.screenshot({
    path: 'output-tdd/playwright/chart-viewport/restored.png',
  })
  expect(socketConnections).toHaveLength(2)
  expect(writes).toEqual([])
})

for (const product of ['perp', 'spot', 'outcome'] as const) {
  test(`限价盘口填价与数量金额比例联动且不自动下单：${product}`, async ({
    page,
  }) => {
    const exchange = await mockExchange(page)
    await page.setViewportSize({ width: 1440, height: 1000 })
    await ready(page)
    const panel = page.getByRole('region', { name: '下单面板', exact: true })
    if (product !== 'perp') {
      await page.getByRole('button', { name: '交易市场', exact: true }).click()
      await page
        .getByRole('region', { name: '市场选择器', exact: true })
        .getByRole('tab', {
          name: product === 'spot' ? '现货' : '预测',
          exact: true,
        })
        .click()
      await page
        .getByRole('option', {
          name: product === 'spot' ? 'HYPE / USDC' : 'BTC 达到目标价？ · Yes',
          exact: true,
        })
        .click()
    }
    if (product === 'outcome') {
      await predictionType(page, '限价')
      await predictionUnit(page, 'Yes')
      await panel.getByRole('tab', { name: '卖出', exact: true }).click()
    }
    const base =
      product === 'perp' ? 'BTC' : product === 'spot' ? 'HYPE' : 'Yes'
    const price = panel.getByRole('textbox', {
      name: '价格（USDC）',
      exact: true,
    })
    await price.fill(
      product === 'perp' ? '70000' : product === 'spot' ? '20' : '0.5',
    )
    await panel
      .getByRole('button', { name: '下单比例 50%', exact: true })
      .click()
    if (product === 'perp') {
      exchange.setBookPrice(139999)
      exchange.pushFastBook(139999)
    }
    if (product === 'spot') {
      exchange.setSpotBookPrice(39.99)
      exchange.pushFastBook(39)
    }
    const picked =
      product === 'perp' ? '140000' : product === 'spot' ? '40' : '0.51'
    const row = page.getByRole('button', {
      name: `卖盘 ${picked} 档位详情`,
      exact: true,
    })
    await row.click()
    await expect(price).toHaveValue(picked)
    await expect(
      panel.getByRole('textbox', { name: `数量（${base}）`, exact: true }),
    ).toHaveValue(
      product === 'perp' ? '0.25' : product === 'spot' ? '12.36' : '47',
    )
    await panel.getByRole('button', { name: '数量单位', exact: true }).click()
    await page.getByRole('menuitemradio', { name: 'USDC', exact: true }).click()
    const amount = panel.getByRole('textbox', {
      name: product === 'outcome' ? '数量（USDC）' : '金额（USDC）',
      exact: true,
    })
    await expect(amount).toHaveValue(
      product === 'perp'
        ? '35000.000000'
        : product === 'spot'
          ? '494.400000'
          : '23.970000',
    )
    await panel
      .getByRole('button', { name: '下单比例 25%', exact: true })
      .click()
    await expect(amount).toHaveValue(
      product === 'perp'
        ? '17500.000000'
        : product === 'spot'
          ? '247.200000'
          : '11.730000',
    )
    if (product === 'perp') {
      const submit = await panel
        .getByRole('button', { name: '下单', exact: true })
        .boundingBox()
      const options = await panel
        .getByRole('checkbox', { name: '止盈 / 止损', exact: true })
        .evaluate((el) => {
          const rect = el.closest('label')?.getBoundingClientRect()
          return rect ? { bottom: rect.bottom } : null
        })
      if (!submit || !options) throw new Error('下单控件不可见')
      expect(submit.y - options.bottom).toBeLessThanOrEqual(32)
    }
    await page.screenshot({
      path: `output-tdd/playwright/order-linkage/${product}.png`,
    })
    await amount.click()
    await amount.press('ControlOrMeta+A')
    await expect
      .poll(() =>
        amount.evaluate((element) => {
          const input = element as HTMLInputElement
          return (
            input.selectionStart === 0 &&
            input.selectionEnd === input.value.length
          )
        }),
      )
      .toBe(true)
    await amount.press('Backspace')
    await expect(amount).toHaveValue('')
    await price.fill(
      product === 'perp' ? '70000' : product === 'spot' ? '20' : '0.5',
    )
    await expect(amount).toHaveValue('')
    await row.click()
    await expect(price).toHaveValue(picked)
    await expect(amount).toHaveValue('')
    if (product === 'perp') {
      await panel.getByRole('tab', { name: '市价单', exact: true }).click()
      await page
        .getByRole('button', { name: '买盘 139998 档位详情', exact: true })
        .click()
      await panel.getByRole('tab', { name: '限价单', exact: true }).click()
      await expect(price).toHaveValue(picked)
    }
    expect(exchange.writes).toHaveLength(0)
  })
}

test('交易记录方向与币种组合筛选，空结果准确显示并随推送更新', async ({
  page,
}) => {
  const exchange = await mockExchange(page)
  exchange.setPosition(0.5)
  exchange.setExtraPositions({ ETH: -2, SOL: 3 })
  await page.setViewportSize({ width: 1440, height: 1000 })
  await ready(page)
  const records = page.getByRole('region', { name: '交易记录', exact: true })
  const rows = records
    .getByRole('table', { name: '仓位', exact: true })
    .locator('tbody tr')
  await expect(rows).toHaveCount(3)
  await expect(
    page.getByRole('button', { name: '刷新', exact: true }),
  ).toHaveCount(0)
  await records.getByRole('button', { name: '方向筛选', exact: true }).click()
  await page.getByRole('menuitemradio', { name: '多头', exact: true }).click()
  await expect(rows).toHaveCount(2)
  await records.getByRole('button', { name: '币种筛选', exact: true }).click()
  await page
    .getByRole('menuitemradio', { name: 'ETH / USDC', exact: true })
    .click()
  await expect(rows).toHaveCount(0)
  await expect(
    records.getByText('没有匹配的记录', { exact: true }),
  ).toBeVisible()
  await records.getByRole('button', { name: '方向筛选', exact: true }).click()
  await page.getByRole('menuitemradio', { name: '方向', exact: true }).click()
  await expect(rows).toHaveCount(1)
  await expect(rows).toContainText('ETH')
  await page.screenshot({
    path: 'output-tdd/playwright/order-linkage/record-filters.png',
  })
  await records.getByRole('tab', { name: '当前委托', exact: true }).click()
  await expect(
    records.getByRole('button', { name: '方向筛选', exact: true }),
  ).toHaveText('方向')
  await expect(
    records.getByRole('button', { name: '币种筛选', exact: true }),
  ).toHaveText('币种')
  await records.getByRole('tab', { name: '仓位', exact: true }).click()
  await expect(rows).toHaveCount(3)
  exchange.setExtraPositions({ ETH: -2 })
  exchange.pushAccount()
  await expect(rows).toHaveCount(2)
  expect(exchange.writes).toHaveLength(0)
})

for (const product of ['perp', 'spot', 'outcome'] as const) {
  test(`数量单位内嵌、连续比例联动且提交币数量：${product}`, async ({
    page,
  }) => {
    const { writes } = await mockExchange(page)
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.setViewportSize({ width: 1440, height: 1000 })
    await ready(page)
    const panel = page.getByRole('region', { name: '下单面板', exact: true })
    if (product !== 'perp') {
      await page.getByRole('button', { name: '交易市场', exact: true }).click()
      await page
        .getByRole('region', { name: '市场选择器', exact: true })
        .getByRole('tab', {
          name: product === 'spot' ? '现货' : '预测',
          exact: true,
        })
        .click()
      await page
        .getByRole('option', {
          name: product === 'spot' ? 'HYPE / USDC' : 'BTC 达到目标价？ · Yes',
          exact: true,
        })
        .click()
      await panel.getByRole('tab', { name: '卖出', exact: true }).click()
      if (product === 'spot')
        await expect(
          panel
            .getByRole('tablist', { name: '交易方向' })
            .locator('[data-slot="cursor"]'),
        ).toHaveCSS('background-color', 'rgb(235, 71, 71)')
    }
    const base =
      product === 'perp' ? 'BTC' : product === 'spot' ? 'HYPE' : 'Yes'
    if (product === 'outcome') {
      await predictionType(page, '限价')
      await predictionUnit(page, 'Yes')
    }
    const px = product === 'perp' ? 70000 : product === 'spot' ? 20 : 0.5
    const initial = product === 'perp' ? '0.5' : product === 'spot' ? '2' : '20'
    await panel
      .getByRole('textbox', { name: '价格（USDC）', exact: true })
      .fill(String(px))
    await panel.getByRole('textbox', { name: `数量（${base}）` }).fill(initial)
    const trigger = panel.getByRole('button', { name: '数量单位', exact: true })
    async function selectUnit(name: string) {
      await trigger.click()
      await page.getByRole('menuitemradio', { name, exact: true }).click()
      await expect(
        page.getByRole('menu', { name: '数量单位', exact: true }),
      ).toBeHidden()
    }
    await expect
      .poll(() =>
        trigger.evaluate((el) => {
          const wrapper = el.closest('[data-slot="input-wrapper"]')
          if (!wrapper) return false
          const a = wrapper.getBoundingClientRect(),
            b = el.getBoundingClientRect()
          return (
            b.left >= a.left &&
            b.right <= a.right &&
            b.top >= a.top &&
            b.bottom <= a.bottom
          )
        }),
      )
      .toBe(true)
    const before = await trigger.boundingBox()
    await trigger.click()
    await expect(
      page.getByRole('menu', { name: '数量单位', exact: true }),
    ).toBeVisible()
    await expect
      .poll(async () => (await trigger.boundingBox())?.x)
      .toBe(before?.x)
    await page.keyboard.press('Escape')
    await expect(
      page.getByRole('menu', { name: '数量单位', exact: true }),
    ).toBeHidden()
    await expect(trigger).toBeFocused()
    await selectUnit('USDC')
    const amount = panel.getByRole('textbox', {
      name: product === 'outcome' ? '数量（USDC）' : '金额（USDC）',
    })
    await expect
      .poll(async () => Number(await amount.inputValue()))
      .toBe(Number(initial) * px)
    await panel
      .getByRole('button', { name: '下单比例 100%', exact: true })
      .click()
    await panel
      .getByRole('button', { name: '下单比例 50%', exact: true })
      .click()
    const expected = product === 'perp' ? 0.5 : product === 'spot' ? 4 : 47
    await expect
      .poll(async () => Number(await amount.inputValue()))
      .toBe(expected * px)
    const slider = panel.getByRole('slider', { name: '下单比例' })
    if (product !== 'outcome') {
      await slider.focus()
      await page.keyboard.press('ArrowRight')
      await expect
        .poll(async () => Number(await amount.inputValue()))
        .toBe((product === 'perp' ? 0.51 : 4.08) * px)
    }
    if (product === 'perp') {
      const group = panel.getByRole('group', { name: '下单比例', exact: true })
      const track = await group.locator('[data-slot="track"]').boundingBox()
      const thumb = await group.locator('[data-slot="thumb"]').boundingBox()
      if (!track || !thumb) throw new Error('滑块缺失')
      await page.mouse.move(
        thumb.x + thumb.width / 2,
        thumb.y + thumb.height / 2,
      )
      await page.mouse.down()
      await page.mouse.move(
        track.x + track.width * 0.65,
        track.y + track.height / 2,
        { steps: 8 },
      )
      await page.mouse.up()
      expect(Number(await slider.inputValue())).toBeGreaterThanOrEqual(63)
      expect(Number(await slider.inputValue())).toBeLessThanOrEqual(67)
    }
    await amount.fill(String(Number(initial) * px))
    await expect
      .poll(async () => Number(await slider.inputValue()))
      .toBeCloseTo(product === 'perp' ? 50 : product === 'spot' ? 25 : 21, 0)
    await selectUnit(base)
    await expect
      .poll(async () =>
        Number(
          await panel
            .getByRole('textbox', { name: `数量（${base}）` })
            .inputValue(),
        ),
      )
      .toBe(Number(initial))
    await selectUnit('USDC')
    await signPreview(page)
    await expect.poll(() => writes.at(-1)?.orders?.[0]?.s).toBe(initial)
    expect(writes.at(-1)?.orders?.[0]?.a).toBe(
      product === 'perp' ? 3 : product === 'spot' ? 10007 : 100000120,
    )
    if (product !== 'perp') {
      await selectUnit(base)
      await panel
        .getByRole('textbox', { name: '价格（USDC）', exact: true })
        .fill('bad')
      await selectUnit('USDC')
      await expect(panel.getByRole('alert')).toContainText('价格')
      await expect(
        panel.getByRole('textbox', { name: `数量（${base}）` }),
      ).toHaveValue(initial)
    }
    expect(errors).toEqual([])
  })
}

async function chooseCashMarket(page: Page, outcome = false) {
  await page.getByRole('button', { name: '交易市场', exact: true }).click()
  await page
    .getByRole('region', { name: '市场选择器', exact: true })
    .getByRole('tab', { name: outcome ? '预测' : '现货', exact: true })
    .click()
  await page
    .getByRole('option', {
      name: outcome ? 'BTC 达到目标价？ · Yes' : 'HYPE / USDC',
      exact: true,
    })
    .click()
  if (outcome)
    await expect(page.getByLabel('订单摘要')).toContainText('0.0000% / 0.0000%')
  else
    await expect(
      page.getByRole('button', { name: '下单', exact: true }),
    ).toBeEnabled()
}

for (const width of [1440, 375]) {
  test(`订单类型菜单相邻、清晰可见且按产品过滤：${width}`, async ({ page }) => {
    await mockExchange(page)
    await page.setViewportSize({ width, height: 900 })
    await ready(page)
    const trigger = page.getByRole('button', { name: '高级订单类型' })
    await trigger.scrollIntoViewIfNeeded()
    const market = await page
      .getByRole('tab', { name: '市价单', exact: true })
      .boundingBox()
    const more = await trigger.boundingBox()
    if (!more || !market) throw new Error('订单类型入口不可见')
    expect(more.x - market.x - market.width).toBeLessThanOrEqual(20)
    expect(Math.abs(more.y - market.y)).toBeLessThanOrEqual(2)
    await trigger.hover()
    await expect(trigger).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
    await trigger.click()
    await expect(trigger).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
    const menu = page.getByRole('menu', { name: '高级订单类型' })
    await expect(menu.getByRole('menuitemradio')).toHaveCount(8)
    await expect(menu.getByText('在价格区间内分配多档限价单')).toBeVisible()
    const viewport = menu.locator('..')
    await expect(viewport).toHaveCSS('overflow-y', 'auto')
    const bounds = await viewport.boundingBox()
    if (!bounds) throw new Error('订单类型菜单不可见')
    expect(bounds.x).toBeGreaterThanOrEqual(0)
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width)
    expect(bounds.y).toBeGreaterThanOrEqual(0)
    await expect
      .poll(async () => {
        const settled = await viewport.boundingBox()
        return settled ? settled.y + settled.height : Infinity
      })
      .toBeLessThanOrEqual(900)
    await page.screenshot({
      path: `output-tdd/playwright/order-type-menu/menu-${width}.png`,
    })
    await page.keyboard.press('Escape')
    await expect(menu).toBeHidden()
    await expect(trigger).toBeFocused()
    await trigger.press('Enter')
    await page.getByRole('menuitemradio', { name: 'TWAP', exact: true }).focus()
    await page.keyboard.press('Enter')
    await expect(menu).toBeHidden()
    await expect(trigger).toHaveText('TWAP')
    await expect(
      page.getByRole('tab', { name: '限价单', exact: true }),
    ).toHaveAttribute('aria-selected', 'false')
    await expect(
      page.getByRole('tab', { name: '市价单', exact: true }),
    ).toHaveAttribute('aria-selected', 'false')
    await trigger.click()
    await expect(
      page.getByRole('menuitemradio', { name: 'TWAP', exact: true }),
    ).toHaveAttribute('aria-checked', 'true')
    await page.keyboard.press('Escape')
    await page.getByRole('tab', { name: '限价单', exact: true }).click()
    await expect(trigger).toHaveText('专业')
    await chooseCashMarket(page)
    await trigger.click()
    await expect(menu.getByRole('menuitemradio')).toHaveText([
      /阶梯单/,
      /TWAP/,
      /追价单/,
    ])
    await page.screenshot({
      path: `output-tdd/playwright/order-type-menu/spot-menu-${width}.png`,
    })
    await page.keyboard.press('Escape')
    await chooseCashMarket(page, true)
    await page.getByRole('button', { name: '预测订单类型' }).click()
    const predictionMenu = page.getByRole('menu', { name: '预测订单类型' })
    await expect(predictionMenu.getByRole('menuitemradio')).toHaveText([
      '市价',
      '限价',
      '分段订单',
      '转换',
    ])
    await page.screenshot({
      path: `output-tdd/playwright/order-type-menu/outcome-menu-${width}.png`,
    })
  })
}

test('现货高级订单：整批余额校验、确认重读余额、部分拒单和撤单', async ({
  page,
}) => {
  const { writes, setCashBalance } = await mockExchange(page, 'partial-batch')
  await ready(page)
  await chooseCashMarket(page)
  await selectAdvanced(page, '阶梯单')
  await page.getByRole('textbox', { name: '最低价格（USDC）' }).fill('18')
  await page.getByRole('textbox', { name: '最高价格（USDC）' }).fill('22')
  await page.getByRole('textbox', { name: '阶梯档数（2–50）' }).fill('3')
  const quantity = page.getByRole('textbox', { name: '数量（HYPE）' })
  await quantity.fill('60')
  await page.getByRole('button', { name: '下单', exact: true }).click()
  await expect(
    page.getByRole('region', { name: '下单面板' }).getByRole('alert'),
  ).toContainText('整笔订单')
  expect(writes).toHaveLength(0)
  await quantity.fill('6')
  await page.getByRole('button', { name: '下单', exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText('阶梯单')
  setCashBalance('USDC', '1000', '995')
  await confirmOrder(page)
  await expect(
    page.locator('output').filter({ hasText: '整笔订单' }),
  ).toBeVisible()
  expect(writes).toHaveLength(0)
  setCashBalance('USDC', '1000', '10')
  await signPreview(page)
  await expect(
    page.locator('output').filter({ hasText: '2 笔非拒绝、1 笔拒绝' }),
  ).toBeVisible()
  expect(
    writes.at(-1)?.orders?.map(({ a, p, s, r }) => ({ a, p, s, r })),
  ).toEqual([
    { a: 10007, p: '18', s: '2', r: false },
    { a: 10007, p: '20', s: '2', r: false },
    { a: 10007, p: '22', s: '2', r: false },
  ])
  await page.getByRole('tab', { name: '当前委托', exact: true }).click()
  await expect(
    page.getByRole('button', { name: '撤单', exact: true }),
  ).toHaveCount(2)
  await page.getByRole('button', { name: '撤单', exact: true }).first().click()
  await expect(
    page.getByRole('button', { name: '撤单', exact: true }),
  ).toHaveCount(1)
  expect(writes.at(-1)?.cancels?.[0].a).toBe(10007)
})

test('预测高级订单：整数份额、价格范围、整批卖出余额与阶梯请求', async ({
  page,
}) => {
  const { writes } = await mockExchange(page)
  await ready(page)
  await chooseCashMarket(page, true)
  await predictionType(page, '分段订单')
  await predictionUnit(page, 'Yes')
  await page.getByRole('textbox', { name: '开始价格（USDC）' }).fill('0.33333')
  const upper = page.getByRole('textbox', { name: '结束价格（USDC）' })
  await upper.fill('1')
  await page.getByRole('textbox', { name: '总订单数（2–50）' }).fill('3')
  const quantity = page.getByRole('textbox', { name: '数量（Yes）' })
  await quantity.fill('12')
  await page.getByRole('button', { name: '下单', exact: true }).click()
  await expect(
    page.getByRole('region', { name: '下单面板' }).getByRole('alert'),
  ).toContainText('必须小于 1')
  await upper.fill('0.77777')
  await quantity.fill('12.5')
  await page.getByRole('button', { name: '下单', exact: true }).click()
  await expect(
    page.getByRole('region', { name: '下单面板' }).getByRole('alert'),
  ).toContainText('数量')
  await page.getByRole('tab', { name: '卖出', exact: true }).click()
  await quantity.fill('96')
  await page.getByRole('button', { name: '下单', exact: true }).click()
  await expect(
    page.getByRole('region', { name: '下单面板' }).getByRole('alert'),
  ).toContainText('持有量')
  expect(writes).toHaveLength(0)
  await quantity.fill('12')
  await signPreview(page)
  await expect.poll(() => writes.length).toBe(1)
  expect(
    writes[0].orders?.map(({ a, b, p, s, r }) => ({ a, b, p, s, r })),
  ).toEqual([
    { a: 100000120, b: false, p: '0.33333', s: '4', r: false },
    { a: 100000120, b: false, p: '0.55555', s: '4', r: false },
    { a: 100000120, b: false, p: '0.77777', s: '4', r: false },
  ])
  await page.getByRole('tab', { name: '当前委托', exact: true }).click()
  await expect(
    page.getByRole('button', { name: '撤单', exact: true }),
  ).toHaveCount(3)
  await page.getByRole('button', { name: '撤单', exact: true }).first().click()
  await expect.poll(() => writes.at(-1)?.cancels?.[0].a).toBe(100000120)
})

test('现货高级订单：原生 TWAP 触发和价格边界、执行记录与停止', async ({
  page,
}) => {
  const { writes } = await mockExchange(page)
  await ready(page)
  await chooseCashMarket(page)
  await selectAdvanced(page, 'TWAP')
  await page.getByRole('textbox', { name: '数量（HYPE）' }).fill('5')
  await page
    .getByRole('textbox', { name: '执行时长（分钟，5–10080）' })
    .fill('60')
  await page.getByRole('textbox', { name: 'TWAP 触发价（可选）' }).fill('21')
  await page
    .getByRole('textbox', { name: 'TWAP 最高成交价（可选）' })
    .fill('22')
  await page.getByRole('button', { name: '下单', exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText('买入 5 HYPE')
  await confirmOrder(page)
  await expect(
    page.locator('output').filter({ hasText: 'TWAP已受理' }),
  ).toBeVisible()
  expect(writes.at(-1)).toMatchObject({
    type: 'twapOrder',
    twap: { a: 10007, b: true, s: '5', m: 60, t: true },
    details: { t: { p: '21', a: true }, s: '22' },
  })
  await page.getByRole('tab', { name: 'TWAP', exact: true }).click()
  await expect(page.getByRole('region', { name: '交易记录' })).toContainText(
    'HYPE / USDC',
  )
  await page.getByRole('button', { name: '停止 TWAP', exact: true }).click()
  await expect(page.getByRole('region', { name: '交易记录' })).toContainText(
    '已取消',
  )
  expect(writes.at(-1)).toMatchObject({ type: 'twapCancel', a: 10007, t: 100 })
})

test('现货高级订单：追价保持精度、只重挂剩余量，余额不足停止改价', async ({
  page,
}) => {
  const { writes, partialFill, setSpotBookPrice, setCashBalance } =
    await mockExchange(page)
  await ready(page)
  await chooseCashMarket(page)
  await selectAdvanced(page, '追价单')
  await page.getByRole('textbox', { name: '最高买入价（USDC）' }).fill('22')
  await page.getByRole('textbox', { name: '数量（HYPE）' }).fill('2')
  await signPreview(page)
  await expect(
    page.locator('output').filter({ hasText: '追价单：委托已挂单' }),
  ).toBeVisible()
  expect(writes[0].orders?.[0]).toMatchObject({
    a: 10007,
    p: '19.991',
    s: '2',
    t: { limit: { tif: 'Alo' } },
  })
  partialFill(100, '1.25')
  await page.getByRole('tab', { name: '追价策略', exact: true }).click()
  await expect(page.getByRole('region', { name: '交易记录' })).toContainText(
    '37.50%',
    { timeout: 10000 },
  )
  setSpotBookPrice(21)
  await expect
    .poll(() => writes.filter((w) => w.type === 'order').length, {
      timeout: 10000,
    })
    .toBe(2)
  expect(writes.at(-1)?.orders?.[0]).toMatchObject({
    a: 10007,
    s: '1.25',
    p: '20.991',
  })
  expect(writes.at(-2)?.type).toBe('cancel')
  setCashBalance('USDC', '1000', '999')
  setSpotBookPrice(21.5)
  await page.getByRole('tab', { name: '追价策略', exact: true }).click()
  await expect(page.getByRole('region', { name: '交易记录' })).toContainText(
    '可用余额不足',
    { timeout: 10000 },
  )
  expect(writes.filter((w) => w.type === 'order')).toHaveLength(2)
  expect(writes.at(-1)?.type).toBe('cancel')
  await expect(
    page.getByRole('button', { name: '停止改价', exact: true }),
  ).toBeHidden()
})

test('现货高级订单：确认期间切换账户会中止余额查询后的提交', async ({
  page,
}) => {
  const { writes, pauseCashReads } = await mockExchange(page)
  await ready(page)
  await chooseCashMarket(page)
  await page.getByRole('textbox', { name: '数量（HYPE）' }).fill('2')
  await page.getByRole('button', { name: '下单', exact: true }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  const gate = pauseCashReads()
  const reads = gate.reads()
  await confirmOrder(page)
  await expect.poll(gate.reads).toBeGreaterThan(reads)
  await page.evaluate(() =>
    window.dispatchEvent(new Event('test-account-change')),
  )
  gate.release()
  await expect(
    page.getByText('账户已变化，请重新预览', { exact: true }),
  ).toBeVisible()
  expect(writes).toHaveLength(0)
})

test('正式页面隐藏性能调试入口，性能验收模式保留键盘操作', async ({ page }) => {
  await mockExchange(page)
  await page.goto('/')
  const trigger = page.getByRole('button', { name: /性能 ·/ })
  if (process.env.PERF_CHECK !== '1') {
    await expect(page.getByText('实时连接', { exact: false })).toBeVisible()
    await expect(trigger).toHaveCount(0)
    await expect(page.getByText('· 以交易所返回为准')).toHaveCount(0)
    return
  }
  const dialog = page.getByRole('dialog', { name: '性能监测', exact: true })
  const exportButton = dialog.getByRole('button', {
    name: '导出指标',
    exact: true,
  })
  const closeButton = dialog.getByRole('button', { name: '关闭', exact: true })
  await trigger.click()
  await expect(dialog).toBeVisible()
  await expect(exportButton).toBeFocused()
  await expect(exportButton).toHaveCSS('outline-style', 'none')
  await expect(exportButton).toHaveCSS('box-shadow', 'none')
  await closeButton.click()
  await expect(dialog).toBeHidden()
  await expect(trigger).toBeFocused()
  await expect(trigger).toHaveCSS('outline-style', 'none')
  await expect(trigger).toHaveCSS('box-shadow', 'none')
  await trigger.press('Enter')
  await expect(exportButton).toBeFocused()
  await expect(exportButton).toHaveCSS('outline-style', 'solid')
  await expect(exportButton).toHaveCSS('outline-width', '2px')
  await page.keyboard.press('Tab')
  await expect(closeButton).toBeFocused()
  await expect(closeButton).toHaveCSS('outline-style', 'solid')
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(trigger).toBeFocused()
  await expect(trigger).toHaveCSS('outline-style', 'solid')
})

async function mockFunding(
  page: Page,
  options: {
    deny?: boolean
    lost?: boolean
    mainnet?: boolean
    lowFee?: boolean
  } = {},
) {
  const transactions: { to: string; data: string; maxFeePerGas: string }[] = []
  let allowance = 0n
  const feeEstimates: bigint[] = []
  let credited = false
  let ledgerMatch = false
  const mintTime = Math.floor(Date.now() / 1000)
  const cctp = cctpFixture(address)
  const approvalHash = `0x${'aa'.repeat(32)}`
  const depositHash = `0x${'bb'.repeat(32)}`
  await page.exposeFunction(
    'testFundingSend',
    (tx: { to: string; data: string; maxFeePerGas: string }) => {
      transactions.push(tx)
      return tx.data.startsWith('0x095ea7b3') ? approvalHash : depositHash
    },
  )
  await page.addInitScript(
    ({ options }) => {
      const ethereum = window.ethereum
      if (!ethereum) throw new Error('Missing mock wallet')
      const request = ethereum.request.bind(ethereum)
      let chain = options.mainnet ? '0xa4b1' : '0x66eee'
      let lowFee = options.lowFee
      ethereum.request = (async ({
        method,
        params,
      }: {
        method: string
        params?: unknown[]
      }) => {
        if (method === 'wallet_sendTransaction')
          throw { code: 4200, message: 'Unsupported method' }
        if (method === 'eth_chainId') return chain
        if (method === 'wallet_switchEthereumChain') {
          chain = '0x66eee'
          return null
        }
        if (method === 'eth_sendTransaction') {
          if (options.deny) throw { code: 4001, message: 'User rejected' }
          if (lowFee) {
            lowFee = false
            throw {
              code: -32000,
              message:
                'RPC 0x66eee Custom eth_sendRawTransaction: max fee per gas less than block base fee: maxFeePerGas: 20122000 baseFee: 20600000',
            }
          }
          const hash = await (
            window as unknown as {
              testFundingSend: (tx: unknown) => Promise<string>
            }
          ).testFundingSend(params?.[0])
          if (options.lost && hash === `0x${'bb'.repeat(32)}`)
            throw new Error('wallet response lost')
          return hash
        }
        return request({ method, params } as Parameters<typeof request>[0])
      }) as typeof ethereum.request
    },
    { options },
  )
  await page.route('https://sepolia-rollup.arbitrum.io/rpc', async (route) => {
    const request = route.request().postDataJSON()
    let result: unknown
    if (request.method === 'eth_chainId') result = '0x66eee'
    else if (request.method === 'eth_getBalance') result = '0xde0b6b3a7640000'
    else if (request.method === 'eth_getBlockByNumber') {
      const baseFee = 20600000n + BigInt(feeEstimates.length) * 1000000n
      feeEstimates.push(baseFee * 2n)
      result = {
        number: '0x1',
        baseFeePerGas: `0x${baseFee.toString(16)}`,
        transactions: [],
      }
    } else if (request.method === 'eth_maxPriorityFeePerGas') result = '0x0'
    else if (request.method === 'eth_call') {
      const data: string = request.params[0].data
      result = `0x${(data.startsWith('0x70a08231') ? 100000000n : data.startsWith('0xdd62ed3e') ? allowance : data.startsWith('0x095ea7b3') ? 1n : 0n).toString(16).padStart(64, '0')}`
    } else if (request.method === 'eth_getTransactionReceipt') {
      const hash = request.params[0]
      if (hash === approvalHash) allowance = 10000000n
      result = {
        transactionHash: hash,
        transactionIndex: '0x0',
        blockHash: `0x${'cc'.repeat(32)}`,
        blockNumber: '0x1',
        from: address,
        to:
          hash === approvalHash
            ? '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d'
            : '0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA',
        cumulativeGasUsed: '0x5208',
        gasUsed: '0x5208',
        effectiveGasPrice: '0x1',
        contractAddress: null,
        logs: [],
        logsBloom: `0x${'00'.repeat(256)}`,
        status: '0x1',
        type: '0x2',
      }
    } else throw new Error(`Unexpected deposit RPC ${request.method}`)
    await route.fulfill({ json: { jsonrpc: '2.0', id: request.id, result } })
  })
  await page.route(
    'https://iris-api-sandbox.circle.com/v2/messages/3?*',
    (route) =>
      route.fulfill({ json: { messages: credited ? [cctp.message] : [] } }),
  )
  await page.route('https://rpc.hyperliquid-testnet.xyz/evm', async (route) => {
    const request = route.request().postDataJSON()
    if (
      !['eth_getTransactionReceipt', 'eth_getBlockByNumber'].includes(
        request.method,
      )
    )
      return route.fallback()
    await route.fulfill({
      json: {
        jsonrpc: '2.0',
        id: request.id,
        result:
          request.method === 'eth_getTransactionReceipt'
            ? cctp.receipt
            : {
                number: '0x1',
                timestamp: `0x${mintTime.toString(16)}`,
                transactions: [],
              },
      },
    })
  })
  await page.route(
    'https://api.hyperliquid-testnet.xyz/info',
    async (route) => {
      const request = route.request().postDataJSON()
      if (request.type !== 'userNonFundingLedgerUpdates')
        return route.fallback()
      await route.fulfill({
        json: ledgerMatch
          ? [
              {
                time: mintTime * 1000 + 400,
                hash: `0x${'dd'.repeat(32)}`,
                delta: {
                  type: 'send',
                  destination: address,
                  user: coreWallet,
                  sourceDex: 'spot',
                  destinationDex: '',
                  nonce: 123,
                  token: 'USDC',
                  amount: '9.8',
                  fee: '0',
                },
              },
            ]
          : [],
      })
    },
  )
  return {
    transactions,
    feeEstimates,
    setCredited() {
      credited = true
    },
    setLedger() {
      ledgerMatch = true
    },
  }
}

async function openFunds(page: Page) {
  await page.goto('/')
  await expect(page.getByText('实时连接', { exact: false })).toBeVisible()
  await page.getByRole('button', { name: '连接钱包', exact: true }).click()
  await page.getByRole('button', { name: '浏览器钱包 连接 →' }).click()
  await page
    .locator('header')
    .getByRole('button', { name: '存款', exact: true })
    .click()
  await expect(
    page.getByRole('dialog').getByText('100', { exact: true }),
  ).toBeVisible()
}

test('Web3 存款：切换测试链、一次点击连续授权和存款、核对到账后返回交易', async ({
  page,
}) => {
  const exchange = await mockExchange(page)
  const funds = await mockFunding(page, { mainnet: true })
  await openFunds(page)
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: '切换至 Arbitrum Sepolia' }).click()
  await dialog.getByLabel('存款金额（USDC）').fill('10')
  await dialog.getByRole('button', { name: '存款', exact: true }).click()
  await expect.poll(() => funds.transactions.length).toBe(2)
  expect(funds.transactions[0].to.toLowerCase()).toBe(
    '0x75faf114eafb1bdbe2f0316df893fd58ce46aa4d',
  )
  expect(BigInt(`0x${funds.transactions[0].data.slice(-64)}`)).toBe(10000000n)
  await expect(
    dialog.getByText('源链已确认 · 等待 fameex-testnet 到账'),
  ).toBeVisible()
  expect(funds.transactions).toHaveLength(2)
  expect(funds.transactions[1].to.toLowerCase()).toBe(
    '0x8fe6b999dc680ccfdd5bf7eb0974218be2542daa',
  )
  funds.setCredited()
  await expect(
    dialog.getByText('源链已确认 · 等待 fameex-testnet 到账'),
  ).toBeVisible()
  funds.setLedger()
  await expect(dialog.getByText('fameex-testnet 到账已核验')).toBeVisible({
    timeout: 15000,
  })
  await page.screenshot({
    path: 'output-tdd/playwright/web3-onboarding/deposit-credited.png',
  })
  await expect(
    dialog.getByRole('button', { name: '返回交易', exact: true }),
  ).toHaveCount(0)
  await dialog.getByRole('button', { name: '关闭钱包面板' }).click()
  exchange.pushMarket('BTC', 70000)
  await expect(
    page.getByRole('button', { name: '下单', exact: true }),
  ).toBeEnabled()
})

test('Web3 未知资金结果刷新后保留进度，不锁表单、不需人工解除且不会自动重发', async ({
  page,
}) => {
  const exchange = await mockExchange(page)
  const funds = await mockFunding(page, { lost: true })
  await openFunds(page)
  await page.getByLabel('存款金额（USDC）').fill('10')
  await page
    .getByRole('dialog')
    .getByRole('button', { name: '存款', exact: true })
    .click()
  await expect(page.getByText('资金结果待确认')).toBeVisible()
  await page.reload()
  await page
    .locator('header')
    .getByRole('button', { name: '存款', exact: true })
    .click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByLabel('存款金额（USDC）')).toBeEditable()
  await dialog.getByLabel('存款金额（USDC）').fill('5')
  await expect(
    dialog.getByRole('button', { name: '存款', exact: true }),
  ).toBeEnabled()
  await expect(dialog.getByText('解除本地保护')).toHaveCount(0)
  await expect(dialog.getByText('手动核对未确认请求')).toHaveCount(0)
  expect(funds.transactions).toHaveLength(2)
  await openFundOperation(page, '划转')
  await dialog.getByLabel('划转金额（USDC）').fill('5')
  await dialog.getByRole('button', { name: '确认划转' }).click()
  await expect.poll(() => exchange.writes.length).toBe(1)
  expect(exchange.writes[0]).toMatchObject({
    type: 'usdClassTransfer',
    amount: '5',
    toPerp: false,
  })
  expect(funds.transactions).toHaveLength(2)
})

test('Web3 取消 USDC 授权不会发起存款或留下未确认锁', async ({ page }) => {
  await mockExchange(page)
  const funds = await mockFunding(page, { deny: true })
  await openFunds(page)
  await page.getByLabel('存款金额（USDC）').fill('10')
  await page
    .getByRole('dialog')
    .getByRole('button', { name: '存款', exact: true })
    .click()
  await expect(
    page.getByRole('dialog').getByText('已取消钱包操作，未自动重试。'),
  ).toBeVisible()
  await expect(
    page.getByRole('dialog').getByRole('button', { name: '存款', exact: true }),
  ).toBeEnabled()
  expect(funds.transactions).toHaveLength(0)
})

test('Web3 划转使用主钱包确认，精度和可用余额校验在签名前完成', async ({
  page,
}) => {
  const { writes } = await mockExchange(page)
  await mockFunding(page)
  await openFunds(page)
  const dialog = page.getByRole('dialog')
  await openFundOperation(page, '划转')
  await dialog.getByLabel('划转金额（USDC）').fill('966')
  await expect(dialog.getByRole('button', { name: '确认划转' })).toBeDisabled()
  await expect(dialog.getByText('划转金额超过可用余额')).toBeVisible()
  expect(writes).toHaveLength(0)
  await dialog.getByLabel('划转金额（USDC）').fill('10.123456')
  await dialog.getByRole('button', { name: '确认划转' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(writes).toHaveLength(1)
  expect(writes[0]).toMatchObject({
    type: 'usdClassTransfer',
    amount: '10.123456',
    toPerp: false,
  })
  await page
    .locator('#account-panel')
    .getByRole('button', { name: '划转', exact: true })
    .click()
  await dialog.getByRole('button', { name: '交换划转方向' }).click()
  await dialog.getByLabel('划转金额（USDC）').fill('10')
  await dialog.getByRole('button', { name: '确认划转' }).click()
  await expect.poll(() => writes.length).toBe(2)
  expect(writes[1]).toMatchObject({
    type: 'usdClassTransfer',
    amount: '10',
    toPerp: true,
  })
})

test('Web3 未安装钱包仍显示列表，点击进入对应官方安装页', async ({ page }) => {
  const exchange = await mockExchange(page)
  await page.addInitScript(() => {
    const provider = window.ethereum
    delete window.ethereum
    window.addEventListener('test-wallet-installed', () =>
      window.dispatchEvent(
        new CustomEvent('eip6963:announceProvider', {
          detail: {
            info: {
              uuid: 'late-metamask',
              name: 'MetaMask Extension',
              rdns: 'io.metamask',
            },
            provider,
          },
        }),
      ),
    )
  })
  const downloads = [
    ['MetaMask', 'https://metamask.com/download'],
    ['Rabby', 'https://rabby.io/'],
    ['OKX Wallet', 'https://web3.okx.com/download'],
    ['Bitget Wallet', 'https://web3.bitget.com/wallet-download'],
    ['Phantom', 'https://phantom.com/download'],
    ['Coinbase Wallet', 'https://www.coinbase.com/wallet/downloads'],
    ['Trust Wallet', 'https://trustwallet.com/download'],
    [
      'Bybit Wallet',
      'https://chromewebstore.google.com/detail/bybit-wallet/pdliaogehgdbhbnmkklieghmmjkpigpa',
    ],
  ]
  for (const [, url] of downloads) {
    await page.context().route(url, (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: '<p>Wallet download</p>',
      }),
    )
  }
  await page.goto('/')
  await page.getByRole('button', { name: '连接钱包', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(
    dialog.getByRole('heading', { name: '在手机 App 上交易' }),
  ).toBeVisible()
  await expect(dialog.getByText(/前往手机连接页，按步骤/)).toBeVisible()
  for (const [name, url] of downloads) {
    const link = dialog.getByRole('link', {
      name: `${name} 未安装，前往官网安装`,
    })
    await expect(link).toBeVisible()
    await expect(link).toContainText('未安装')
    await expect(link).toHaveAttribute('href', url)
    await expect(link).toHaveAttribute('target', '_blank')
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    // Chrome 商店响应被 mock 时会关闭浏览器，这里只核对安装地址。
    if (name === 'Bybit Wallet') continue
    const popup = page.waitForEvent('popup')
    await link.click()
    const installPage = await popup
    await expect(installPage).toHaveURL(url)
    await expect(installPage.getByText('Wallet download')).toBeVisible()
    await installPage.close()
    await expect(dialog).toBeVisible()
  }
  await expect(dialog.getByRole('button', { name: /连接 →/ })).toHaveCount(0)
  expect(exchange.agentRegistrations()).toBe(0)
  expect(exchange.writes).toEqual([])
  await expect(
    dialog.getByText('安装并启用扩展后，刷新本页即可连接。'),
  ).toBeVisible()
  await expect(
    dialog.getByRole('link', { name: /未安装，前往官网安装/ }),
  ).toHaveCount(downloads.length)
  await expect(
    dialog.getByRole('link', { name: '前往手机连接页 →' }),
  ).toHaveAttribute('href', '/connect')
  await dialog.getByRole('link').first().scrollIntoViewIfNeeded()
  await page.screenshot({
    path: 'output-tdd/playwright/wallet-catalog/desktop.png',
  })
  await page.setViewportSize({ width: 390, height: 667 })
  await dialog.getByRole('link').last().scrollIntoViewIfNeeded()
  await expect(dialog.getByRole('link').last()).toBeInViewport()
  await expect(
    dialog.getByRole('button', { name: '关闭钱包面板' }),
  ).toBeInViewport()
  await page.screenshot({
    path: 'output-tdd/playwright/wallet-catalog/mobile.png',
  })
  await dialog.getByRole('button', { name: '关闭钱包面板' }).click()
  await page.getByRole('button', { name: '语言', exact: true }).click()
  await page.getByRole('menuitemradio', { name: 'English' }).click()
  await page
    .getByRole('button', { name: 'Connect wallet', exact: true })
    .click()
  await expect(
    dialog.getByRole('link', {
      name: 'MetaMask Not installed, install from the official website',
    }),
  ).toBeVisible()
  await expect(
    dialog.getByText(
      'Install and enable the extension, then refresh this page to connect.',
    ),
  ).toBeVisible()
  await page.evaluate(() =>
    window.dispatchEvent(new Event('test-wallet-installed')),
  )
  await expect(
    dialog.getByRole('button', { name: 'MetaMask Extension Connect →' }),
  ).toBeEnabled()
  await expect(dialog.getByRole('link', { name: /MetaMask/ })).toHaveCount(0)
  await expect(
    dialog.getByRole('link', {
      name: 'Rabby Not installed, install from the official website',
    }),
  ).toBeVisible()
  expect(exchange.agentRegistrations()).toBe(0)
  expect(exchange.writes).toEqual([])
})

test('Web3 多钱包发现与断开：主动弹出连接列表，重新选择前不发起授权', async ({
  page,
}) => {
  const exchange = await mockExchange(page)
  await mockFunding(page)
  await page.addInitScript(() => {
    const ethereum = window.ethereum
    if (!ethereum) throw new Error('Missing mock wallet')
    for (const name of ['MetaMask', 'Rabby']) {
      const provider = {
        ...ethereum,
        request: async (params: { method: string; params?: unknown[] }) => {
          if (params.method === 'wallet_requestPermissions')
            localStorage.setItem('test-selected-wallet', name)
          return ethereum.request(
            params as Parameters<typeof ethereum.request>[0],
          )
        },
      }
      window.addEventListener('eip6963:requestProvider', () =>
        window.dispatchEvent(
          new CustomEvent('eip6963:announceProvider', {
            detail: { info: { uuid: name, name }, provider },
          }),
        ),
      )
    }
  })
  await page.goto('/')
  await page.getByRole('button', { name: '连接钱包', exact: true }).click()
  await expect(
    page.getByRole('button', { name: 'MetaMask 连接 →' }),
  ).toBeVisible()
  await expect(page.getByRole('button', { name: 'Rabby 连接 →' })).toBeVisible()
  await expect(
    page
      .getByRole('dialog')
      .getByRole('link', { name: /未安装，前往官网安装/ }),
  ).toHaveCount(6)
  await expect(
    page.getByRole('dialog').getByRole('link', { name: /MetaMask|Rabby/ }),
  ).toHaveCount(0)
  expect(
    await page.evaluate(() => localStorage.getItem('test-selected-wallet')),
  ).toBeNull()
  await page.screenshot({
    path: 'output-tdd/playwright/web3-onboarding/wallets.png',
  })
  await page.getByRole('button', { name: 'Rabby 连接 →' }).click()
  expect(
    await page.evaluate(() => localStorage.getItem('test-selected-wallet')),
  ).toBe('Rabby')
  await page
    .locator('header')
    .getByRole('button', { name: /0x1111/ })
    .click()
  await expect(
    page.getByRole('dialog').getByText('Rabby · 当前地址'),
  ).toBeVisible()
  await page.getByRole('button', { name: '断开钱包', exact: true }).click()
  await expect(
    page.getByRole('dialog', { name: '连接', exact: true }),
  ).toBeVisible()
  await expect(page.getByRole('button', { name: 'Rabby 连接 →' })).toBeEnabled()
  expect(exchange.agentRegistrations()).toBe(1)
  await page.getByRole('button', { name: '关闭钱包面板' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.getByRole('button', { name: '连接钱包', exact: true }).click()
  await page.getByRole('button', { name: 'Rabby 连接 →' }).click()
  exchange.pushMarket('BTC', 70000)
  await expect(
    page.getByRole('button', { name: '下单', exact: true }),
  ).toBeEnabled()
  await page.getByLabel('数量（BTC）', { exact: true }).fill('0.001')
  await signPreview(page)
  await expect.poll(() => exchange.writes.length).toBe(1)
  expect(
    await page.evaluate(() => sessionStorage.getItem('mock-wallet-signs')),
  ).toBe('1')
  await page.evaluate(() =>
    window.dispatchEvent(new Event('test-wallet-disconnect')),
  )
  await expect(
    page.getByRole('dialog', { name: '连接', exact: true }),
  ).toBeVisible()
  await expect(page.getByRole('button', { name: 'Rabby 连接 →' })).toBeEnabled()
  expect(exchange.agentRegistrations()).toBe(1)
  expect(
    await page.evaluate(() =>
      sessionStorage.getItem('mock-permission-requests'),
    ),
  ).toBe('2')
  expect(exchange.writes).toHaveLength(1)
  await page.getByRole('button', { name: 'Rabby 连接 →' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.evaluate(() =>
    window.dispatchEvent(new Event('test-wallet-empty-accounts')),
  )
  await expect(
    page.getByRole('dialog', { name: '连接', exact: true }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Rabby 连接 →' }).click()
  exchange.pushMarket('BTC', 70000)
  await expect(
    page.getByRole('button', { name: '下单', exact: true }),
  ).toBeEnabled()
  expect(exchange.agentRegistrations()).toBe(1)
  expect(
    await page.evaluate(() => sessionStorage.getItem('mock-wallet-signs')),
  ).toBe('1')
  expect(
    await page.evaluate(() =>
      sessionStorage.getItem('mock-permission-requests'),
    ),
  ).toBe('4')
})

for (const mode of [
  'default',
  'disabled',
  'dexAbstraction',
  'unifiedAccount',
  'portfolioMargin',
]) {
  test(`Web3 按账户类型显示所有划转入口：${mode}`, async ({ page }) => {
    const { writes } = await mockExchange(page)
    await mockFunding(page)
    await mockWithdrawal(page)
    await page.route(
      'https://api.hyperliquid-testnet.xyz/info',
      async (route) => {
        if (route.request().postDataJSON().type === 'userAbstraction')
          await route.fulfill({ json: mode })
        else await route.fallback()
      },
    )
    await ready(page)
    const canTransfer = !['unifiedAccount', 'portfolioMargin'].includes(mode)
    const account = page.getByRole('region', { name: '账户概览', exact: true })
    await expect(
      account.getByRole('button', { name: '划转', exact: true }),
    ).toHaveCount(canTransfer ? 1 : 0)
    await page
      .locator('header')
      .getByRole('button', { name: /^0x[0-9a-f]{4}…[0-9a-f]{4}$/i })
      .click()
    const dialog = page.getByRole('dialog')
    await expect(
      dialog.getByRole('button', { name: '划转', exact: true }),
    ).toHaveCount(canTransfer ? 1 : 0)
    await dialog.getByRole('button', { name: '提款', exact: true }).click()
    await expect(
      dialog.getByRole('button', { name: '最大值', exact: true }),
    ).toBeEnabled()
    await expect(
      dialog.getByRole('button', { name: '现货转入合约', exact: true }),
    ).toHaveCount(canTransfer ? 1 : 0)
    expect(writes).toHaveLength(0)
  })
}

test('Web3 EVM 网络变更保留 HyperCore 授权，账户变更则立即失效', async ({
  page,
}) => {
  const { writes } = await mockExchange(page)
  await ready(page)
  await page.evaluate(() =>
    window.dispatchEvent(new Event('test-network-change')),
  )
  await expect(
    page.getByRole('button', { name: '下单', exact: true }),
  ).toBeEnabled()
  await expect(
    page.locator('header').getByRole('button', { name: /0x1111/ }),
  ).toBeVisible()
  await page.evaluate(() =>
    window.dispatchEvent(new Event('test-account-change')),
  )
  await expect(
    page.getByRole('dialog', { name: '连接', exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: '浏览器钱包 连接 →' }),
  ).toBeEnabled()
  expect(writes).toHaveLength(0)
})

async function mockWithdrawal(
  page: Page,
  mode: 'ok' | 'lost' | 'reject' | 'unified' = 'ok',
) {
  const writes: { nonce: number; amount: string; sourceDex: string }[] = []
  let indexed = false
  let received = false
  let gasPrice = 100000000n
  const hash = `0x${'ee'.repeat(32)}`
  await page.route('https://rpc.hyperliquid-testnet.xyz/evm', async (route) => {
    const request = route.request().postDataJSON()
    let result: unknown
    if (request.method === 'eth_gasPrice') result = `0x${gasPrice.toString(16)}`
    else if (request.method === 'eth_call')
      result = `0x${200000n.toString(16).padStart(64, '0')}`
    else return route.fallback()
    await route.fulfill({ json: { jsonrpc: '2.0', id: request.id, result } })
  })
  await page.route(
    'https://api.hyperliquid-testnet.xyz/info',
    async (route) => {
      const request = route.request().postDataJSON()
      const fixtures: Record<string, unknown> = {
        allMids: { HYPE: '2500' },
        preTransferCheck: {
          fee: '0',
          isSanctioned: false,
          userExists: true,
          userHasSentTx: true,
        },
        usdcRouting: { depositRoute: 'cctp', withdrawalRoute: 'cctp' },
      }
      if (mode === 'unified') {
        fixtures.userAbstraction = 'unifiedAccount'
        fixtures.spotClearinghouseState = {
          balances: [
            {
              coin: 'USDC',
              token: 0,
              total: '100',
              hold: '10',
              entryNtl: '100',
            },
          ],
          tokenToAvailableAfterMaintenance: [[0, '30']],
        }
      }
      if (request.type in fixtures)
        await route.fulfill({ json: fixtures[request.type] })
      else await route.fallback()
    },
  )
  await page.route(
    'https://api.hyperliquid-testnet.xyz/exchange',
    async (route) => {
      const request = route.request().postDataJSON()
      if (request.action.type !== 'sendToEvmWithData') return route.fallback()
      expect(request.action).toMatchObject({
        type: 'sendToEvmWithData',
        hyperliquidChain: 'Testnet',
        token: 'USDC',
        destinationRecipient: address,
        destinationChainId: 3,
        addressEncoding: 'hex',
        gasLimit: 200000,
        data: '0x',
        nonce: request.nonce,
      })
      writes.push(request.action)
      if (mode === 'lost') await route.abort('failed')
      else
        await route.fulfill({
          json:
            mode === 'reject'
              ? {
                  status: 'err',
                  response: 'Insufficient balance for withdrawal',
                }
              : { status: 'ok', response: { type: 'default' } },
        })
    },
  )
  await page.route('https://dev.indexer.api.across.to/**', async (route) => {
    await route.fulfill({
      json:
        indexed && writes[0]
          ? [
              {
                originChainId: 998,
                destinationChainId: 421614,
                nonce: String(writes[0].nonce),
                fillTxnRef: hash,
              },
            ]
          : [],
    })
  })
  await page.route('https://sepolia-rollup.arbitrum.io/rpc', async (route) => {
    const request = route.request().postDataJSON()
    if (
      request.method !== 'eth_getTransactionReceipt' ||
      request.params[0] !== hash
    )
      return route.fallback()
    const log = {
      address: '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d',
      topics: [
        '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
        `0x${'0'.repeat(64)}`,
        `0x${'0'.repeat(24)}${address.slice(2)}`,
      ],
      data: `0x${9800000n.toString(16).padStart(64, '0')}`,
      logIndex: '0x0',
      transactionIndex: '0x0',
      transactionHash: hash,
      blockHash: `0x${'cc'.repeat(32)}`,
      blockNumber: '0x1',
      removed: false,
    }
    await route.fulfill({
      json: {
        jsonrpc: '2.0',
        id: request.id,
        result: {
          transactionHash: hash,
          transactionIndex: '0x0',
          blockHash: `0x${'cc'.repeat(32)}`,
          blockNumber: '0x1',
          from: address,
          to: address,
          cumulativeGasUsed: '0x5208',
          gasUsed: '0x5208',
          effectiveGasPrice: '0x1',
          contractAddress: null,
          logs:
            received && writes[0]
              ? [
                  log,
                  ...cctpFixture(
                    address,
                    true,
                    writes[0].nonce,
                    writes[0].amount,
                  ).receipt.logs,
                ]
              : [],
          logsBloom: `0x${'00'.repeat(256)}`,
          status: '0x1',
          type: '0x2',
        },
      },
    })
  })
  return {
    writes,
    index: () => {
      indexed = true
    },
    receive: () => {
      received = true
    },
    increaseGas: () => {
      gasPrice *= 2n
    },
  }
}

async function openFundOperation(page: Page, name: '存款' | '划转' | '提款') {
  await page
    .getByRole('dialog')
    .getByRole('button', { name: '关闭钱包面板' })
    .click()
  await page
    .locator('#account-panel')
    .getByRole('button', { name, exact: true })
    .click()
}

async function fillWithdrawal(page: Page) {
  await openFundOperation(page, '提款')
  const dialog = page.getByRole('dialog')
  await expect(
    dialog.getByRole('button', { name: '最大值', exact: true }),
  ).toBeEnabled()
  await dialog.getByLabel('提款金额（USDC）').fill('10')
  return dialog
}

test('Web3 提款：主钱包确认、固定测试网 CCTP 路由、目标链真实到账才成功', async ({
  page,
}) => {
  // 跨链索引与到账核验各等一次 10 秒轮询，另留页面操作时间。
  test.setTimeout(60000)
  await mockExchange(page)
  await mockFunding(page)
  const funds = await mockWithdrawal(page)
  await openFunds(page)
  const dialog = await fillWithdrawal(page)
  await expect(dialog.getByText('9.8 USDC', { exact: true })).toBeVisible()
  await expect(
    dialog.getByRole('button', { name: '提现至 Arbitrum Sepolia' }),
  ).toBeEnabled()
  expect(funds.writes).toHaveLength(0)
  const bounds = await dialog.boundingBox()
  const confirmBounds = await dialog
    .getByRole('button', { name: '提现至 Arbitrum Sepolia' })
    .boundingBox()
  if (!bounds || !confirmBounds) throw new Error('提款确认按钮不可见')
  expect(confirmBounds.y + confirmBounds.height).toBeLessThanOrEqual(
    bounds.y + bounds.height,
  )
  await page.screenshot({
    path: 'output-tdd/playwright/funds-flow/withdraw-review.png',
  })
  await dialog.getByRole('button', { name: '提现至 Arbitrum Sepolia' }).click()
  await expect(dialog.getByText('提款请求已接受 · 等待跨链到账')).toBeVisible()
  expect(funds.writes).toHaveLength(1)
  expect(funds.writes[0]).toMatchObject({ amount: '10', sourceDex: '' })
  funds.index()
  await expect(dialog.getByText('目标链交易已找到 · 等待到账核验')).toBeVisible(
    { timeout: 15000 },
  )
  await expect(dialog.getByText('Arbitrum Sepolia 到账已核验')).toHaveCount(0)
  funds.receive()
  await expect(dialog.getByText('Arbitrum Sepolia 到账已核验')).toBeVisible({
    timeout: 15000,
  })
  await expect(
    dialog.getByRole('link', { name: /查看链上交易/ }),
  ).toHaveAttribute('href', /^https:\/\/sepolia.arbiscan.io\/tx\/0x/)
})

test('Web3 提款未知响应刷新后不锁表单，按 nonce 自动恢复查询且不自动重发', async ({
  page,
}) => {
  await mockExchange(page)
  await mockFunding(page)
  const funds = await mockWithdrawal(page, 'lost')
  await openFunds(page)
  const dialog = await fillWithdrawal(page)
  await dialog.getByRole('button', { name: '提现至 Arbitrum Sepolia' }).click()
  await expect(dialog.getByText('资金结果待确认')).toBeVisible()
  await page.reload()
  await page
    .locator('header')
    .getByRole('button', { name: '存款', exact: true })
    .click()
  await openFundOperation(page, '提款')
  await expect(dialog.getByLabel('提款金额（USDC）')).toBeEditable()
  await expect(dialog.getByText('解除本地保护')).toHaveCount(0)
  expect(funds.writes).toHaveLength(1)
  funds.index()
  funds.receive()
  await expect(dialog.getByText('Arbitrum Sepolia 到账已核验')).toBeVisible({
    timeout: 15000,
  })
  expect(funds.writes).toHaveLength(1)
})

test('Web3 提款费用上升必须再次点击确认，修改金额不会签名，拒绝后可重试', async ({
  page,
}) => {
  await mockExchange(page)
  await mockFunding(page)
  const funds = await mockWithdrawal(page, 'reject')
  await openFunds(page)
  const dialog = await fillWithdrawal(page)
  await dialog.getByLabel('提款金额（USDC）').fill('11')
  await expect(dialog.getByText('10.8 USDC', { exact: true })).toBeVisible()
  expect(funds.writes).toHaveLength(0)
  funds.increaseGas()
  await dialog.getByRole('button', { name: '提现至 Arbitrum Sepolia' }).click()
  await expect(dialog.getByRole('alert')).toContainText('费用已更新')
  expect(funds.writes).toHaveLength(0)
  await expect(
    dialog.getByRole('button', { name: '提现至 Arbitrum Sepolia' }),
  ).toBeEnabled()
  await dialog.getByRole('button', { name: '提现至 Arbitrum Sepolia' }).click()
  await expect(dialog.getByText('操作已取消或失败')).toBeVisible()
  expect(funds.writes).toHaveLength(1)
})

test('Web3 统一账户提款使用现货来源，全部金额预留维护保证金和 Gas', async ({
  page,
}) => {
  await mockExchange(page)
  await mockFunding(page)
  const funds = await mockWithdrawal(page, 'unified')
  await openFunds(page)
  const dialog = page.getByRole('dialog')
  await openFundOperation(page, '提款')
  await dialog.getByRole('button', { name: '最大值', exact: true }).click()
  await expect(dialog.getByLabel('提款金额（USDC）')).toHaveValue('29.95')
  expect(funds.writes).toHaveLength(0)
  await dialog.getByRole('button', { name: '提现至 Arbitrum Sepolia' }).click()
  await expect(dialog.getByText('提款请求已接受 · 等待跨链到账')).toBeVisible()
  expect(funds.writes[0]).toMatchObject({ amount: '29.95', sourceDex: 'spot' })
})

test('Web3 账户区资金入口连接后保留提款意图，窄屏弹窗可操作', async ({
  page,
}) => {
  await mockExchange(page)
  await mockFunding(page)
  await mockWithdrawal(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await expect(page.getByText('实时连接', { exact: false })).toBeVisible()
  await page
    .getByRole('region', { name: '账户概览' })
    .getByRole('button', { name: '提款', exact: true })
    .click()
  await page.getByRole('button', { name: '浏览器钱包 连接 →' }).click()
  const dialog = page.getByRole('dialog')
  await expect(
    dialog.getByRole('heading', { name: '提款', exact: true }),
  ).toBeVisible()
  await expect(dialog.getByLabel('提款金额（USDC）')).toBeVisible()
  await expect(
    dialog.getByRole('button', { name: '最大值', exact: true }),
  ).toBeEnabled()
  const rect = await dialog.boundingBox()
  if (!rect) throw new Error('资金弹窗不可见')
  expect(rect.x).toBeGreaterThanOrEqual(0)
  expect(rect.x + rect.width).toBeLessThanOrEqual(390)
  await page.screenshot({
    path: 'output-tdd/playwright/funds-flow/mobile-withdraw.png',
  })
})

test('Web3 首次入金：未激活账户不请求交易授权签名，直接引导存款并显示缺少 Gas', async ({
  page,
}) => {
  await mockExchange(page)
  await mockFunding(page)
  let exists = false
  let exchangeWrites = 0
  await page.route(
    'https://api.hyperliquid-testnet.xyz/info',
    async (route) => {
      const type = route.request().postDataJSON().type
      if (type === 'userRole')
        return route.fulfill({ json: { role: exists ? 'user' : 'missing' } })
      if (type === 'clearinghouseState') {
        const summary = {
          accountValue: '0',
          totalNtlPos: '0',
          totalRawUsd: '0',
          totalMarginUsed: '0',
        }
        return route.fulfill({
          json: {
            marginSummary: summary,
            crossMarginSummary: summary,
            withdrawable: '0',
            crossMaintenanceMarginUsed: '0',
            assetPositions: [],
            time: Date.now(),
          },
        })
      }
      if (type === 'spotClearinghouseState')
        return route.fulfill({ json: { balances: [] } })
      return route.fallback()
    },
  )
  await page.route('https://api.hyperliquid-testnet.xyz/exchange', (route) => {
    exchangeWrites++
    return route.fallback()
  })
  await page.route('https://sepolia-rollup.arbitrum.io/rpc', (route) => {
    const request = route.request().postDataJSON()
    return request.method === 'eth_getBalance'
      ? route.fulfill({
          json: { jsonrpc: '2.0', id: request.id, result: '0x0' },
        })
      : route.fallback()
  })
  await page.addInitScript(() => {
    const provider = window.ethereum
    if (!provider) throw new Error('Missing mock wallet')
    const request = provider.request.bind(provider)
    provider.request = (async (args: {
      method: string
      params?: unknown[]
    }) => {
      if (args.method === 'eth_signTypedData_v4')
        localStorage.setItem(
          'test-sign-count',
          String(Number(localStorage.getItem('test-sign-count') ?? 0) + 1),
        )
      return request(args as Parameters<typeof request>[0])
    }) as typeof provider.request
  })
  await page.goto('/')
  await page.getByRole('button', { name: '连接钱包', exact: true }).click()
  await page.getByRole('button', { name: '浏览器钱包 连接 →' }).click()
  const dialog = page.getByRole('dialog')
  await expect(
    dialog.getByRole('heading', { name: '存款', exact: true }),
  ).toBeVisible()
  await dialog.getByLabel('存款金额（USDC）').fill('10')
  await expect(
    dialog.getByRole('button', { name: '需要 Arbitrum Sepolia ETH' }),
  ).toBeDisabled()
  await expect(dialog.getByText('Arbitrum Sepolia ETH 余额不足')).toBeVisible()
  expect(exchangeWrites).toBe(0)
  expect(
    await page.evaluate(() => localStorage.getItem('test-sign-count')),
  ).toBeNull()
  await page.screenshot({
    path: 'output-tdd/playwright/deposit-gate/needs-gas.png',
  })
  exists = true
  await dialog.getByRole('button', { name: '关闭钱包面板' }).click()
  await page
    .locator('header')
    .getByRole('button', { name: /^0x[0-9a-f]{4}…[0-9a-f]{4}$/i })
    .click()
  await page.getByRole('button', { name: '重新连接并核验' }).click()
  await expect(
    page.getByRole('button', { name: '下单', exact: true }),
  ).toBeEnabled()
  expect(exchangeWrites).toBe(1)
})

test('Web3 交易所返回 Must deposit 时转为存款引导，不保留错误授权状态', async ({
  page,
}) => {
  await mockExchange(page)
  await mockFunding(page)
  let attempts = 0
  await page.route(
    'https://api.hyperliquid-testnet.xyz/exchange',
    async (route) => {
      if (route.request().postDataJSON().action.type !== 'approveAgent')
        return route.fallback()
      attempts++
      await route.fulfill({
        json: {
          status: 'err',
          response: `Must deposit before performing actions. User: ${address}`,
        },
      })
    },
  )
  await page.goto('/')
  await page.getByRole('button', { name: '连接钱包', exact: true }).click()
  await page.getByRole('button', { name: '浏览器钱包 连接 →' }).click()
  await expect(
    page
      .getByRole('dialog')
      .getByRole('heading', { name: '存款', exact: true }),
  ).toBeVisible()
  await expect(
    page
      .getByRole('region', { name: '全局通知' })
      .getByText(
        'fameex-testnet 账户尚未激活。请先存入 USDC 并等待到账，再完成钱包连接。',
        { exact: true },
      ),
  ).toBeVisible()
  expect(attempts).toBe(1)
  await page.getByRole('button', { name: '关闭钱包面板' }).click()
  await expect(
    page
      .getByRole('region', { name: '下单面板' })
      .getByRole('button', { name: '存款', exact: true }),
  ).toBeEnabled()
})

test('Web3 独立资金弹窗：存提资产网络可下拉选择，无多余引导，关闭不签名', async ({
  page,
}) => {
  const { writes } = await mockExchange(page)
  const funds = await mockFunding(page)
  const withdrawals = await mockWithdrawal(page)
  await page.goto('/')
  await page.getByRole('button', { name: '连接钱包', exact: true }).click()
  await page.getByRole('button', { name: '浏览器钱包 连接 →' }).click()
  for (const name of ['存款', '划转', '提款']) {
    await page
      .locator('#account-panel')
      .getByRole('button', { name, exact: true })
      .click()
    const dialog = page.getByRole('dialog')
    await expect(
      dialog.getByRole('heading', {
        name: name === '划转' ? '划转 USDC' : name,
        exact: true,
      }),
    ).toBeVisible()
    await expect(dialog.getByRole('tablist', { name: '钱包功能' })).toHaveCount(
      0,
    )
    if (name !== '划转') {
      await dialog.getByRole('button', { name: /USDC 资产/ }).click()
      await expect(
        page.getByRole('option', { name: 'USDC', exact: true }),
      ).toBeVisible()
      await page.getByRole('option', { name: 'USDC', exact: true }).click()
      const trigger = dialog.getByRole('button', {
        name: /Arbitrum Sepolia.*网络/,
      })
      await trigger.focus()
      await page.keyboard.press('Enter')
      await expect(
        page.getByRole('option', {
          name: 'Arbitrum Sepolia',
          exact: true,
        }),
      ).toBeVisible()
      await page.screenshot({
        path: `output-tdd/playwright/funding-dialogs/${name}-network-open.png`,
      })
      await page.keyboard.press('Escape')
      await expect(trigger).toBeFocused()
    }
    await expect(
      dialog.getByText('没有测试资金？', { exact: true }),
    ).toHaveCount(0)
    await expect(
      dialog.getByText('在您的合约和现货余额之间划转 USDC。', { exact: true }),
    ).toHaveCount(0)
    await expect(dialog.getByText(/通常约 5 分钟到账/)).toHaveCount(0)
    await expect(dialog.getByText('解除本地保护', { exact: true })).toHaveCount(
      0,
    )
    await expect(
      dialog.getByText('手动核对未确认请求', { exact: true }),
    ).toHaveCount(0)
    const viewport = await dialog.evaluate((element) => ({
      height: element.parentElement?.clientHeight,
      scrollHeight: element.parentElement?.scrollHeight,
    }))
    expect(viewport.scrollHeight).toBe(viewport.height)
    const box = await dialog.boundingBox()
    expect(box?.width).toBeLessThanOrEqual(480)
    await page.screenshot({
      path: `output-tdd/playwright/funding-dialogs/${name}.png`,
    })
    await dialog.getByRole('button', { name: '关闭钱包面板' }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
  }
  expect(writes).toHaveLength(0)
  expect(funds.transactions).toHaveLength(0)
  expect(withdrawals.writes).toHaveLength(0)
})

test('Web3 提款单页：先展示费用与最大值，点击提款才签名，现货快捷入口带入方向', async ({
  page,
}) => {
  await mockExchange(page)
  await mockFunding(page)
  const funds = await mockWithdrawal(page)
  await openFunds(page)
  await page
    .getByRole('dialog')
    .getByRole('button', { name: '关闭钱包面板' })
    .click()
  await page
    .locator('#account-panel')
    .getByRole('button', { name: '提款', exact: true })
    .click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByText('跨链手续费', { exact: true })).toBeVisible()
  await expect(
    dialog.getByRole('button', { name: '最大值', exact: true }),
  ).toBeEnabled()
  await dialog.getByLabel('提款金额（USDC）').fill('10')
  await expect(dialog.getByText('9.8 USDC', { exact: true })).toBeVisible()
  await expect(
    dialog.getByRole('button', { name: '提现至 Arbitrum Sepolia' }),
  ).toBeEnabled()
  expect(funds.writes).toHaveLength(0)
  funds.increaseGas()
  await expect(dialog.getByText(/0\.00004000 HYPE/)).toBeVisible({
    timeout: 20000,
  })
  await dialog.getByRole('button', { name: '现货转入合约' }).click()
  await expect(
    page.getByRole('dialog').getByRole('heading', { name: '划转 USDC' }),
  ).toBeVisible()
  await expect(
    page.getByRole('dialog').getByLabel('划转方向', { exact: true }),
  ).toHaveText('从现货账户到合约账户')
  expect(funds.writes).toHaveLength(0)
})

test('Web3 提款报价期间切换账户，旧请求不得覆盖新账户或请求签名', async ({
  page,
}) => {
  const { writes } = await mockExchange(page)
  await mockFunding(page)
  const withdrawals = await mockWithdrawal(page)
  const gate = Promise.withResolvers<void>()
  let quoteReads = 0
  let oldAccount = true
  let oldQuoteReturned = false
  await page.route(
    'https://api.hyperliquid-testnet.xyz/info',
    async (route) => {
      const request = route.request().postDataJSON()
      if (
        request.type !== 'clearinghouseState' ||
        request.user !== '0x2222222222222222222222222222222222222222'
      )
        return route.fallback()
      const marginSummary = {
        accountValue: '7',
        totalNtlPos: '0',
        totalRawUsd: '7',
        totalMarginUsed: '0',
      }
      await route.fulfill({
        json: {
          marginSummary,
          crossMarginSummary: marginSummary,
          withdrawable: '7',
          crossMaintenanceMarginUsed: '0',
          assetPositions: [],
          time: Date.now(),
        },
      })
    },
  )
  await page.route('https://rpc.hyperliquid-testnet.xyz/evm', async (route) => {
    quoteReads++
    const old = oldAccount
    if (old) await gate.promise
    await route.fallback()
    if (old) oldQuoteReturned = true
  })
  await openFunds(page)
  await openFundOperation(page, '提款')
  await expect.poll(() => quoteReads).toBeGreaterThan(0)
  oldAccount = false
  await page.evaluate(() =>
    window.dispatchEvent(new Event('test-account-change')),
  )
  await expect(
    page.getByRole('dialog').getByRole('heading', { name: '连接' }),
  ).toBeVisible()
  await page.getByRole('button', { name: '浏览器钱包 连接 →' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page
    .getByRole('region', { name: '账户概览' })
    .getByRole('button', { name: '提款', exact: true })
    .click()
  await expect(
    page
      .getByRole('dialog')
      .getByText('0x2222222222222222222222222222222222222222', { exact: true }),
  ).toBeVisible()
  const max = page
    .getByRole('dialog')
    .getByRole('button', { name: '最大值', exact: true })
  await expect(max).toBeEnabled()
  gate.resolve()
  await expect.poll(() => oldQuoteReturned).toBe(true)
  await max.click()
  await expect(
    page.getByRole('dialog').getByLabel('提款金额（USDC）'),
  ).toHaveValue('7')
  await expect(
    page
      .getByRole('dialog')
      .getByRole('button', { name: '提现至 Arbitrum Sepolia' }),
  ).toBeEnabled()
  expect(writes).toHaveLength(0)
  expect(withdrawals.writes).toHaveLength(0)
})

test('Web3 存款授权 Gas 被拒后金额仍可编辑，无需解除保护即可重试', async ({
  page,
}) => {
  await mockExchange(page)
  const funds = await mockFunding(page, { lowFee: true })
  await openFunds(page)
  const dialog = page.getByRole('dialog')
  const amount = dialog.getByLabel('存款金额（USDC）')
  await amount.fill('10')
  await dialog.getByRole('button', { name: '存款', exact: true }).click()
  await expect(
    dialog.getByText(/Gas 费低于当前区块基础费，交易被拒绝/),
  ).toBeVisible()
  await expect(amount).toBeEditable()
  await expect(dialog.getByText('资金结果待确认')).toHaveCount(0)
  await expect(dialog.getByText('手动核对未确认请求')).toHaveCount(0)
  expect(funds.transactions).toHaveLength(0)
  await expect(dialog).toHaveCSS('opacity', '1')
  await page.screenshot({
    path: 'output-tdd/playwright/deposit-input/gas-rejected.png',
  })
  await dialog.getByRole('button', { name: '存款', exact: true }).click()
  await expect.poll(() => funds.transactions.length).toBe(2)
  expect(funds.feeEstimates).toHaveLength(3)
  expect(BigInt(funds.transactions[0].maxFeePerGas)).toBe(funds.feeEstimates[1])
  expect(BigInt(funds.transactions[1].maxFeePerGas)).toBe(funds.feeEstimates[2])
  expect(funds.feeEstimates[1]).toBeGreaterThan(funds.feeEstimates[0])
})

test('Web3 旧版无哈希授权记录不锁金额；已有授权直接存款，不自动发送', async ({
  page,
}) => {
  await mockExchange(page)
  const funds = await mockFunding(page)
  await page.addInitScript(
    ({ account }) => {
      localStorage.setItem(
        `hl-testnet-funding:${account}`,
        JSON.stringify({
          account,
          amount: '10',
          kind: 'approve',
          status: 'unknown',
          at: Date.now(),
        }),
      )
    },
    { account: address },
  )
  await page.route('https://sepolia-rollup.arbitrum.io/rpc', (route) => {
    const request = route.request().postDataJSON()
    if (
      request.method === 'eth_call' &&
      request.params[0].data.startsWith('0xdd62ed3e')
    )
      return route.fulfill({
        json: {
          jsonrpc: '2.0',
          id: request.id,
          result: `0x${10000000n.toString(16).padStart(64, '0')}`,
        },
      })
    return route.fallback()
  })
  await openFunds(page)
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByText('手动核对未确认请求')).toHaveCount(0)
  await expect(dialog.getByLabel('存款金额（USDC）')).toBeEditable()
  expect(funds.transactions).toHaveLength(0)
  await page.setViewportSize({ width: 390, height: 620 })
  await dialog.getByLabel('存款金额（USDC）').fill('10')
  const input = dialog.getByLabel('存款金额（USDC）')
  await expect(input).toBeInViewport()
  const rect = await input.boundingBox()
  expect(rect?.width).toBeGreaterThan(80)
  expect(rect?.height).toBeGreaterThan(16)
  await expect(dialog).toHaveCSS('opacity', '1')
  await page.screenshot({
    path: 'output-tdd/playwright/deposit-input/recovered-approval.png',
  })
  await dialog.getByRole('button', { name: '存款', exact: true }).click()
  await expect.poll(() => funds.transactions.length).toBe(1)
  expect(funds.transactions[0].to.toLowerCase()).toBe(
    '0x8fe6b999dc680ccfdd5bf7eb0974218be2542daa',
  )
})

test('Web3 授权成功但取消存款，重试跳过授权且无需解除保护', async ({
  page,
}) => {
  await mockExchange(page)
  const funds = await mockFunding(page)
  await page.addInitScript(() => {
    const provider = window.ethereum
    if (!provider) throw new Error('Missing mock wallet')
    const request = provider.request.bind(provider)
    let rejected = false
    provider.request = (async (args: {
      method: string
      params?: unknown[]
    }) => {
      const tx = args.params?.[0] as { data?: string } | undefined
      if (
        !rejected &&
        args.method === 'eth_sendTransaction' &&
        !tx?.data?.startsWith('0x095ea7b3')
      ) {
        rejected = true
        throw { code: 4001, message: 'User rejected deposit' }
      }
      return request(args as Parameters<typeof request>[0])
    }) as typeof provider.request
  })
  await openFunds(page)
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('存款金额（USDC）').fill('10')
  await dialog.getByRole('button', { name: '存款', exact: true }).click()
  await expect(dialog.getByText('已取消钱包操作，未自动重试。')).toBeVisible()
  expect(funds.transactions).toHaveLength(1)
  await expect(dialog.getByLabel('存款金额（USDC）')).toBeEditable()
  await dialog.getByRole('button', { name: '存款', exact: true }).click()
  await expect.poll(() => funds.transactions.length).toBe(2)
  expect(funds.transactions[1].to.toLowerCase()).toBe(
    '0x8fe6b999dc680ccfdd5bf7eb0974218be2542daa',
  )
})

test('Web3 授权确认期间切换钱包，停止下一笔存款', async ({ page }) => {
  await mockExchange(page)
  const funds = await mockFunding(page)
  const gate = Promise.withResolvers<void>()
  let receiptReturned = false
  await page.route('https://sepolia-rollup.arbitrum.io/rpc', async (route) => {
    const request = route.request().postDataJSON()
    if (request.method === 'eth_getTransactionReceipt') {
      await gate.promise
      await route.fallback()
      receiptReturned = true
      return
    }
    return route.fallback()
  })
  await openFunds(page)
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('存款金额（USDC）').fill('10')
  await dialog.getByRole('button', { name: '存款', exact: true }).click()
  await expect(
    dialog.getByRole('button', { name: '等待 USDC 授权确认…' }),
  ).toBeVisible()
  await page.evaluate(() =>
    window.dispatchEvent(new Event('test-account-change')),
  )
  gate.resolve()
  await expect.poll(() => receiptReturned).toBe(true)
  await expect(
    page.getByRole('button', { name: '浏览器钱包 连接 →' }),
  ).toBeEnabled()
  expect(funds.transactions).toHaveLength(1)
})

for (const saved of [null, '[]', '{invalid', '{"BTC":true}', '["delisted"]']) {
  test(`市场自选为空时可一键添加可用主流合约：${saved}`, async ({ page }) => {
    await mockExchange(page)
    await page.goto('/')
    await expect(page.getByText('实时连接', { exact: false })).toBeVisible()
    if (saved !== null)
      await page.evaluate(
        (value) => localStorage.setItem('hl-favorite-markets', value),
        saved,
      )
    await page.getByRole('button', { name: '交易市场', exact: true }).click()
    const selector = page.getByRole('region', { name: '市场选择器' })
    await selector.getByRole('tab', { name: '自选', exact: true }).click()
    await expect(selector.getByRole('option')).toHaveCount(0)
    expect(
      await page.evaluate(() => localStorage.getItem('hl-favorite-markets')),
    ).toBe(saved)
    await selector.getByRole('button', { name: '一键自选主流币对' }).click()
    await expect(selector.getByRole('option')).toHaveCount(3)
    for (const coin of ['BTC', 'ETH', 'SOL']) {
      await expect(
        selector.getByRole('button', {
          name: `取消收藏 ${coin} / USDC`,
          exact: true,
        }),
      ).toHaveAttribute('aria-pressed', 'true')
    }
    const stored = await page.evaluate(() =>
      JSON.parse(localStorage.getItem('hl-favorite-markets') ?? '[]'),
    )
    expect(stored.filter((coin: string) => coin !== 'delisted').sort()).toEqual(
      ['BTC', 'ETH', 'SOL'],
    )
  })
}

test('市场自选保留已有收藏，增删后刷新仍一致，清空后可重新一键添加', async ({
  page,
}) => {
  await mockExchange(page)
  await page.goto('/')
  await expect(page.getByText('实时连接', { exact: false })).toBeVisible()
  await page.evaluate(() =>
    localStorage.setItem('hl-favorite-markets', JSON.stringify(['BTC', '@7'])),
  )
  const trigger = page.getByRole('button', { name: '交易市场', exact: true })
  await trigger.click()
  const selector = page.getByRole('region', { name: '市场选择器' })
  await expect(
    selector.getByRole('button', { name: '一键自选主流币对' }),
  ).toHaveCount(0)
  await selector
    .getByRole('button', { name: '收藏 ETH / USDC', exact: true })
    .click()
  await selector.getByRole('tab', { name: '自选', exact: true }).click()
  await expect(selector.getByRole('option')).toHaveCount(3)
  await selector
    .getByRole('button', { name: '取消收藏 BTC / USDC', exact: true })
    .click()
  await page.reload()
  await expect(page.getByText('实时连接', { exact: false })).toBeVisible()
  await trigger.click()
  await selector.getByRole('tab', { name: '自选', exact: true }).click()
  await expect(selector.getByRole('option')).toHaveCount(2)
  for (const coin of ['ETH', 'HYPE'])
    await selector
      .getByRole('button', { name: `取消收藏 ${coin} / USDC`, exact: true })
      .click()
  await expect(
    selector.getByRole('button', { name: '一键自选主流币对' }),
  ).toBeVisible()
  expect(
    await page.evaluate(() => localStorage.getItem('hl-favorite-markets')),
  ).toBe('[]')
})

test('市场自选存储失败会提示且不会显示已保存', async ({ page }) => {
  await mockExchange(page)
  await page.addInitScript(() => {
    const setItem = Storage.prototype.setItem
    Storage.prototype.setItem = function (key, value) {
      if (key === 'hl-favorite-markets')
        throw new DOMException('Storage blocked', 'QuotaExceededError')
      setItem.call(this, key, value)
    }
  })
  await page.goto('/')
  await expect(page.getByText('实时连接', { exact: false })).toBeVisible()
  await page.getByRole('button', { name: '交易市场', exact: true }).click()
  await page.getByRole('button', { name: '一键自选主流币对' }).click()
  await expect(
    page.getByText('无法保存自选，请允许浏览器本地存储后重试。', {
      exact: true,
    }),
  ).toBeVisible()
  await expect(
    page.getByRole('region', { name: '市场选择器' }).getByRole('option'),
  ).toHaveCount(0)
  expect(
    await page.evaluate(() => localStorage.getItem('hl-favorite-markets')),
  ).toBeNull()
})

test('市场币种图标按基础币种加载，失败有占位，切换后恢复图标', async ({
  page,
}) => {
  await mockExchange(page)
  await page.route('https://app.hyperliquid.xyz/coins/*.svg', async (route) => {
    if (route.request().url().endsWith('/BTC.svg')) return route.abort()
    await route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28"><circle cx="14" cy="14" r="14" fill="green"/></svg>',
    })
  })
  await page.goto('/')
  await expect(page.getByText('实时连接', { exact: false })).toBeVisible()
  const trigger = page.getByRole('button', { name: '交易市场', exact: true })
  await expect(trigger.locator('img')).toHaveCount(0)
  await expect(trigger.locator('[aria-hidden=true]').first()).toHaveText('B')
  await trigger.click()
  const selector = page.getByRole('region', { name: '市场选择器' })
  await expect(
    selector
      .getByRole('option', { name: 'HYPE / USDC', exact: true })
      .locator('img'),
  ).toHaveAttribute('src', 'https://app.hyperliquid.xyz/coins/HYPE.svg')
  await selector
    .getByRole('option', { name: 'ETH / USDC', exact: true })
    .click()
  await expect(trigger.locator('img')).toHaveAttribute(
    'src',
    'https://app.hyperliquid.xyz/coins/ETH.svg',
  )
  await expect
    .poll(() =>
      trigger
        .locator('img')
        .evaluate((image: HTMLImageElement) => image.naturalWidth),
    )
    .toBeGreaterThan(0)
})

for (const width of [1280, 390]) {
  test(`市场下拉表头与数值列右侧对齐，滚动排序后保持一致：${width}`, async ({
    page,
  }) => {
    await mockExchange(page)
    await page.setViewportSize({ width, height: 720 })
    await page.goto('/')
    await expect(page.getByText('实时连接', { exact: false })).toBeVisible()
    if (width < 1024) {
      const chart = await page
        .getByRole('region', { name: '行情图表', exact: true })
        .boundingBox()
      const book = await page
        .getByRole('region', { name: '订单簿', exact: true })
        .boundingBox()
      if (!chart || !book) throw new Error('行情区域不可见')
      expect(chart.height).toBeGreaterThanOrEqual(504)
      expect(book.y).toBeGreaterThanOrEqual(chart.y + chart.height)
    }
    await page.getByRole('button', { name: '交易市场', exact: true }).click()
    const selector = page.getByRole('region', { name: '市场选择器' })
    const list = selector.getByRole('listbox', { name: '市场列表' })
    for (const sort of ['24h 成交额', '最新价格', '24h 涨跌']) {
      await selector
        .getByRole('button', { name: new RegExp(`^${sort}`) })
        .click()
      await list.evaluate((element) => {
        element.scrollTop = element.scrollHeight
      })
      const row = list.getByRole('option').last()
      for (const [index, title] of [
        '最新价格',
        '24h 涨跌',
        '24h 成交额',
      ].entries()) {
        const heading = selector.getByRole('button', {
          name: new RegExp(`^${title}`),
        })
        await expect(heading).toHaveCSS('text-align', 'right')
        const header = await heading.boundingBox()
        const cell = await row
          .locator(':scope > span')
          .nth(index + 1)
          .boundingBox()
        if (!header || !cell) throw new Error('市场列不可见')
        expect(
          Math.abs(header.x + header.width - cell.x - cell.width),
        ).toBeLessThanOrEqual(1)
      }
    }
    await list.evaluate((element) => {
      element.scrollTop = 0
    })
    expect(await page.evaluate(() => scrollY)).toBe(0)
    expect(
      await page.evaluate(
        () => document.documentElement.scrollHeight - innerHeight,
      ),
    ).toBeLessThanOrEqual(1)
    const menu = await selector.boundingBox()
    if (!menu) throw new Error('市场下拉不可见')
    const trigger = await page
      .getByRole('button', { name: '交易市场', exact: true })
      .boundingBox()
    if (!trigger) throw new Error('市场触发按钮不可见')
    expect(Math.abs(menu.x - trigger.x)).toBeLessThanOrEqual(1)
    expect(menu.y).toBeGreaterThanOrEqual(0)
    expect(menu.y + menu.height).toBeLessThanOrEqual(720)
    await page.screenshot({
      path: `output-tdd/playwright/market-alignment/columns-${width}.png`,
    })
    await selector
      .getByRole('option', { name: 'BTC / USDC', exact: true })
      .click()
    await expect(selector).toBeHidden()
  })
}

test('交易连接刷新后恢复，不重复授权；交易所撤销后不能误显示可交易', async ({
  page,
}) => {
  const exchange = await mockExchange(page)
  await ready(page)
  expect(exchange.agentRegistrations()).toBe(1)
  await page.reload()
  await expect(
    page.getByRole('button', { name: '下单', exact: true }),
  ).toBeEnabled()
  expect(exchange.agentRegistrations()).toBe(1)
  exchange.revokeAgent()
  await page.reload()
  await expect(
    page.getByRole('button', { name: '完成钱包连接', exact: true }),
  ).toBeVisible()
  expect(exchange.agentRegistrations()).toBe(1)
  expect(exchange.writes).toEqual([])
})

test('普通下单可取消确认、记住偏好；撤单和刷新不会再次请求钱包签名', async ({
  page,
}) => {
  const exchange = await mockExchange(page)
  await ready(page)
  await page.getByLabel('数量（BTC）', { exact: true }).fill('0.001')
  await page.getByRole('button', { name: '下单', exact: true }).click()
  await page.getByRole('checkbox', { name: '不再显示此消息' }).check()
  await page
    .getByRole('dialog')
    .getByRole('button', { name: '关闭', exact: true })
    .click()
  expect(exchange.writes).toHaveLength(0)
  await page.getByRole('button', { name: '下单', exact: true }).click()
  await expect(page.getByRole('dialog', { name: '确认订单' })).toBeVisible()
  await page.getByRole('checkbox', { name: '不再显示此消息' }).check()
  await confirmOrder(page)
  await expect.poll(() => exchange.writes.length).toBe(1)
  await page.reload()
  await expect(
    page.getByRole('button', { name: '下单', exact: true }),
  ).toBeEnabled()
  await page.getByLabel('数量（BTC）', { exact: true }).fill('0.001')
  await page.getByRole('button', { name: '下单', exact: true }).click()
  await expect.poll(() => exchange.writes.length).toBe(2)
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.getByRole('tab', { name: '当前委托', exact: true }).click()
  await page.getByRole('button', { name: '撤单', exact: true }).first().click()
  await expect.poll(() => exchange.writes.at(-1)?.type).toBe('cancel')
  expect(exchange.agentRegistrations()).toBe(1)
  expect(
    await page.evaluate(() => sessionStorage.getItem('mock-wallet-signs')),
  ).toBe('1')
  await page.getByLabel('数量（BTC）', { exact: true }).fill('0.000001')
  await page.getByRole('button', { name: '下单', exact: true }).click()
  await expect(
    page.getByRole('alert').filter({ hasText: '数量精度' }),
  ).toBeVisible()
  expect(exchange.writes).toHaveLength(3)
})

test('交易连接默认仅标签页保存；断开不自动恢复，重连复用授权，保持连接可升级保存', async ({
  page,
}) => {
  const exchange = await mockExchange(page)
  await ready(page)
  const storageState = () =>
    page.evaluate(() => ({
      session: !!sessionStorage.getItem('hl-testnet-trading-connection-v1'),
      persistent: !!localStorage.getItem('hl-testnet-trading-connection-v1'),
    }))
  expect(await storageState()).toEqual({ session: true, persistent: false })
  await page
    .locator('header')
    .getByRole('button', { name: /^0x[0-9a-f]{4}…[0-9a-f]{4}$/i })
    .click()
  await page.getByRole('button', { name: '断开钱包', exact: true }).click()
  expect(await storageState()).toEqual({ session: true, persistent: false })
  await page.reload()
  await expect(
    page.getByRole('button', { name: '连接钱包', exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: '下单', exact: true }),
  ).toHaveCount(0)
  expect(exchange.agentRegistrations()).toBe(1)
  await page.getByRole('button', { name: '连接钱包', exact: true }).click()
  expect(exchange.agentRegistrations()).toBe(1)
  await expect(page.getByRole('dialog', { name: '连接' })).toHaveCSS(
    'opacity',
    '1',
  )
  await page.screenshot({
    path: 'output-tdd/playwright/trading-flow-audit/connection-permissions.png',
    animations: 'disabled',
  })
  await expect(
    page.getByText('连接权限与保持连接', { exact: true }),
  ).toHaveCount(0)
  await page.getByRole('button', { name: '浏览器钱包 连接 →' }).click()
  await expect(
    page.getByRole('button', { name: '下单', exact: true }),
  ).toBeEnabled()
  expect(await storageState()).toEqual({ session: true, persistent: false })
  exchange.revokeAgent()
  await page.reload()
  await page.getByRole('button', { name: '完成钱包连接', exact: true }).click()
  await page.getByRole('checkbox', { name: '保持连接', exact: true }).check()
  await page
    .getByRole('button', { name: '重新连接并核验', exact: true })
    .click()
  await expect(
    page.getByRole('button', { name: '下单', exact: true }),
  ).toBeEnabled()
  expect(await storageState()).toEqual({ session: false, persistent: true })
  await page.reload()
  await expect(
    page.getByRole('button', { name: '下单', exact: true }),
  ).toBeEnabled()
  expect(exchange.agentRegistrations()).toBe(2)
})

test('交易连接核验失败保留凭据但禁止下单，重试只读恢复', async ({ page }) => {
  const exchange = await mockExchange(page)
  await ready(page)
  let fail = true
  await page.route('https://api.hyperliquid-testnet.xyz/info', (route) => {
    if (fail && route.request().postDataJSON().type === 'extraAgents')
      return route.fulfill({ status: 500, json: { error: 'temporary' } })
    return route.fallback()
  })
  await page.reload()
  await expect(
    page.getByRole('status').filter({ hasText: '连接未完成' }),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: '下单', exact: true }),
  ).toHaveCount(0)
  expect(
    await page.evaluate(
      () => !!sessionStorage.getItem('hl-testnet-trading-connection-v1'),
    ),
  ).toBe(true)
  fail = false
  await page
    .locator('header')
    .getByRole('button', { name: /^0x[0-9a-f]{4}…[0-9a-f]{4}$/i })
    .click()
  await page.getByRole('button', { name: '重新连接并核验' }).click()
  await expect(
    page.getByRole('button', { name: '下单', exact: true }),
  ).toBeEnabled()
  expect(exchange.agentRegistrations()).toBe(1)
  expect(
    await page.evaluate(() => sessionStorage.getItem('mock-wallet-signs')),
  ).toBe('1')
})

test('未知下单回报不会阻止已知订单撤单', async ({ page }) => {
  const exchange = await mockExchange(page, 'lost-response')
  await ready(page)
  await page.getByLabel('数量（BTC）', { exact: true }).fill('0.001')
  await signPreview(page)
  await expect(
    page.getByRole('button', { name: '查询未确认订单' }),
  ).toBeEnabled()
  await page.getByRole('tab', { name: '当前委托', exact: true }).click()
  await page.getByRole('button', { name: '撤单', exact: true }).click()
  await expect.poll(() => exchange.writes.at(-1)?.type).toBe('cancel')
  await expect(
    page.getByRole('button', {
      name: '等待账户数据 / 核对未确认订单',
      exact: true,
    }),
  ).toBeDisabled()
  await expect(
    page.getByRole('button', { name: '查询未确认订单' }),
  ).toBeEnabled()
})

test('交易所连接过期时，不恢复旧账户签名能力', async ({ page }) => {
  const exchange = await mockExchange(page)
  await ready(page)
  exchange.expireAgent()
  await page.reload()
  await expect(
    page.getByRole('button', { name: '完成钱包连接', exact: true }),
  ).toBeVisible()
  expect(
    await page.evaluate(
      () => !!sessionStorage.getItem('hl-testnet-trading-connection-v1'),
    ),
  ).toBe(false)
  expect(exchange.agentRegistrations()).toBe(1)
  expect(exchange.writes).toHaveLength(0)
})

test('有效连接被交易所拒绝后回到待连接状态，不保留错误连接或待确认锁', async ({
  page,
}) => {
  const exchange = await mockExchange(page)
  await ready(page)
  await page.route('https://api.hyperliquid-testnet.xyz/exchange', (route) =>
    route.fulfill({
      json: {
        status: 'err',
        response:
          'User or API Wallet 0x1111111111111111111111111111111111111111 does not exist.',
      },
    }),
  )
  await page.getByLabel('数量（BTC）', { exact: true }).fill('0.001')
  await signPreview(page)
  await expect(
    page.getByRole('button', { name: '完成钱包连接', exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: '查询未确认订单' }),
  ).toHaveCount(0)
  expect(
    await page.evaluate(
      () => !!sessionStorage.getItem('hl-testnet-trading-connection-v1'),
    ),
  ).toBe(false)
  expect(exchange.agentRegistrations()).toBe(1)
})

test('开仓与平仓确认偏好相互独立，Header 设置可恢复且刷新保留', async ({
  page,
}) => {
  const exchange = await mockExchange(page)
  await ready(page)
  await page.getByRole('tab', { name: '市价单', exact: true }).click()
  await page.getByLabel('数量（BTC）', { exact: true }).fill('0.001')
  await page.getByRole('button', { name: '下单', exact: true }).click()
  await page.getByRole('checkbox', { name: '不再显示此消息' }).check()
  await confirmOrder(page)
  await page.getByRole('button', { name: '交易设置', exact: true }).click()
  await expect(
    page.getByRole('switch', { name: '下单确认', exact: true }),
  ).not.toBeChecked()
  await expect(
    page.getByRole('switch', { name: '平仓确认', exact: true }),
  ).toBeChecked()
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: '市价', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '市价平仓', exact: true })
  await dialog.getByLabel('数量（BTC）', { exact: true }).fill('0.0005')
  await dialog.getByRole('checkbox', { name: '不再显示此消息' }).check()
  await dialog.getByRole('button', { name: '市价平仓', exact: true }).click()
  await expect(
    page.getByRole('cell', { name: '0.0005', exact: true }),
  ).toBeVisible()
  await page.getByRole('button', { name: '市价', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByText('暂无记录', { exact: true })).toBeVisible()
  expect(exchange.writes).toHaveLength(3)
  await page.getByRole('button', { name: '交易设置', exact: true }).click()
  await page.getByRole('switch', { name: '下单确认', exact: true }).check()
  await page.getByRole('switch', { name: '平仓确认', exact: true }).check()
  await page.keyboard.press('Escape')
  await page.reload()
  await page.getByRole('button', { name: '交易设置', exact: true }).click()
  await expect(
    page.getByRole('switch', { name: '下单确认', exact: true }),
  ).toBeChecked()
  await expect(
    page.getByRole('switch', { name: '平仓确认', exact: true }),
  ).toBeChecked()
  expect(
    await page.evaluate(() => [
      localStorage.getItem('hl-skip-order-confirm'),
      localStorage.getItem('hl-skip-close-confirm'),
    ]),
  ).toEqual(['false', 'false'])
})

test('订单确认按真实市价意图显示方向和币种，只有明确的交易按钮，关闭不发单', async ({
  page,
}) => {
  const exchange = await mockExchange(page)
  await ready(page)
  await page.getByRole('tab', { name: '市价单', exact: true }).click()
  await page.getByLabel('数量（BTC）', { exact: true }).fill('0.00192')
  await page.getByRole('button', { name: '下单', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '确认订单', exact: true })
  await expect(dialog.getByText('多头', { exact: true })).toBeVisible()
  await expect(dialog.getByText('0.00192 BTC', { exact: true })).toBeVisible()
  await expect(dialog.getByText('市价', { exact: true })).toBeVisible()
  await expect(dialog.getByText('预估强平价格', { exact: true })).toBeVisible()
  await expect(dialog.getByText('N/A', { exact: true })).toBeVisible()
  await expect(dialog.getByText(/无需支付燃气费/)).toBeVisible()
  await expect(
    dialog.getByRole('button', { name: '返回', exact: true }),
  ).toHaveCount(0)
  await expect(
    dialog.getByRole('button', { name: '确认提交', exact: true }),
  ).toHaveCount(0)
  await expect(
    dialog.getByRole('button', { name: '买入 / 做多', exact: true }),
  ).toBeVisible()
  await expect(dialog).toHaveCSS('opacity', '1')
  await page.screenshot({
    path: 'output-tdd/playwright/order-confirmation/market-buy.png',
    animations: 'disabled',
  })
  await dialog.getByRole('button', { name: '关闭', exact: true }).click()
  expect(exchange.writes).toHaveLength(0)
})

test('下单提交中、成功与提示关闭均不改变交易面板布局', async ({ page }) => {
  const { writes } = await mockExchange(page)
  await page.setViewportSize({ width: 1440, height: 900 })
  await ready(page)
  const notices = page.getByRole('region', { name: '全局通知' })
  await notices.getByRole('button', { name: '关闭提示' }).click()
  await page.getByLabel('数量（BTC）', { exact: true }).fill('0.001')
  const layout = () =>
    page.evaluate(() => ({
      panels: Array.from(
        document.querySelectorAll(
          '[aria-label="行情图表"], [aria-label="订单簿"], [aria-label="下单面板"], [aria-label="交易记录"], [aria-label="账户概览"]',
        ),
      ).map((element) => element.getBoundingClientRect().toJSON()),
      width: document.documentElement.scrollWidth,
      height: document.documentElement.scrollHeight,
    }))
  const before = await layout()
  const request = Promise.withResolvers<void>()
  const response = Promise.withResolvers<void>()
  await page.route('**/exchange', async (route) => {
    if (route.request().postDataJSON()?.action?.type === 'order') {
      request.resolve()
      await response.promise
    }
    await route.fallback()
  })
  await page.getByRole('button', { name: '下单', exact: true }).click()
  await confirmOrder(page)
  try {
    await request.promise
    await expect(notices.locator('[data-feedback="loading"]')).toBeVisible()
    expect(await layout()).toEqual(before)
    await expect(
      page.getByRole('button', { name: '查询未确认订单' }),
    ).toHaveCount(0)
  } finally {
    response.resolve()
  }
  await expect(notices.locator('[data-feedback="success"]')).toContainText(
    '已挂单',
  )
  expect(await layout()).toEqual(before)
  await notices.getByRole('button', { name: '关闭提示' }).click()
  await expect(notices).toHaveCount(0)
  expect(await layout()).toEqual(before)
  expect(writes).toHaveLength(1)
})

test('全局提示悬浮展示成功结果，不挤动交易布局', async ({ page }) => {
  await mockExchange(page)
  await ready(page)
  const notices = page.getByRole('region', { name: '全局通知' })
  await expect(notices).toContainText('钱包连接完成')
  await expect(notices.locator('[data-feedback="success"]')).toBeVisible()
  const chart = page.getByRole('region', { name: '行情图表', exact: true })
  const before = await chart.boundingBox()
  await notices.getByRole('button', { name: '关闭提示' }).click()
  await expect(notices).toHaveCount(0)
  expect(await chart.boundingBox()).toEqual(before)
})

test('钱包连接等待原生权限确认，拒绝可重试，成功后衔接交易签名，不自动下单', async ({
  page,
}) => {
  const exchange = await mockExchange(page)
  await page.goto('/')
  await page.evaluate(() => {
    const wallet = window.ethereum
    if (!wallet) throw new Error('Missing mock wallet')
    const request = wallet.request.bind(wallet) as (params: {
      method: string
      params?: unknown
    }) => Promise<unknown>
    Object.defineProperty(wallet, 'request', {
      configurable: true,
      value: async (params: Parameters<typeof request>[0]) => {
        if (params.method !== 'wallet_requestPermissions')
          return request(params)
        sessionStorage.setItem(
          'test-connect-requests',
          String(
            Number(sessionStorage.getItem('test-connect-requests') ?? 0) + 1,
          ),
        )
        return new Promise((resolve, reject) => {
          window.addEventListener(
            'test-wallet-connect-reply',
            (event) => {
              if ((event as CustomEvent).detail === 'reject')
                reject({ code: 4001, message: 'User rejected connection' })
              else resolve([{ parentCapability: 'eth_accounts' }])
            },
            { once: true },
          )
        })
      },
    })
  })
  await page.getByRole('button', { name: '连接钱包', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '连接', exact: true })
  await dialog.getByRole('button', { name: '浏览器钱包 连接 →' }).click()
  await expect(dialog.getByRole('status')).toContainText(
    '请在浏览器钱包中确认连接',
  )
  await expect(
    dialog.getByText('连接将请求账户访问与交易签名；不会自动下单或转移资金。', {
      exact: true,
    }),
  ).toHaveCount(0)
  await expect(
    dialog.getByRole('button', { name: /浏览器钱包.*等待/ }),
  ).toBeDisabled()
  expect(
    await page.evaluate(() => sessionStorage.getItem('test-connect-requests')),
  ).toBe('1')
  expect(exchange.agentRegistrations()).toBe(0)
  expect(exchange.writes).toHaveLength(0)
  await expect(dialog).toHaveCSS('opacity', '1')
  await page.screenshot({
    path: 'output-tdd/playwright/order-confirmation/wallet-permission.png',
    animations: 'disabled',
  })
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent('test-wallet-connect-reply', { detail: 'reject' }),
    ),
  )
  await expect(dialog.getByRole('alert')).toContainText('已取消连接')
  await expect(
    page.locator('header').getByRole('button', { name: '启用交易' }),
  ).toHaveCount(0)
  await dialog.getByRole('button', { name: '浏览器钱包 连接 →' }).click()
  await expect(dialog.getByRole('alert')).toHaveCount(0)
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent('test-wallet-connect-reply', { detail: 'accept' }),
    ),
  )
  await expect(dialog).toHaveCount(0)
  await expect(
    page.getByRole('button', { name: '下单', exact: true }),
  ).toBeEnabled()
  expect(
    await page.evaluate(() => sessionStorage.getItem('test-connect-requests')),
  ).toBe('2')
  expect(
    await page.evaluate(() => sessionStorage.getItem('mock-wallet-signs')),
  ).toBe('1')
  expect(exchange.agentRegistrations()).toBe(1)
  expect(exchange.writes).toHaveLength(0)
})

test('已有交易登记但本地密钥丢失不算新账户，也不能仅凭历史代签', async ({
  page,
}) => {
  const exchange = await mockExchange(page)
  await ready(page)
  expect(exchange.agentRegistrations()).toBe(1)
  await page.evaluate(() =>
    sessionStorage.removeItem('hl-testnet-trading-connection-v1'),
  )
  await page.reload()
  await page.getByRole('button', { name: '连接钱包', exact: true }).click()
  await page.getByRole('button', { name: '浏览器钱包 连接 →' }).click()
  await expect(
    page.getByRole('button', { name: '下单', exact: true }),
  ).toBeEnabled()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(exchange.agentRegistrations()).toBe(2)
  expect(
    await page.evaluate(() => sessionStorage.getItem('mock-wallet-signs')),
  ).toBe('2')
  expect(exchange.writes).toHaveLength(0)
})

test('钱包已有权限请求时提示处理原生窗口，不自动重复连接', async ({ page }) => {
  const exchange = await mockExchange(page)
  await page.goto('/')
  await page.evaluate(() => {
    const wallet = window.ethereum
    if (!wallet) throw new Error('Missing mock wallet')
    const request = wallet.request.bind(wallet) as (params: {
      method: string
      params?: unknown
    }) => Promise<unknown>
    Object.defineProperty(wallet, 'request', {
      configurable: true,
      value: async (params: Parameters<typeof request>[0]) => {
        if (params.method !== 'wallet_requestPermissions')
          return request(params)
        throw { code: -32002, message: 'Request already pending' }
      },
    })
  })
  await page.getByRole('button', { name: '连接钱包', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '连接', exact: true })
  await dialog.getByRole('button', { name: '浏览器钱包 连接 →' }).click()
  await expect(dialog.getByRole('alert')).toContainText(
    '钱包中已有待处理的连接请求',
  )
  await expect(
    dialog.getByRole('button', { name: '浏览器钱包 连接 →' }),
  ).toBeEnabled()
  expect(exchange.agentRegistrations()).toBe(0)
  expect(exchange.writes).toHaveLength(0)
})

test('盘口渲染异常隔离在模块内，恢复不重发任何交易', async ({ page }) => {
  const { writes } = await mockExchange(page)
  await page.addInitScript(() => {
    const original = Number.prototype.toLocaleString
    Number.prototype.toLocaleString = function (locales, options) {
      if (
        options?.maximumFractionDigits != null &&
        options.minimumFractionDigits == null
      )
        throw new Error('Injected number formatting failure')
      return original.call(this, locales, options)
    }
    window.addEventListener('restore-number-format', () => {
      Number.prototype.toLocaleString = original
    })
  })
  await page.goto('/')
  await expect(
    page.getByRole('heading', { name: '订单簿暂时无法显示' }),
  ).toBeVisible()
  await expect(
    page.getByRole('region', { name: '行情图表', exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole('region', { name: '下单面板', exact: true }),
  ).toBeVisible()
  await page.evaluate(() =>
    window.dispatchEvent(new Event('restore-number-format')),
  )
  await page.getByRole('button', { name: '恢复订单簿' }).click()
  await expect(
    page.getByRole('heading', { name: '订单簿暂时无法显示' }),
  ).toHaveCount(0)
  await expect(
    page.getByRole('region', { name: '订单簿', exact: true }),
  ).toBeVisible()
  expect(writes).toHaveLength(0)
})

test('断网与未捕获异常提示去重并限制数量，不暴露异常原文', async ({ page }) => {
  await mockExchange(page)
  await ready(page)
  const notices = page.getByRole('region', { name: '全局通知' })
  await notices.getByRole('button', { name: '关闭提示' }).click()
  const chart = page.getByRole('region', { name: '行情图表', exact: true })
  const before = await chart.boundingBox()
  await page.evaluate(() => {
    for (let i = 0; i < 20; i++) window.dispatchEvent(new Event('offline'))
  })
  await expect(notices.locator('output')).toHaveCount(1)
  await expect(notices.locator('[data-feedback="warning"]')).toContainText(
    '网络已断开',
  )
  await page.evaluate(() => window.dispatchEvent(new Event('online')))
  await expect(notices.locator('output')).toHaveCount(1)
  await expect(notices.locator('[data-feedback="info"]')).toContainText(
    '网络连接已恢复',
  )
  await page.evaluate(() => {
    for (let i = 0; i < 20; i++)
      window.dispatchEvent(
        new PromiseRejectionEvent('unhandledrejection', {
          promise: Promise.resolve(),
          reason: 'sensitive-payload-do-not-display',
        }),
      )
  })
  await expect(notices.locator('output')).toHaveCount(2)
  await expect(notices.locator('[data-feedback="error"]')).toContainText(
    '未预期异常',
  )
  await expect(notices).not.toContainText('sensitive-payload')
  await page.route('**/info', async (route) => {
    if (route.request().postDataJSON()?.type === 'clearinghouseState')
      await route.fulfill({ status: 503, body: 'Service unavailable' })
    else await route.fallback()
  })
  await expect(notices).toContainText('账户查询失败', { timeout: 20000 })
  await expect(notices.locator('output')).toHaveCount(3)
  expect(await chart.boundingBox()).toEqual(before)
  await page.screenshot({
    path: 'output-tdd/playwright/global-feedback/notifications.png',
  })
})

test('不存在的路由可返回交易页', async ({ page }) => {
  await mockExchange(page)
  await page.goto('/missing-feedback-page')
  await expect(page.getByRole('heading', { name: '页面不存在' })).toBeVisible()
  await expect(
    page.getByRole('link', { name: '连接手机 App', exact: true }),
  ).toHaveAttribute('href', '/connect')
  await page.screenshot({
    path: 'output-tdd/playwright/connect-404/desktop.png',
  })
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.getByRole('link', { name: '返回交易页' })).toBeInViewport()
  await expect(
    page.getByRole('link', { name: '连接手机 App', exact: true }),
  ).toBeInViewport()
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true)
  await page.screenshot({
    path: 'output-tdd/playwright/connect-404/mobile.png',
  })
  await page.getByRole('link', { name: '返回交易页' }).click()
  await expect(
    page.getByRole('region', { name: '行情图表', exact: true }),
  ).toBeVisible()
})

test('下单比例提示在暗色主题中保持清晰可读', async ({ page }) => {
  const { writes } = await mockExchange(page)
  await ready(page)
  const panel = page.getByRole('region', { name: '下单面板', exact: true })
  const group = panel.getByRole('group', { name: '下单比例', exact: true })
  const thumb = group.locator('[data-slot="thumb"]')
  await thumb.hover()
  const tooltip = page.getByRole('tooltip')
  await expect(tooltip).toBeVisible()
  await expect(tooltip).toContainText('%')
  const track = await group.locator('[data-slot="track"]').boundingBox()
  if (!track) throw new Error('下单比例轨道不可见')
  await page.mouse.down()
  let previousPercent = 0
  for (const percent of [37, 65]) {
    await page.mouse.move(
      track.x + (track.width * percent) / 100,
      track.y + track.height / 2,
      { steps: 8 },
    )
    await expect(thumb).toHaveAttribute('data-dragging', 'true')
    await expect(tooltip).toBeVisible()
    const value = Number(
      await group.getByRole('slider', { name: '下单比例' }).inputValue(),
    )
    expect(value).toBeGreaterThan(previousPercent + 10)
    await expect(tooltip).toHaveText(`${Math.round(value)}%`)
    previousPercent = value
  }
  const colors = await tooltip.evaluate((element) => {
    const style = getComputedStyle(
      element.querySelector('[data-slot="content"]') ?? element,
    )
    return { color: style.color, background: style.backgroundColor }
  })
  expect(colors).toEqual({
    color: 'rgb(255, 255, 255)',
    background: 'rgb(34, 35, 43)',
  })
  await page.screenshot({
    path: 'output-tdd/playwright/slider-percent/dragging.png',
  })
  await page.mouse.up()
  expect(writes).toHaveLength(0)
})

test('红色卖出按钮与方向选中文字为白色', async ({ page }) => {
  const { writes } = await mockExchange(page)
  await ready(page)
  const panel = page.getByRole('region', { name: '下单面板', exact: true })
  const sell = panel.getByRole('tab', { name: '卖出 / 做空', exact: true })
  await sell.click()
  await expect(sell.locator('[data-slot="tabContent"]')).toHaveCSS(
    'color',
    'rgb(255, 255, 255)',
  )
  const submit = panel.getByRole('button', { name: '下单', exact: true })
  await expect(submit).toHaveCSS('color', 'rgb(255, 255, 255)')
  await expect(submit).toHaveCSS('background-color', 'rgb(235, 71, 71)')
  await panel
    .getByRole('textbox', { name: '数量（BTC）', exact: true })
    .fill('0.001')
  await submit.click()
  await expect(
    page.getByRole('dialog').getByRole('button', { name: /^卖出/ }),
  ).toHaveCSS('color', 'rgb(255, 255, 255)')
  await page
    .getByRole('dialog')
    .getByRole('button', { name: '关闭', exact: true })
    .click()
  await panel.getByRole('tab', { name: '买入 / 做多', exact: true }).click()
  await expect(submit).toHaveCSS('color', 'rgb(255, 255, 255)')
  expect(writes).toHaveLength(0)
})

for (const mode of ['normal', 'reject'] as const) {
  test(`公共提示持续显示且提交结果不跳位：${mode}`, async ({
    page,
  }, testInfo) => {
    const { writes } = await mockExchange(page, mode)
    await ready(page)
    const notices = page.getByRole('region', { name: '全局通知' })
    await notices.getByRole('button', { name: '关闭提示' }).click()
    const response = Promise.withResolvers<void>()
    await page.route('**/exchange', async (route) => {
      if (route.request().postDataJSON()?.action?.type === 'order')
        await response.promise
      await route.fallback()
    })
    await page.getByLabel('数量（BTC）', { exact: true }).fill('0.001')
    await page.getByRole('button', { name: '下单', exact: true }).click()
    await confirmOrder(page)
    await expect(notices.locator('[data-feedback="loading"]')).toBeVisible()
    const initial = await notices.boundingBox()
    const observation = page.evaluate(async () => {
      const frames: {
        tones: string[]
        top: number[]
        opacity: string[]
        width: number[]
      }[] = []
      const started = performance.now()
      return new Promise<typeof frames>((resolve) => {
        const frame = () => {
          const items = Array.from(
            document.querySelectorAll('[data-feedback]'),
          ).filter(
            (item) => item.closest('[data-toast]')?.getClientRects().length,
          )
          frames.push({
            tones: items.map(
              (item) => item.getAttribute('data-feedback') ?? '',
            ),
            top: items.map(
              (item) =>
                item.closest('[data-toast]')?.getBoundingClientRect().top ?? -1,
            ),
            opacity: items.map(
              (item) =>
                getComputedStyle(item.closest('[data-toast]') ?? item).opacity,
            ),
            width: items.map(
              (item) =>
                item.closest('[data-toast]')?.getBoundingClientRect().width ??
                -1,
            ),
          })
          if (performance.now() - started < 1200) requestAnimationFrame(frame)
          else resolve(frames)
        }
        requestAnimationFrame(frame)
      })
    })
    response.resolve()
    const frames = await observation
    await testInfo.attach('toast-frames', {
      body: JSON.stringify({ initial, frames }),
      contentType: 'application/json',
    })
    expect(frames.length).toBeGreaterThan(5)
    expect(frames.every((frame) => frame.tones.length === 1)).toBe(true)
    const result = frames.filter((frame) =>
      frame.tones.includes(mode === 'normal' ? 'success' : 'error'),
    )
    expect(result.length).toBeGreaterThan(0)
    expect(new Set(result.flatMap((frame) => frame.top)).size).toBe(1)
    expect(result.every((frame) => frame.opacity[0] === '1')).toBe(true)
    expect(writes).toHaveLength(1)
  })
}

test('多钱包全局注入冲突不影响独立 provider 连接，应用错误仍然提示', async ({
  page,
}) => {
  await mockExchange(page)
  await mockFunding(page)
  await page.addInitScript(() => {
    const provider = window.ethereum
    window.addEventListener('eip6963:requestProvider', () =>
      window.dispatchEvent(
        new CustomEvent('eip6963:announceProvider', {
          detail: {
            info: {
              uuid: 'metamask-safe',
              name: 'MetaMask',
              rdns: 'io.metamask',
            },
            provider,
          },
        }),
      ),
    )
    Object.defineProperty(window, 'ethereum', {
      get() {
        throw new TypeError('Cannot redefine property: ethereum')
      },
    })
  })
  await page.goto('/')
  await page.getByRole('button', { name: '连接钱包', exact: true }).click()
  await page.getByRole('button', { name: 'MetaMask 连接 →' }).click()
  await expect(
    page.locator('header').getByRole('button', { name: /0x1111/ }),
  ).toBeVisible()
  await page.evaluate(() =>
    window.dispatchEvent(
      new ErrorEvent('error', {
        message: 'Cannot redefine property: ethereum',
        filename: 'chrome-extension://wallet/evmAsk.js',
        error: new TypeError('Cannot redefine property: ethereum'),
      }),
    ),
  )
  await expect(
    page.getByText('页面发生未预期异常。', { exact: false }),
  ).toHaveCount(0)
  await page.evaluate(() =>
    window.dispatchEvent(
      new ErrorEvent('error', {
        message: 'Application failure',
        filename: `${location.origin}/app.js`,
        error: new Error('Application failure'),
      }),
    ),
  )
  await expect(
    page.getByText('页面发生未预期异常。', { exact: false }),
  ).toBeVisible()
})

test('语言和动态元数据跟随币对，切换不刷新、不丢失下单输入', async ({
  page,
}) => {
  await mockExchange(page)
  await page.goto('/')
  await expect(page.getByRole('button', { name: '交易市场' })).toContainText(
    'BTC',
  )
  await expect(page).toHaveTitle(/BTC \/ USDC.*永续.*fameex-testnet$/)
  await expect(page.getByRole('heading', { level: 1 })).toContainText('testnet')
  await expect(page.locator('meta[name="application-name"]')).toHaveAttribute(
    'content',
    'fameex-testnet',
  )
  await expect(page.locator('meta[property="og:site_name"]')).toHaveAttribute(
    'content',
    'fameex-testnet',
  )
  const icon = page.locator('head link[rel="icon"][type="image/png"]')
  await expect(icon).toHaveAttribute('sizes', '48x48')
  const iconPath = await icon.getAttribute('href')
  expect(iconPath).toMatch(/^\/icon\.png/)
  const iconResponse = await page.request.get(iconPath ?? '')
  expect(iconResponse.status()).toBe(200)
  expect((await iconResponse.body()).subarray(1, 4).toString()).toBe('PNG')
  await expect(
    page.locator('head link[rel="icon"][href^="/favicon.ico"]'),
  ).toHaveCount(1)
  await expect(
    page.locator('head link[rel="apple-touch-icon"]'),
  ).toHaveAttribute('sizes', '180x180')
  await expect(page.getByRole('navigation', { name: '交易导航' })).toHaveCount(
    0,
  )
  await page.getByLabel('数量（BTC）', { exact: true }).fill('0.123')
  await page.getByRole('button', { name: '语言', exact: true }).click()
  await page.getByRole('menuitemradio', { name: 'English' }).click()
  await expect(
    page.getByRole('tab', { name: 'Order book', exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Connect wallet', exact: true }),
  ).toBeVisible()
  await expect(page.getByLabel('Size (BTC)', { exact: true })).toHaveValue(
    '0.123',
  )
  await expect(page).toHaveTitle(/BTC \/ USDC.*Perpetual.*fameex-testnet$/)
  await page.setViewportSize({ width: 375, height: 812 })
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  expect(
    await page
      .locator('header')
      .evaluate((el) => el.scrollWidth <= el.clientWidth),
  ).toBe(true)
  await expect(
    page.getByRole('link', { name: 'Faucet', exact: true }),
  ).toBeInViewport()
  await page.setViewportSize({ width: 1280, height: 720 })
  expect(
    await page.locator('meta[property="og:title"]').getAttribute('content'),
  ).toBe(await page.title())
  expect(await page.locator('html').getAttribute('lang')).toBe('en-US')
  expect(
    await page.evaluate(
      () => performance.getEntriesByType('navigation').length,
    ),
  ).toBe(1)
  await page
    .getByRole('button', { name: 'Trading market', exact: true })
    .click()
  await page.getByRole('option', { name: 'ETH / USDC', exact: true }).click()
  await expect(page).toHaveTitle(/ETH \/ USDC.*Perpetual/)
  await expect(page.locator('meta[name="description"]')).toHaveAttribute(
    'content',
    /ETH \/ USDC/,
  )
  expect(
    await page.evaluate(
      () => performance.getEntriesByType('navigation').length,
    ),
  ).toBe(1)
  await page.reload()
  await expect(
    page.getByRole('button', { name: 'Connect wallet', exact: true }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Language', exact: true }).click()
  await page.getByRole('menuitemradio', { name: '简体中文' }).click()
  await expect(
    page.getByRole('tab', { name: '订单簿', exact: true }),
  ).toBeVisible()
})

test('快速盘口独立于深档快照刷新，仓位通过账户推送更新', async ({ page }) => {
  const exchange = await mockExchange(page)
  await ready(page)
  await expect(
    page.getByRole('button', { name: '买盘 69999 档位详情', exact: true }),
  ).toBeVisible()
  exchange.pushFastBook(69998)
  await expect(
    page.getByRole('button', { name: '买盘 69997 档位详情', exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: '买盘 69999 档位详情', exact: true }),
  ).toHaveCount(0)
  exchange.setPosition(0.002)
  exchange.pushAccount()
  const positions = page.getByRole('table', { name: '仓位', exact: true })
  await expect(
    positions.getByRole('cell', { name: '0.002', exact: true }),
  ).toBeVisible()
  await expect(
    positions.getByRole('columnheader', { name: '仓位价值' }),
  ).toBeVisible()
  await expect(
    positions.getByRole('columnheader', { name: '盈亏 / 收益率' }),
  ).toBeVisible()
  await positions.getByRole('button', { name: '限价', exact: true }).click()
  await page.getByLabel('平仓价格', { exact: true }).fill('71000')
  await page
    .getByRole('dialog')
    .getByLabel('数量（BTC）', { exact: true })
    .fill('0.001')
  await expect(
    page.getByRole('dialog').getByLabel('数量（BTC）', { exact: true }),
  ).toHaveValue('0.001')
  await page
    .getByRole('dialog')
    .getByRole('button', { name: '确认', exact: true })
    .click()
  await expect
    .poll(() => exchange.writes.at(-1)?.orders?.[0])
    .toMatchObject({
      r: true,
      s: '0.001',
      p: '71000',
      t: { limit: { tif: 'Gtc' } },
    })
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(
    positions.getByRole('button', { name: '市价', exact: true }),
  ).toBeEnabled()
  await positions.getByRole('button', { name: '市价', exact: true }).click()
  await expect(
    page.getByRole('button', { name: '市价平仓', exact: true }),
  ).toBeVisible()
  // 弹窗打开后再模拟远端平仓，避免前一单的账户刷新提前移除仓位行。
  exchange.setPosition(0)
  await page.getByRole('button', { name: '市价平仓', exact: true }).click()
  await expect(
    page.getByText('仓位已关闭，请刷新账户', { exact: true }),
  ).toBeVisible()
  expect(exchange.writes.filter((item) => item.type === 'order')).toHaveLength(
    1,
  )
})

test('刷新静默恢复连接和历史划转，主动划转只提示一次', async ({ page }) => {
  const exchange = await mockExchange(page)
  await mockFunding(page)
  await ready(page)
  await page.evaluate((account) => {
    localStorage.setItem(
      `hl-testnet-funding:${account}`,
      JSON.stringify({
        account,
        kind: 'transfer',
        amount: '12',
        toPerp: false,
        at: Date.now() - 60000,
        status: 'confirmed',
      }),
    )
  }, address)
  await page.reload()
  await expect(
    page.getByRole('button', { name: '下单', exact: true }),
  ).toBeEnabled()
  await page
    .locator('#account-panel')
    .getByRole('button', { name: '划转', exact: true })
    .click()
  const dialog = page.getByRole('dialog')
  await expect(
    dialog.getByText('USDC 划转 · 12 USDC', { exact: true }),
  ).toBeVisible()
  expect(await page.locator('[data-feedback="success"]').count()).toBe(0)
  expect(exchange.writes).toHaveLength(0)
  expect(exchange.agentRegistrations()).toBe(1)
  await dialog.getByLabel('划转金额（USDC）').fill('10')
  await dialog.getByRole('button', { name: '确认划转' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.locator('[data-feedback="success"]')).toHaveCount(1)
  await expect(page.locator('[data-feedback="success"]')).toHaveText(
    'USDC 划转已确认。',
  )
  expect(exchange.writes).toHaveLength(1)
  await page.reload()
  await expect(
    page.getByRole('button', { name: '下单', exact: true }),
  ).toBeEnabled()
  await page
    .locator('#account-panel')
    .getByRole('button', { name: '划转', exact: true })
    .click()
  await expect(
    dialog.getByText('USDC 划转 · 10 USDC', { exact: true }),
  ).toBeVisible()
  expect(await page.locator('[data-feedback="success"]').count()).toBe(0)
  expect(exchange.writes).toHaveLength(1)
})

test('手动连接只提示本次连接并自动关闭，不重播历史资金成功', async ({
  page,
}) => {
  const exchange = await mockExchange(page)
  await mockFunding(page)
  await page.addInitScript((account) => {
    localStorage.setItem(
      `hl-testnet-funding:${account}`,
      JSON.stringify({
        account,
        kind: 'transfer',
        amount: '12',
        toPerp: false,
        at: Date.now() - 60000,
        status: 'confirmed',
      }),
    )
  }, address)
  await page.goto('/')
  await page.getByRole('button', { name: '连接钱包', exact: true }).click()
  await page
    .getByRole('dialog')
    .getByRole('button', { name: '浏览器钱包 连接 →' })
    .click()
  const success = page.locator('[data-feedback="success"]')
  await expect(success).toHaveCount(1)
  await expect(success).toHaveText('钱包连接完成，可以直接交易。')
  await expect(success).toHaveCount(0, { timeout: 12000 })
  expect(exchange.agentRegistrations()).toBe(1)
  expect(exchange.writes).toHaveLength(0)
})

test('止盈止损价格与收益双向联动，随价格方向数量更新并拦截无效目标', async ({
  page,
}) => {
  const exchange = await mockExchange(page)
  await ready(page)
  await page.getByLabel('价格（USDC）', { exact: true }).fill('70000')
  await page.getByLabel('数量（BTC）', { exact: true }).fill('0.001')
  await page.getByRole('checkbox', { name: '止盈 / 止损', exact: true }).check()
  const tp = page.getByLabel('止盈价格', { exact: true })
  const profit = page.getByRole('textbox', { name: '收益', exact: true })
  await profit.fill('3')
  await expect(tp).toHaveValue('71050')
  await page.getByLabel('价格（USDC）', { exact: true }).fill('72000')
  await expect(tp).toHaveValue('73080')
  await page.getByRole('tab', { name: '卖出 / 做空', exact: true }).click()
  await expect(tp).toHaveValue('70920')
  await tp.fill('70000')
  await expect(profit).toHaveValue('5.5556')
  await page.getByRole('button', { name: '收益单位', exact: true }).click()
  await page.getByRole('menuitemradio', { name: 'USDC', exact: true }).click()
  await expect(page.getByLabel('数量（BTC）', { exact: true })).toHaveValue(
    '0.00097',
  )
  await expect(profit).toHaveValue('1.94')
  await page.getByLabel('数量（BTC）', { exact: true }).fill('0.001')
  await expect(profit).toHaveValue('2')
  await profit.fill('3')
  await expect(tp).toHaveValue('69000')
  await page.getByLabel('数量（BTC）', { exact: true }).fill('0.002')
  await expect(tp).toHaveValue('70500')
  await profit.fill('999999')
  await expect(
    page.getByRole('button', { name: '下单', exact: true }),
  ).toBeDisabled()
  await profit.fill('3')
  await expect(
    page.getByRole('button', { name: '下单', exact: true }),
  ).toBeEnabled()
  exchange.pushMarket('BTC', 72000)
  await expect(
    page.getByRole('button', { name: '买盘 71999 档位详情' }),
  ).toBeVisible()
  await page.getByRole('button', { name: '下单', exact: true }).click()
  await confirmOrder(page)
  await expect
    .poll(() => exchange.writes.at(-1)?.orders?.[1])
    .toMatchObject({
      b: true,
      r: true,
      s: '0.002',
      t: { trigger: { triggerPx: '70500', tpsl: 'tp', isMarket: true } },
    })
})

test('仓位移动止损提交原生请求，反手使用双倍数量且不只减仓', async ({
  page,
}) => {
  const exchange = await mockExchange(page)
  exchange.setPosition(0.002)
  await ready(page)
  const positions = page.getByRole('table', { name: '仓位', exact: true })
  await positions.getByRole('button', { name: '移动止损', exact: true }).click()
  let dialog = page.getByRole('dialog', { name: '设置移动止损', exact: true })
  const distanceInput = dialog.getByLabel('回撤距离', { exact: true })
  expect(
    await distanceInput.evaluate(
      (element) =>
        !!element
          .closest('[data-slot="input-wrapper"]')
          ?.querySelector('[aria-label="回撤单位"]'),
    ),
  ).toBe(true)
  await dialog.getByRole('button', { name: /回撤单位/ }).click()
  await expect(
    page.getByRole('menuitemradio', { name: 'USDC', exact: true }),
  ).toBeVisible()
  await page.mouse.move(0, 0)
  await expect(page.getByRole('menu')).toHaveCSS('opacity', '1')
  await page.screenshot({
    path: 'output-tdd/playwright/wallet-permissions/trailing-unit.png',
  })
  await page.getByRole('menuitemradio', { name: 'USDC', exact: true }).click()
  await expect(dialog.getByRole('button', { name: /回撤单位/ })).toContainText(
    'USDC',
  )
  await dialog.getByRole('button', { name: '5%', exact: true }).click()
  await dialog.getByLabel('回撤距离', { exact: true }).fill('5')
  await dialog.getByRole('button', { name: '确认', exact: true }).click()
  await expect
    .poll(() => exchange.writes.at(-1))
    .toMatchObject({
      type: 'trailingStop',
      sz: '0.002',
      reduceOnly: true,
      isBuy: false,
      retracement: { pct: '5%' },
    })
  await expect(dialog).toHaveCount(0)
  await positions.getByRole('button', { name: '反手', exact: true }).click()
  dialog = page.getByRole('dialog', { name: '反向仓位' })
  await expect(dialog.getByText('0.004 BTC', { exact: true })).toBeVisible()
  await expect(dialog.getByText('多头 → 空头', { exact: true })).toHaveCSS(
    'color',
    'rgb(235, 71, 71)',
  )
  await expect(dialog.getByText('0.004 BTC', { exact: true })).toHaveCSS(
    'color',
    'rgb(235, 71, 71)',
  )
  await expect(
    dialog.getByRole('button', { name: '卖出 / 做空', exact: true }),
  ).toHaveCSS('background-color', 'rgb(235, 71, 71)')
  await page.screenshot({
    path: 'output-tdd/playwright/wallet-permissions/reverse-short.png',
    animations: 'disabled',
  })
  await dialog.getByRole('button', { name: '卖出 / 做空', exact: true }).click()
  await expect
    .poll(() => exchange.writes.at(-1)?.orders?.[0])
    .toMatchObject({
      b: false,
      r: false,
      s: '0.004',
      t: { limit: { tif: 'Ioc' } },
    })
  await expect(positions.getByText('空头', { exact: true })).toBeVisible()
  await positions.getByRole('button', { name: '反手', exact: true }).click()
  dialog = page.getByRole('dialog', { name: '反向仓位' })
  await expect(dialog.getByText('空头 → 多头', { exact: true })).toHaveCSS(
    'color',
    'rgb(20, 184, 129)',
  )
  await expect(dialog.getByText('0.004 BTC', { exact: true })).toHaveCSS(
    'color',
    'rgb(20, 184, 129)',
  )
  await expect(
    dialog.getByRole('button', { name: '买入 / 做多', exact: true }),
  ).toHaveCSS('background-color', 'rgb(20, 184, 129)')
})

test('仓位止盈止损支持固定数量限价保护，一次确认后提交', async ({ page }) => {
  const exchange = await mockExchange(page)
  exchange.setPosition(0.002)
  await ready(page)
  await page.getByRole('button', { name: '止盈 / 止损', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('止盈价格', { exact: true }).fill('72000')
  await dialog.getByRole('checkbox', { name: '配置金额' }).check()
  await dialog.getByLabel('数量（BTC）', { exact: true }).fill('0.001')
  await dialog.getByRole('checkbox', { name: '限价保护' }).check()
  await dialog.getByLabel('止盈限价', { exact: true }).fill('71900')
  await dialog.getByRole('button', { name: '确认', exact: true }).click()
  await expect
    .poll(() => exchange.writes.at(-1))
    .toMatchObject({
      grouping: 'positionTpsl',
      orders: [
        {
          r: true,
          s: '0.001',
          p: '71900',
          t: { trigger: { triggerPx: '72000', tpsl: 'tp', isMarket: false } },
        },
      ],
    })
  await expect(dialog).toHaveCount(0)
})

test('逐仓保证金追加与移除校验额度并提交有符号微美元，全仓不显示入口', async ({
  page,
}) => {
  const exchange = await mockExchange(page)
  exchange.setPosition(0.002)
  await ready(page)
  await expect(
    page.getByRole('button', { name: 'BTC 调整逐仓保证金' }),
  ).toHaveCount(0)
  exchange.setIsolated(35)
  exchange.pushAccount()
  await page.getByRole('button', { name: 'BTC 调整逐仓保证金' }).click()
  let dialog = page.getByRole('dialog', { name: '调整逐仓保证金' })
  await dialog.getByLabel('保证金金额', { exact: true }).fill('10')
  await dialog.getByRole('button', { name: '确认', exact: true }).click()
  await expect
    .poll(() => exchange.writes.at(-1))
    .toMatchObject({
      type: 'updateIsolatedMargin',
      asset: 3,
      isBuy: true,
      ntli: 10000000,
    })
  await expect(dialog).toHaveCount(0)
  await page.getByRole('button', { name: 'BTC 调整逐仓保证金' }).click()
  dialog = page.getByRole('dialog', { name: '调整逐仓保证金' })
  await dialog
    .getByRole('button', { name: '保证金调整方向', exact: true })
    .click()
  await page.getByRole('menuitemradio', { name: '移除', exact: true }).click()
  await expect(dialog.getByText('31 USDC', { exact: true })).toBeVisible()
  await dialog.getByLabel('保证金金额', { exact: true }).fill('32')
  await expect(
    dialog.getByRole('button', { name: '确认', exact: true }),
  ).toBeDisabled()
  await dialog.getByLabel('保证金金额', { exact: true }).fill('1.001')
  await expect(
    dialog.getByRole('button', { name: '确认', exact: true }),
  ).toBeDisabled()
  await dialog.getByRole('button', { name: '最大', exact: true }).click()
  await expect(dialog.getByLabel('保证金金额', { exact: true })).toHaveValue(
    '31',
  )
  await dialog.getByRole('button', { name: '确认', exact: true }).click()
  await expect
    .poll(() => exchange.writes.at(-1))
    .toMatchObject({ type: 'updateIsolatedMargin', ntli: -31000000 })
})

test('交易说明支持悬浮与键盘聚焦，图表周期下拉仍可操作', async ({ page }) => {
  await mockExchange(page)
  await page.goto('/')
  await expect(page.getByText('实时连接', { exact: false })).toBeVisible()
  const label = page
    .locator('dfn')
    .filter({ hasText: /^标记价格$/ })
    .first()
  await page.mouse.move(1, 1)
  await label.hover()
  await expect(page.getByRole('tooltip')).toBeVisible()
  await page.mouse.move(1, 1)
  await page.keyboard.press('Tab')
  await label.focus()
  await expect(page.getByRole('tooltip')).toBeVisible()
  await page.getByRole('button', { name: '更多时间周期', exact: true }).click()
  await page
    .getByRole('dialog')
    .getByRole('button', { name: '30分', exact: true })
    .click()
  await expect(
    page.getByRole('button', { name: '30分', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true')
})

test('连接内完成交易会话：精简列表，一次连接后直接下单，不再启用交易', async ({
  page,
}) => {
  const exchange = await mockExchange(page)
  await page.goto('/')
  await page.getByRole('button', { name: '连接钱包', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '连接', exact: true })
  await expect(
    dialog.getByText('连接权限与保持连接', { exact: true }),
  ).toHaveCount(0)
  await expect(dialog.getByRole('checkbox')).toHaveCount(0)
  await dialog.getByRole('button', { name: '浏览器钱包 连接 →' }).click()
  await expect(
    page.getByRole('button', { name: '下单', exact: true }),
  ).toBeEnabled()
  await expect(
    page.getByRole('button', { name: '启用交易', exact: true }),
  ).toHaveCount(0)
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(exchange.agentRegistrations()).toBe(1)
  expect(exchange.writes).toHaveLength(0)
  await page.getByLabel('数量（BTC）', { exact: true }).fill('0.001')
  await page.getByRole('button', { name: '下单', exact: true }).click()
  await confirmOrder(page)
  await expect.poll(() => exchange.writes.length).toBe(1)
  expect(
    await page.evaluate(() => sessionStorage.getItem('mock-wallet-signs')),
  ).toBe('1')
})

test('连接签名返回前切换账户，旧授权结果不能保存或恢复交易能力', async ({
  page,
}) => {
  const exchange = await mockExchange(page)
  const response = Promise.withResolvers<void>()
  let approvals = 0
  await page.route(
    'https://api.hyperliquid-testnet.xyz/exchange',
    async (route) => {
      if (route.request().postDataJSON().action.type === 'approveAgent') {
        approvals++
        await response.promise
      }
      await route.fallback()
    },
  )
  await page.goto('/')
  await page.getByRole('button', { name: '连接钱包', exact: true }).click()
  await page.getByRole('button', { name: '浏览器钱包 连接 →' }).click()
  try {
    await expect.poll(() => approvals).toBe(1)
    await expect(
      page
        .getByRole('dialog')
        .getByRole('button', { name: '等待钱包确认…', exact: true }),
    ).toBeDisabled()
    await page.evaluate(() =>
      window.dispatchEvent(new Event('test-account-change')),
    )
  } finally {
    response.resolve()
  }
  await expect.poll(() => exchange.agentRegistrations()).toBe(1)
  await expect(
    page.getByRole('button', { name: '浏览器钱包 连接 →' }),
  ).toBeEnabled()
  await expect(
    page.getByRole('button', { name: '下单', exact: true }),
  ).toHaveCount(0)
  expect(
    await page.evaluate(() =>
      sessionStorage.getItem('hl-testnet-trading-connection-v1'),
    ),
  ).toBeNull()
  expect(exchange.writes).toHaveLength(0)
})

test('断开期间代理被撤销，重连必须重新授权且不能使用旧密钥发单', async ({
  page,
}) => {
  const exchange = await mockExchange(page)
  await ready(page)
  await page
    .locator('header')
    .getByRole('button', { name: /^0x[0-9a-f]{4}…[0-9a-f]{4}$/i })
    .click()
  await page.getByRole('button', { name: '断开钱包', exact: true }).click()
  exchange.revokeAgent()
  await page.getByRole('button', { name: '浏览器钱包 连接 →' }).click()
  await expect.poll(() => exchange.agentRegistrations()).toBe(2)
  await expect(
    page.getByRole('button', { name: '下单', exact: true }),
  ).toBeEnabled()
  expect(
    await page.evaluate(() => sessionStorage.getItem('mock-wallet-signs')),
  ).toBe('2')
  expect(exchange.writes).toHaveLength(0)
})

// 读取浏览器实际绘制的文字坐标，以真实鼠标操作 Canvas；不向产品增加测试接口。
async function recordChartText(page: Page) {
  await page.addInitScript(() => {
    type Texts = Map<
      HTMLCanvasElement,
      { text: string; x: number; y: number }[]
    >
    const windowWithText = window as typeof window & { chartText: Texts }
    windowWithText.chartText = new Map()
    const fill = CanvasRenderingContext2D.prototype.fillText
    const clear = CanvasRenderingContext2D.prototype.clearRect
    CanvasRenderingContext2D.prototype.clearRect = function (...args) {
      if (args[0] === 0 && args[1] === 0)
        windowWithText.chartText.set(this.canvas, [])
      clear.apply(this, args)
    }
    CanvasRenderingContext2D.prototype.fillText = function (
      text,
      x,
      y,
      maxWidth,
    ) {
      const list = windowWithText.chartText.get(this.canvas) ?? []
      list.push({
        text: String(text),
        x:
          x +
          (this.textAlign === 'left' || this.textAlign === 'start'
            ? this.measureText(text).width / 2
            : 0),
        y: y + (this.textBaseline === 'top' ? 6 : 0),
      })
      windowWithText.chartText.set(this.canvas, list)
      fill.call(this, text, x, y, maxWidth)
    }
  })
}
async function chartTextPoint(page: Page, needle: string) {
  return page.evaluate((needle) => {
    const texts = (
      window as typeof window & {
        chartText: Map<
          HTMLCanvasElement,
          { text: string; x: number; y: number }[]
        >
      }
    ).chartText
    for (const [canvas, items] of texts) {
      if (
        !canvas.isConnected ||
        !canvas.closest('section[aria-label^="基础版"]')
      )
        continue
      const rect = canvas.getBoundingClientRect()
      if (!rect.width || !rect.height) continue
      const match = items.find((item) => item.text.includes(needle))
      if (match) return { x: rect.left + match.x, y: rect.top + match.y }
    }
    return null
  }, needle)
}

test('基础图表：27 指标可搜索切换，绘图保存、恢复和清除互不影响交易线', async ({
  page,
}) => {
  await mockExchange(page)
  await page.setViewportSize({ width: 1440, height: 1000 })
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/')
  const chart = page.getByRole('region', { name: /基础版 K 线图/ })
  await expect(chart).toHaveAttribute('aria-label', /已加载 40 根/)
  await expect(chart.locator('.pointer-events-auto')).toHaveCount(0)
  await page.getByRole('button', { name: '指标', exact: true }).click()
  await expect(page.getByRole('dialog').getByRole('checkbox')).toHaveCount(8)
  await page.getByRole('checkbox', { name: 'BOLL', exact: true }).check()
  await page.getByRole('tab', { name: '副图指标' }).click()
  await expect(page.getByRole('dialog').getByRole('checkbox')).toHaveCount(19)
  await page.getByRole('checkbox', { name: 'MACD', exact: true }).check()
  await page.getByRole('textbox', { name: '搜索指标' }).fill('rsi')
  await expect(page.getByRole('dialog').getByRole('checkbox')).toHaveCount(1)
  await page.getByRole('checkbox', { name: 'RSI', exact: true }).check()
  await page.screenshot({
    path: 'output-tdd/playwright/kline-tools/indicators.png',
  })
  await page.getByRole('button', { name: '恢复默认指标' }).click()
  await expect(
    page.getByRole('checkbox', { name: 'RSI', exact: true }),
  ).not.toBeChecked()
  await page.keyboard.press('Escape')
  const canvas = await chart.locator('canvas').first().boundingBox()
  if (!canvas) throw new Error('No chart canvas')
  await chart.getByRole('button', { name: '水平直线', exact: true }).click()
  await page.mouse.click(canvas.x + 240, canvas.y + 110)
  const saved = () =>
    page.evaluate(() =>
      JSON.parse(localStorage.getItem('hl-chart-drawings-v1:BTC') ?? '[]'),
    )
  await expect.poll(async () => (await saved()).length).toBe(1)
  const line = await saved()
  expect(line[0].name).toBe('horizontalStraightLine')
  expect(line[0].points[0].value).toBeGreaterThan(0)
  await chart.getByRole('button', { name: '锁定绘图' }).click()
  await expect.poll(async () => (await saved())[0].lock).toBe(true)
  await chart.getByRole('button', { name: '隐藏绘图' }).click()
  await expect(chart.getByRole('button', { name: '显示绘图' })).toBeVisible()
  await chart.getByRole('button', { name: '显示绘图' }).click()
  await page.reload()
  await expect(chart).toHaveAttribute('aria-label', /已加载 40 根/)
  await expect(chart.getByRole('button', { name: '解锁绘图' })).toBeVisible()
  await expect.poll(async () => (await saved()).length).toBe(1)
  await page.screenshot({
    path: 'output-tdd/playwright/kline-tools/drawing.png',
  })
  await page.getByRole('button', { name: '交易市场', exact: true }).click()
  await page.getByRole('option', { name: 'ETH / USDC', exact: true }).click()
  await expect(
    chart.getByRole('button', { name: '锁定绘图', exact: true }),
  ).toBeVisible()
  await expect.poll(async () => (await saved()).length).toBe(1)
  await page.getByRole('button', { name: '交易市场', exact: true }).click()
  await page.getByRole('option', { name: 'BTC / USDC', exact: true }).click()
  await expect(
    chart.getByRole('button', { name: '解锁绘图', exact: true }),
  ).toBeVisible()
  await chart.getByRole('button', { name: '清除绘图' }).click()
  await expect.poll(async () => (await saved()).length).toBe(0)
  await chart.getByRole('button', { name: '线段工具', exact: true }).click()
  await expect(
    page.getByRole('button', { name: '价格通道', exact: true }),
  ).toBeVisible()
  await page.keyboard.press('Escape')
  await chart.getByRole('button', { name: 'XABCD 形态', exact: true }).click()
  for (const [x, y] of [
    [140, 200],
    [220, 100],
    [300, 190],
    [380, 130],
    [460, 240],
  ])
    await page.mouse.click(canvas.x + x, canvas.y + y)
  await expect.poll(async () => (await saved())[0]?.name).toBe('xabcd')
  expect((await saved())[0].points).toHaveLength(5)
  await chart.getByRole('button', { name: '清除绘图', exact: true }).click()
  await expect.poll(async () => (await saved()).length).toBe(0)
  expect(errors).toEqual([])
})

test('基础图表：画布拖出保护、取消回滚、修改原单和撤单平仓', async ({
  page,
}) => {
  const exchange = await mockExchange(page)
  exchange.setPosition(0.01)
  await recordChartText(page)
  await page.setViewportSize({ width: 1440, height: 1000 })
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/')
  await ready(page)
  await expect.poll(() => chartTextPoint(page, '0.01 BTC')).not.toBeNull()
  async function dragProtection() {
    await expect(
      page.getByRole('button', { name: '图表止盈止损', exact: true }),
    ).toBeEnabled()
    // 弹窗状态已提交后，再等 Canvas 重建命中图形，避免鼠标落在上一帧已删除的对象上。
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    )
    const holding = await chartTextPoint(page, '0.01 BTC')
    if (!holding) throw new Error('Position line missing')
    await page.mouse.move(holding.x, holding.y)
    await expect.poll(() => chartTextPoint(page, '止盈 / 止损')).not.toBeNull()
    const button = await chartTextPoint(page, '止盈 / 止损')
    if (!button) throw new Error('Protection control missing')
    await page.mouse.move(button.x, button.y)
    await page.mouse.down()
    await page.mouse.move(button.x, button.y - 60, { steps: 10 })
    await page.mouse.up()
  }
  await dragProtection()
  const dialog = page.getByRole('dialog', {
    name: '仓位的止盈/止损',
    includeHidden: true,
  })
  await expect(dialog).toBeVisible()
  await expect(
    dialog.getByRole('textbox', { name: '止盈价格', exact: true }),
  ).not.toHaveValue('')
  await dialog.getByRole('button', { name: '关闭', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  expect(exchange.writes).toEqual([])
  await dragProtection()
  await dialog
    .getByRole('textbox', { name: '止盈价格', exact: true })
    .fill('70100')
  await dialog.getByRole('button', { name: '确认', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect.poll(() => exchange.writes.length).toBe(1)
  expect(exchange.writes[0].orders?.[0]).toMatchObject({
    r: true,
    s: '0',
    t: { trigger: { triggerPx: '70100', tpsl: 'tp' } },
  })
  await expect.poll(() => chartTextPoint(page, '止盈 70100')).not.toBeNull()
  const protection = await chartTextPoint(page, '止盈 70100')
  if (!protection) throw new Error('Take-profit line missing')
  await page.mouse.move(protection.x, protection.y)
  await page.mouse.down()
  await page.mouse.move(protection.x, protection.y - 20, { steps: 8 })
  await page.mouse.up()
  const edit = page.getByRole('dialog', { name: '修改止盈 / 止损' })
  await expect(edit).toBeVisible()
  await edit
    .getByRole('textbox', { name: '止盈价格', exact: true })
    .fill('70200')
  await edit.getByRole('button', { name: '确认', exact: true }).click()
  await expect(edit).toHaveCount(0)
  await expect.poll(() => exchange.writes.length).toBe(2)
  expect(exchange.writes[1]).toMatchObject({
    type: 'batchModify',
    a: true,
    modifies: [
      {
        oid: 100,
        order: { s: '0', r: true, t: { trigger: { triggerPx: '70200' } } },
      },
    ],
  })
  await expect.poll(() => chartTextPoint(page, '止盈 70200')).not.toBeNull()
  await page.screenshot({
    path: 'output-tdd/playwright/kline-tools/trade-lines.png',
  })
  const cancel = page.getByRole('button', { name: '图表撤单 #101' })
  await cancel.focus()
  await cancel.press('Enter')
  await expect.poll(() => exchange.writes.length).toBe(3)
  expect(exchange.writes[2].type).toBe('cancel')
  await expect.poll(() => chartTextPoint(page, '止盈 70200')).toBeNull()
  const close = page.getByRole('button', { name: '图表平仓', exact: true })
  await close.focus()
  await close.press('Enter')
  await page
    .getByRole('dialog')
    .getByRole('button', { name: '市价平仓', exact: true })
    .click()
  await expect.poll(() => exchange.writes.length).toBe(4)
  expect(exchange.writes[3].orders?.[0]).toMatchObject({
    r: true,
    b: false,
    s: '0.01',
  })
  await expect.poll(() => chartTextPoint(page, '0.01 BTC')).toBeNull()
  expect(errors).toEqual([])
})

test('基础图表：交易线显隐、币种隔离、过期保护单拦截及断开清理', async ({
  page,
}) => {
  const exchange = await mockExchange(page)
  exchange.setPosition(0.01)
  const tp: Order = {
    coin: 'BTC',
    side: 'A',
    limitPx: '63000',
    sz: '0',
    origSz: '0',
    oid: 90,
    timestamp: Date.now(),
    cloid: `0x${'1'.repeat(32)}`,
    reduceOnly: true,
    orderType: 'Take Profit Market',
    isTrigger: true,
    triggerPx: '70100',
    triggerCondition: 'Price above 70100',
    isPositionTpsl: true,
    children: [],
  }
  const limit: Order = {
    ...tp,
    oid: 91,
    cloid: `0x${'2'.repeat(32)}`,
    limitPx: '69980',
    sz: '0.02',
    origSz: '0.02',
    side: 'B',
    isTrigger: false,
    isPositionTpsl: false,
    reduceOnly: false,
    orderType: 'Limit',
    triggerPx: '0',
  }
  exchange.setOrders([tp, limit])
  await recordChartText(page)
  await page.setViewportSize({ width: 1440, height: 1000 })
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/')
  await ready(page)
  await expect
    .poll(() => chartTextPoint(page, '69980 · 0.02 BTC'))
    .not.toBeNull()
  await expect.poll(() => chartTextPoint(page, '止盈 70100')).not.toBeNull()
  await page.getByRole('button', { name: '交易线', exact: true }).click()
  await page.getByRole('checkbox', { name: '订单线', exact: true }).uncheck()
  await expect.poll(() => chartTextPoint(page, '69980 · 0.02 BTC')).toBeNull()
  await page.getByRole('checkbox', { name: '订单线', exact: true }).check()
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: '清除绘图', exact: true }).click()
  await expect.poll(() => chartTextPoint(page, '0.01 BTC')).not.toBeNull()
  await expect
    .poll(() => chartTextPoint(page, '69980 · 0.02 BTC'))
    .not.toBeNull()
  await page.getByRole('button', { name: '交易市场', exact: true }).click()
  await page.getByRole('option', { name: 'ETH / USDC', exact: true }).click()
  await expect.poll(() => chartTextPoint(page, '0.01 BTC')).toBeNull()
  await expect.poll(() => chartTextPoint(page, '69980 · 0.02 BTC')).toBeNull()
  await page.getByRole('button', { name: '交易市场', exact: true }).click()
  await page.getByRole('option', { name: 'BTC / USDC', exact: true }).click()
  await expect.poll(() => chartTextPoint(page, '止盈 70100')).not.toBeNull()
  const protection = page.getByRole('button', {
    name: '图表止盈止损',
    exact: true,
  })
  await protection.focus()
  await protection.press('Enter')
  await page
    .getByRole('dialog')
    .getByRole('button', { name: '止盈 70100' })
    .click()
  const edit = page.getByRole('dialog', { name: '修改止盈 / 止损' })
  await edit
    .getByRole('textbox', { name: '止盈价格', exact: true })
    .fill('70200')
  exchange.setOrders([limit])
  await edit.getByRole('button', { name: '确认', exact: true }).click()
  await expect(
    page.getByText('保护单已变化，请关闭后重新确认', { exact: true }),
  ).toBeVisible()
  expect(exchange.writes).toHaveLength(0)
  await edit.getByRole('button', { name: '关闭', exact: true }).click()
  await expect.poll(() => chartTextPoint(page, '止盈 70100')).toBeNull()
  await page.getByRole('button', { name: /0x1111/ }).click()
  await page.getByRole('button', { name: '断开钱包', exact: true }).click()
  await expect.poll(() => chartTextPoint(page, '0.01 BTC')).toBeNull()
  await expect.poll(() => chartTextPoint(page, '69980 · 0.02 BTC')).toBeNull()
  expect(errors).toEqual([])
})

test('基础图表：侧边收起展开，重置清除绘图并恢复默认指标和视野', async ({
  page,
}) => {
  const { writes } = await mockExchange(page)
  await page.setViewportSize({ width: 1440, height: 1000 })
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/')
  const chart = page.getByRole('region', { name: /基础版 K 线图/ })
  const canvas = chart.locator('canvas').first()
  await expect(chart).toHaveAttribute('aria-label', /已加载 40 根/)
  await expect(chart.locator('.pointer-events-auto')).toHaveCount(0)
  const extent = () =>
    canvas.evaluate((element) => {
      if (!(element instanceof HTMLCanvasElement)) throw new Error('缺少画布')
      const pixels = element
        .getContext('2d')
        ?.getImageData(0, Math.floor(element.height / 2), element.width, 1).data
      const columns: number[] = []
      if (pixels)
        for (let x = 0; x < element.width; x++)
          if (
            pixels[x * 4] <= 20 &&
            pixels[x * 4 + 1] > 100 &&
            pixels[x * 4 + 2] > 60 &&
            pixels[x * 4 + 3] > 250
          )
            columns.push(x)
      return {
        span: (columns.at(-1) ?? 0) - (columns[0] ?? 0),
        gap: element.width - (columns.at(-1) ?? 0),
      }
    })
  await expect.poll(async () => (await extent()).span).toBeGreaterThan(100)
  const initial = await extent()
  const initialCanvases = await chart.locator('canvas').count()
  await expect(
    page.getByRole('button', { name: '画图工具', exact: true }),
  ).toHaveCount(0)
  const original = await canvas.elementHandle()
  const box = await canvas.boundingBox()
  if (!box) throw new Error('缺少图表边界')
  await chart.getByRole('button', { name: '水平直线', exact: true }).click()
  await page.mouse.click(box.x + 240, box.y + 110)
  const drawings = () =>
    page.evaluate(() =>
      JSON.parse(localStorage.getItem('hl-chart-drawings-v1:BTC') ?? '[]'),
    )
  await expect.poll(async () => (await drawings()).length).toBe(1)
  await page.evaluate(() =>
    localStorage.setItem(
      'hl-chart-drawings-v1:ETH',
      localStorage.getItem('hl-chart-drawings-v1:BTC') ?? '[]',
    ),
  )
  await chart.getByRole('button', { name: '收起画图工具', exact: true }).click()
  await expect(
    chart.getByRole('button', { name: '水平直线', exact: true }),
  ).toHaveCount(0)
  await expect(
    chart.getByRole('button', { name: '展开画图工具', exact: true }),
  ).toHaveAttribute('aria-expanded', 'false')
  await expect
    .poll(async () => (await canvas.boundingBox())?.width ?? 0)
    .toBeGreaterThan(box.width)
  await chart.getByRole('button', { name: '展开画图工具', exact: true }).click()
  await expect
    .poll(async () =>
      Math.abs(((await canvas.boundingBox())?.width ?? 0) - box.width),
    )
    .toBeLessThan(6)
  await expect.poll(async () => (await drawings()).length).toBe(1)
  await page.getByRole('button', { name: '指标', exact: true }).click()
  await page.getByRole('checkbox', { name: '均线 MA', exact: true }).uncheck()
  await page.getByRole('tab', { name: '副图指标' }).click()
  await page
    .getByRole('checkbox', { name: '成交量 VOL', exact: true })
    .uncheck()
  await page.getByRole('checkbox', { name: 'MACD', exact: true }).check()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  const plot = await canvas.boundingBox()
  if (!plot) throw new Error('缺少图表边界')
  await page.mouse.move(plot.x + plot.width / 2, plot.y + plot.height / 2)
  await page.mouse.wheel(0, -240)
  await expect.poll(async () => (await extent()).span).not.toBe(initial.span)
  const zoomed = await extent()
  for (let round = 0; round < 3; round++) {
    await chart
      .getByRole('button', { name: '收起画图工具', exact: true })
      .click()
    await expect
      .poll(async () => (await canvas.boundingBox())?.width ?? 0)
      .toBeGreaterThan(box.width + 30)
    await expect.poll(extent).toEqual(zoomed)
    await chart
      .getByRole('button', { name: '展开画图工具', exact: true })
      .click()
    await expect.poll(extent).toEqual(zoomed)
  }
  await page.mouse.move(plot.x + plot.width / 2, plot.y + plot.height / 2)

  await page.mouse.down()
  await page.mouse.move(
    plot.x + plot.width / 2 + 240,
    plot.y + plot.height / 2,
    { steps: 10 },
  )
  await page.mouse.up()
  await expect(
    chart.getByRole('button', { name: '回到实时', exact: true }),
  ).toBeVisible()
  await page.getByRole('button', { name: '重置图表', exact: true }).click()
  await expect.poll(async () => (await drawings()).length).toBe(0)
  await expect(
    chart.getByRole('button', { name: '回到实时', exact: true }),
  ).toBeHidden()
  await expect.poll(extent).toEqual(initial)
  expect(
    await canvas.evaluate(
      (element, original) => element === original,
      original,
    ),
  ).toBe(true)
  await page.getByRole('button', { name: '指标', exact: true }).click()
  await expect(page.getByRole('dialog').locator('input:checked')).toHaveCount(1)
  await expect(
    page.getByRole('checkbox', { name: '均线 MA', exact: true }),
  ).toBeChecked()
  await page.getByRole('tab', { name: '副图指标' }).click()
  await expect(page.getByRole('dialog').locator('input:checked')).toHaveCount(1)
  await expect(
    page.getByRole('checkbox', { name: '成交量 VOL', exact: true }),
  ).toBeChecked()
  await expect(
    page.getByRole('checkbox', { name: 'MACD', exact: true }),
  ).not.toBeChecked()
  await page.keyboard.press('Escape')
  expect(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem('hl-chart-drawings-v1:ETH') ?? '[]')
          .length,
    ),
  ).toBe(1)
  await expect(chart.locator('canvas')).toHaveCount(initialCanvases)
  await expect
    .poll(async () =>
      Math.abs(((await canvas.boundingBox())?.height ?? 0) - box.height),
    )
    .toBeLessThan(2)
  await page.screenshot({ path: 'output-tdd/playwright/kline-tools/reset.png' })
  await chart.getByRole('button', { name: '收起画图工具', exact: true }).click()

  await expect
    .poll(async () => (await canvas.boundingBox())?.width ?? 0)
    .toBeGreaterThan(box.width + 30)
  const handle = await chart
    .getByRole('button', { name: '展开画图工具', exact: true })
    .boundingBox()
  const bounds = await chart
    .getByRole('complementary', { name: '画图工具', exact: true })
    .boundingBox()
  expect(
    handle &&
      bounds &&
      handle.width <= 12 &&
      handle.height <= 28 &&
      Math.abs(
        handle.y + handle.height / 2 - (bounds.y + bounds.height * 0.72 - 20),
      ) < 2,
  ).toBeTruthy()
  await page.screenshot({
    path: 'output-tdd/playwright/kline-tools/collapsed.png',
  })
  await page.getByRole('button', { name: 'TradingView', exact: true }).click()
  const frame = page.frameLocator('iframe').first()
  await expect(frame.locator('canvas').first()).toBeVisible()
  const previousPanes = await frame.locator('canvas').count()
  for (let round = 0; round < 2; round++) {
    await page.getByRole('button', { name: '重置图表', exact: true }).click()
    await expect(
      page.getByRole('button', { name: '重置图表', exact: true }),
    ).toBeEnabled()
    await expect.poll(() => frame.locator('canvas').count()).toBe(previousPanes)
  }
  expect(errors).toEqual([])
  expect(writes).toEqual([])
})

test('完整账户区：独立余额与预测、历史委托字段筛选、全部记录和导出', async ({
  page,
}) => {
  const exchange = await mockExchange(page)
  const now = Date.now()
  await page.route(
    'https://api.hyperliquid-testnet.xyz/info',
    async (route) => {
      const request = route.request().postDataJSON()
      if (request.type === 'historicalOrders')
        return route.fulfill({
          json: Array.from({ length: 130 }, (_, i) => ({
            order: {
              coin: i % 2 ? 'ETH' : 'BTC',
              side: 'B',
              oid: i < 2 ? 900 : 900 + i,
              timestamp: now - i * 1000,
              limitPx: '100',
              sz: i === 0 ? '0' : '2',
              origSz: '2',
              isTrigger: false,
              triggerCondition: 'N/A',
              triggerPx: '0',
              children: [],
              reduceOnly: false,
              orderType: 'Limit',
              isPositionTpsl: false,
            },
            status: i === 0 ? 'filled' : 'open',
            statusTimestamp: now - i * 1000,
          })),
        })
      if (request.type === 'userFunding')
        return route.fulfill({
          json: [
            {
              time: now,
              hash: '0xabc',
              delta: {
                coin: 'BTC',
                szi: '0.5',
                usdc: '-0.25',
                fundingRate: '0.0001',
                type: 'funding',
                nSamples: 1,
              },
            },
          ],
        })
      return route.fallback()
    },
  )
  await ready(page)
  const records = page.getByRole('region', { name: '交易记录', exact: true })
  for (const label of [
    '余额',
    '仓位',
    '预测',
    '当前委托',
    'TWAP',
    '追价策略',
    '历史成交',
    '资金费历史',
    '历史委托',
  ])
    await expect(
      records.getByRole('tab', { name: label, exact: true }),
    ).toBeVisible()
  await records.getByRole('tab', { name: '余额', exact: true }).click()
  await expect(
    records.getByRole('table', { name: '余额', exact: true }),
  ).toContainText('HYPE')
  await expect(
    records.getByRole('table', { name: '余额', exact: true }),
  ).not.toContainText('BTC 达到目标价')
  await records.getByRole('tab', { name: '预测', exact: true }).click()
  const holdings = records.getByRole('table', { name: '预测持仓', exact: true })
  await expect(holdings.locator('tbody tr')).toHaveCount(2)
  await holdings
    .getByRole('button', { name: '卖出', exact: true })
    .first()
    .click()
  const form = page.getByRole('region', { name: '下单面板', exact: true })
  await expect(
    form.getByRole('tab', { name: '卖出', exact: true }),
  ).toHaveAttribute('aria-selected', 'true')
  await expect(
    form.getByRole('textbox', { name: '数量（Yes）', exact: true }),
  ).toHaveValue('95')
  await records.getByRole('tab', { name: '历史委托', exact: true }).click()
  const history = records.getByRole('table', { name: '历史委托', exact: true })
  await expect(history.locator('tbody tr')).toHaveCount(25)
  await expect(
    history.getByRole('columnheader', { name: '成交大小', exact: true }),
  ).toBeVisible()
  await records.getByRole('button', { name: '查看全部', exact: true }).click()
  await expect(history.locator('tbody tr')).toHaveCount(100)
  await records.getByRole('button', { name: '下一页', exact: true }).click()
  await expect(history.locator('tbody tr')).toHaveCount(30)
  const download = page.waitForEvent('download')
  await records.getByRole('button', { name: '导出为 CSV', exact: true }).click()
  const path = await (await download).path()
  expect(path && (await readFile(path, 'utf8'))).toContain('已成交')
  await records
    .getByRole('button', { name: '历史市场筛选', exact: true })
    .click()
  await page
    .getByRole('menuitemradio', { name: 'ETH / USDC', exact: true })
    .click()
  await expect(history.locator('tbody tr')).toHaveCount(25)
  await records.getByRole('button', { name: '查看全部', exact: true }).click()
  await expect(history.locator('tbody tr')).toHaveCount(65)
  await records.getByRole('tab', { name: '资金费历史', exact: true }).click()
  await expect(
    records.getByRole('table', { name: '资金费历史', exact: true }),
  ).toContainText('-0.25 USDC')
  await expect(
    records.getByRole('table', { name: '资金费历史', exact: true }),
  ).toContainText('0.01%')
  expect(exchange.writes).toHaveLength(0)
})

test('预测市场加载时显示骨架，完成后展示市场，空结果与错误不保留骨架', async ({
  page,
}) => {
  const exchange = await mockExchange(page)
  const loaded = Promise.withResolvers<void>()
  let result = 'markets'
  await page.route(
    'https://api.hyperliquid-testnet.xyz/info',
    async (route) => {
      if (route.request().postDataJSON().type !== 'outcomeMeta')
        return route.fallback()
      await loaded.promise
      if (result === 'empty')
        return route.fulfill({
          json: { outcomes: [], questions: [], feeScale: '1' },
        })
      if (result === 'error')
        return route.fulfill({ status: 400, body: 'offline' })
      return route.fallback()
    },
  )
  await page.goto('/outcomes')
  const markets = page.getByRole('region', { name: '预测市场', exact: true })
  const loading = markets.getByRole('status', { name: '正在加载预测市场…' })
  await expect(loading).toBeVisible()
  await expect(markets).toHaveAttribute('aria-busy', 'true')
  await expect(markets.getByText('没有匹配的市场')).toHaveCount(0)
  loaded.resolve()
  await expect(
    markets.getByRole('link', { name: 'BTC 达到目标价？', exact: true }),
  ).toBeVisible()
  await expect(loading).toHaveCount(0)
  await expect(markets).toHaveAttribute('aria-busy', 'false')
  await expect(page).toHaveTitle('预测市场 | fameex-testnet')
  result = 'empty'
  await page.reload()
  await expect(markets.getByText('没有匹配的市场')).toBeVisible()
  await expect(loading).toHaveCount(0)
  result = 'error'
  await page.reload()
  await expect(markets.getByRole('alert')).toContainText('预测市场加载失败：')
  await expect(loading).toHaveCount(0)
  await expect(markets.getByText('没有匹配的市场')).toHaveCount(0)
  expect(exchange.writes).toHaveLength(0)
})

test('预测落地页进入指定结果，转换确认重读余额并提交已校验的原生动作', async ({
  page,
}) => {
  const exchange = await mockExchange(page)
  await ready(page)
  await page.getByRole('link', { name: '预测', exact: true }).click()
  await expect(page).toHaveURL(/\/outcomes$/)
  const response = await page.reload()
  expect(response?.status()).toBe(200)
  await expect(
    page.getByRole('heading', { name: '预测市场', exact: true }),
  ).toBeVisible()
  await page
    .getByRole('textbox', { name: '搜索预测市场', exact: true })
    .fill('BTC')
  await page
    .getByRole('link', { name: 'BTC 达到目标价？ · No', exact: true })
    .click()
  const panel = page.getByRole('region', { name: '下单面板', exact: true })
  await expect(
    panel.getByRole('button', { name: 'No', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true')
  await expect(
    panel.getByRole('button', { name: '下单', exact: true }),
  ).toBeDisabled()
  await predictionType(page, '转换')
  let dialog = page.getByRole('dialog', { name: '转换结果', exact: true })
  await dialog
    .getByRole('textbox', { name: '转换数量', exact: true })
    .fill('1.5')
  await dialog.getByRole('button', { name: '预览转换', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText('整数')
  await dialog
    .getByRole('textbox', { name: '转换数量', exact: true })
    .fill('20')
  await dialog.getByRole('button', { name: '预览转换', exact: true }).click()
  dialog = page.getByRole('dialog', { name: '确认预测转换', exact: true })
  exchange.setCashBalance('USDC', '15', '10')
  await dialog.getByRole('button', { name: '确认转换', exact: true }).click()
  await expect(
    page.locator('output').filter({ hasText: '转换数量超过可用' }),
  ).toBeVisible()
  expect(exchange.writes).toHaveLength(0)
  dialog = page.getByRole('dialog', { name: '转换结果', exact: true })
  await dialog.getByRole('textbox', { name: '转换数量', exact: true }).fill('2')
  await dialog.getByRole('button', { name: '预览转换', exact: true }).click()
  await page
    .getByRole('dialog', { name: '确认预测转换', exact: true })
    .getByRole('button', { name: '确认转换', exact: true })
    .click()
  await expect(
    page.locator('output').filter({ hasText: '拆分结果已完成' }),
  ).toBeVisible()
  expect(exchange.writes).toEqual([
    { type: 'userOutcome', splitOutcome: { outcome: 12, amount: '2' } },
  ])
})

test('历史查询失败独立重试，不影响实时行情与交易就绪', async ({ page }) => {
  const exchange = await mockExchange(page)
  let failing = true
  await page.route(
    'https://api.hyperliquid-testnet.xyz/info',
    async (route) => {
      if (route.request().postDataJSON().type !== 'historicalOrders')
        return route.fallback()
      return failing
        ? route.fulfill({ status: 503, json: { error: 'history unavailable' } })
        : route.fulfill({ json: [] })
    },
  )
  await ready(page)
  const records = page.getByRole('region', { name: '交易记录', exact: true })
  await records.getByRole('tab', { name: '历史委托', exact: true }).click()
  await expect(records.getByRole('alert')).toContainText('记录加载失败')
  await expect(
    page.getByRole('button', { name: '下单', exact: true }),
  ).toBeEnabled()
  await expect(page.getByText('实时连接', { exact: false })).toBeVisible()
  failing = false
  await records.getByRole('button', { name: '重试', exact: true }).click()
  await expect(records.getByRole('alert')).toHaveCount(0)
  await expect(records.getByText('暂无记录', { exact: true })).toBeVisible()
  expect(exchange.writes).toHaveLength(0)
})

test('预测转换回报丢失保留待确认状态，禁止自动重发', async ({ page }) => {
  await mockExchange(page)
  let sent = 0
  await page.route(
    'https://api.hyperliquid-testnet.xyz/exchange',
    async (route) => {
      if (route.request().postDataJSON().action.type !== 'userOutcome')
        return route.fallback()
      sent++
      return route.abort('failed')
    },
  )
  await ready(page)
  await chooseCashMarket(page, true)
  await predictionType(page, '转换')
  await page.getByRole('textbox', { name: '转换数量', exact: true }).fill('2')
  await page.getByRole('button', { name: '预览转换', exact: true }).click()
  await page.getByRole('button', { name: '确认转换', exact: true }).click()
  await expect(
    page.locator('output').filter({ hasText: '结果待确认' }),
  ).toBeVisible()
  const dialog = page.getByRole('dialog', { name: '转换结果', exact: true })
  await expect(
    dialog.getByRole('button', { name: '预览转换', exact: true }),
  ).toBeDisabled()
  expect(sent).toBe(1)
  expect(
    await page.evaluate(() =>
      Object.entries(localStorage)
        .filter(([key]) => key.startsWith('hl-testnet-pending-order:'))
        .map(([, value]) => JSON.parse(value).native),
    ),
  ).toEqual(['outcome'])
})

test('资金费多页查询不被账户轮询打断，边界区块不重复', async ({ page }) => {
  test.setTimeout(40000)
  await mockExchange(page)
  const base = Date.now() - 2000
  let queries = 0
  await page.route(
    'https://api.hyperliquid-testnet.xyz/info',
    async (route) => {
      const request = route.request().postDataJSON()
      if (request.type !== 'userFunding') return route.fallback()
      queries++
      const first = request.startTime <= base ? 0 : request.startTime - base
      if (first < 998) await new Promise((resolve) => setTimeout(resolve, 8000))
      return route.fulfill({
        json: Array.from({ length: first < 998 ? 500 : 2 }, (_, i) => ({
          time: base + first + i,
          hash: `0x${first + i}`,
          delta: {
            coin: 'BTC',
            szi: '1',
            usdc: '-0.01',
            fundingRate: '0.001',
            type: 'funding',
            nSamples: 1,
          },
        })),
      })
    },
  )
  await ready(page)
  const records = page.getByRole('region', { name: '交易记录', exact: true })
  await records.getByRole('tab', { name: '资金费历史', exact: true }).click()
  await expect(
    records.getByRole('table', { name: '资金费历史' }).locator('tbody tr'),
  ).toHaveCount(25, { timeout: 23000 })
  await expect(records).toContainText('1–25 / 1000')
  expect(queries).toBeGreaterThanOrEqual(3)
  expect(queries).toBeLessThanOrEqual(4)
})

async function predictionType(page: Page, name: string) {
  await expect(
    page.getByRole('region', { name: '市场选择器', exact: true }),
  ).toHaveCount(0)
  await page.getByRole('button', { name: '预测订单类型', exact: true }).click()
  await page.getByRole('menuitemradio', { name, exact: true }).click()
  await expect(
    page.getByRole('menu', { name: '预测订单类型', exact: true }),
  ).toHaveCount(0)
  if (name !== '转换')
    await expect(
      page.getByRole('button', { name: '预测订单类型', exact: true }),
    ).toBeFocused()
}
async function predictionUnit(page: Page, name: string) {
  await expect(
    page.getByRole('region', { name: '市场选择器', exact: true }),
  ).toHaveCount(0)
  await page
    .getByRole('region', { name: '下单面板', exact: true })
    .getByRole('button', { name: '数量单位', exact: true })
    .click()
  await page.getByRole('menuitemradio', { name, exact: true }).click()
  await expect(
    page.getByRole('menu', { name: '数量单位', exact: true }),
  ).toHaveCount(0)
  await expect(
    page.getByRole('button', { name: '数量单位', exact: true }),
  ).toBeFocused()
}

test('预测专用下单：默认市价 USDC、固定 Yes/No、保持草稿、费率与实际订单一致', async ({
  page,
}) => {
  const { writes } = await mockExchange(page)
  await ready(page)
  await chooseCashMarket(page, true)
  const panel = page.getByRole('region', { name: '下单面板', exact: true })
  await expect
    .poll(() => panel.evaluate((el) => el.scrollWidth - el.clientWidth))
    .toBe(0)
  await expect(panel.getByRole('button', { name: '预测订单类型' })).toHaveText(
    '市价',
  )
  await expect(
    panel.getByRole('button', { name: '调整最大滑点' }),
  ).toContainText('Max: 8.00%')
  await expect(
    panel.getByRole('button', { name: '下单', exact: true }),
  ).toBeDisabled()
  await panel.getByRole('textbox', { name: '数量（USDC）' }).fill('10.2')
  await expect(panel.getByLabel('订单摘要')).toContainText('20 USDC')
  await expect(panel.getByLabel('订单摘要')).toContainText('0.0000% / 0.0000%')
  await predictionUnit(page, 'Yes')
  await expect(panel.getByRole('textbox', { name: '数量（Yes）' })).toHaveValue(
    '20',
  )
  await panel.getByRole('button', { name: 'No', exact: true }).click()
  await expect(panel.getByRole('textbox', { name: '数量（No）' })).toHaveValue(
    '20',
  )
  await expect(
    panel.getByRole('group', { name: '预测方向' }).getByRole('button').first(),
  ).toHaveText(/Yes/)
  await expect(
    panel.getByRole('button', { name: 'No', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true')
  await predictionType(page, '限价')
  await panel.getByRole('textbox', { name: '价格（USDC）' }).fill('0.4')
  await expect(panel.getByRole('textbox', { name: '数量（No）' })).toHaveValue(
    '20',
  )
  await expect(panel.getByLabel('订单摘要')).toContainText('8.0000 USDC')
  await signPreview(page)
  await expect.poll(() => writes.length).toBe(1)
  expect(writes[0].orders?.[0]).toMatchObject({
    a: 100000121,
    b: true,
    s: '20',
    p: '0.4',
    t: { limit: { tif: 'Gtc' } },
  })
  await panel.getByRole('tab', { name: '卖出', exact: true }).click()
  await expect(panel.getByLabel('订单摘要')).toContainText('0.0700% / 0.0400%')
  await expect(panel.getByLabel('订单摘要')).not.toContainText('的派付')
  await predictionType(page, '转换')
  const dialog = page.getByRole('dialog', { name: '转换结果', exact: true })
  await expect(dialog.getByRole('tab')).toHaveCount(4)
  await expect(dialog.getByRole('tab', { name: '合并问题' })).toBeDisabled()
  await dialog.getByRole('button', { name: '关闭', exact: true }).click()
  await panel.getByRole('button', { name: 'Yes', exact: true }).click()
  await panel.getByRole('textbox', { name: '下单百分比' }).fill('50')
  await expect(panel.getByRole('textbox', { name: '数量（Yes）' })).toHaveValue(
    '47',
  )
  await page.screenshot({
    path: 'output-tdd/playwright/prediction-order/limit.png',
  })
})

for (const mode of [
  '自动清理',
  '手动撤销',
  '取消签名',
  '撤销未生效',
  '撤销回执丢失',
  '旧密钥重用',
] as const) {
  test(`手机设备：${mode}，确认释放名额后才生成二维码`, async ({ page }) => {
    test.skip(
      !process.env.NEXT_PUBLIC_PHONE_PAIRING_URL,
      '需要配置配对服务地址',
    )
    const exchange = await mockExchange(page)
    if (mode === '旧密钥重用')
      await page.addInitScript(() => {
        const original = crypto.getRandomValues.bind(crypto)
        crypto.getRandomValues = <T extends ArrayBufferView | null>(
          array: T,
        ): T => {
          if (array instanceof Uint8Array && array.length === 32) array.fill(7)
          else if (array)
            original(
              new Uint8Array(array.buffer, array.byteOffset, array.byteLength),
            )
          return array
        }
      })
    if (mode === '取消签名')
      await page.addInitScript(() => {
        const provider = window.ethereum
        if (!provider) throw new Error('Missing mock wallet')
        const request = provider.request.bind(provider)
        provider.request = (async (params: {
          method: string
          params?: unknown[]
        }) => {
          if (
            params.method === 'eth_signTypedData_v4' &&
            JSON.parse(String(params.params?.[1])).message.agentAddress ===
              '0x0000000000000000000000000000000000000000'
          )
            throw { code: 4001, message: 'User rejected revocation' }
          return request(params as Parameters<typeof request>[0])
        }) as typeof provider.request
      })
    await page.goto('/')
    await page.getByRole('button', { name: '连接钱包', exact: true }).click()
    await page.getByRole('button', { name: '浏览器钱包 连接 →' }).click()
    await expect.poll(exchange.agentRegistrations).toBe(1)
    const oldest = {
      name: 'Phone-2222222222',
      address: `0x${'2'.repeat(40)}`,
      validUntil: Date.now() + 60000,
    }
    const newest = {
      name: 'Phone-4444444444',
      address: `0x${'4'.repeat(40)}`,
      validUntil: Date.now() + 120000,
    }
    const web = {
      name: 'JulianTerminal',
      address: `0x${'5'.repeat(40)}`,
      validUntil: Date.now() + 180000,
    }
    let agents = [newest, web, oldest]
    const revoked: string[] = []
    let pairings = 0
    await page.route(
      'https://api.hyperliquid-testnet.xyz/info',
      async (route) => {
        const type = route.request().postDataJSON().type
        if (type === 'extraAgents') await route.fulfill({ json: agents })
        else if (type === 'subAccounts')
          await route.fulfill({ body: 'null', contentType: 'application/json' })
        else await route.fallback()
      },
    )
    await page.route(
      'https://api.hyperliquid-testnet.xyz/exchange',
      async (route) => {
        const { action } = route.request().postDataJSON()
        expect(action.type).toBe('approveAgent')
        expect(action.hyperliquidChain).toBe('Testnet')
        expect(action.agentAddress).toBe(`0x${'0'.repeat(40)}`)
        expect(action.agentName).toBe(oldest.name)
        revoked.push(action.agentName)
        expect(pairings).toBe(0)
        if (mode !== '撤销未生效') agents = [newest, web]
        if (mode === '撤销回执丢失') await route.abort('failed')
        else
          await route.fulfill({
            json: { status: 'ok', response: { type: 'default' } },
          })
      },
    )
    const relay = process.env.NEXT_PUBLIC_PHONE_PAIRING_URL as string
    const offer = {
      version: 1 as const,
      relay,
      id: '1'.repeat(32),
      token: '2'.repeat(64),
      key: '07'.repeat(32),
      account: address as `0x${string}`,
      expiresAt: Date.now() + 300000,
    }
    await page.route(`${relay}/**`, async (route) => {
      const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type',
        'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      }
      if (route.request().method() === 'OPTIONS') {
        await route.fulfill({ status: 204, headers })
        return
      }
      if (route.request().url().endsWith('/pairings')) {
        pairings++
        expect(agents).toEqual([newest, web])
        await route.fulfill({
          headers,
          json: {
            id: '1'.repeat(32),
            phoneToken: '2'.repeat(64),
            webToken: '4'.repeat(64),
            expiresAt: offer.expiresAt,
          },
        })
      } else if (mode === '旧密钥重用' && route.request().method() === 'GET') {
        const { encryptPairing } = await import(
          '../src/features/wallet/lib/phone-pairing'
        )
        await route.fulfill({
          headers,
          json: {
            request: encryptPairing(offer, 'request', {
              account: address,
              agentAddress: oldest.address,
              agentName: oldest.name,
              expiresAt: oldest.validUntil,
            }),
          },
        })
      } else await route.fulfill({ headers, json: {} })
    })
    await page
      .getByRole('button', { name: /^0x[0-9a-f]{4}…[0-9a-f]{4}$/i })
      .click()
    await page.getByRole('link', { name: '连接手机 App / 管理设备' }).click()
    await expect(page).toHaveURL(/\/connect$/)
    await page.getByRole('button', { name: '浏览器钱包 连接 →' }).click()
    await expect(
      page.getByText('已授权设备（2）', { exact: true }),
    ).toBeVisible()
    expect(revoked).toHaveLength(0)
    const create = page.getByRole('button', { name: '生成手机授权二维码' })
    if (mode === '手动撤销') {
      await page.getByText('已授权设备（2）', { exact: true }).click()
      await expect(page.getByRole('link', { name: /测试网撤销/ })).toHaveCount(
        0,
      )
      await page
        .getByRole('button', { name: `撤销授权 ${oldest.name}` })
        .click()
      await expect(
        page.getByText('已授权设备（1）', { exact: true }),
      ).toBeVisible()
      expect(pairings).toBe(0)
    }
    await create.click()
    const qr = page.locator('svg title', {
      hasText: '用 fameex-testnet 手机 App',
    })
    if (mode === '取消签名' || mode === '撤销未生效') {
      await expect(
        page
          .getByRole('region', { name: '授权手机交易', exact: true })
          .getByRole('alert'),
      ).toContainText(mode === '取消签名' ? '取消' : '尚未确认')
      await expect(qr).toHaveCount(0)
      expect(pairings).toBe(0)
      expect(agents).toHaveLength(3)
      expect(revoked).toHaveLength(mode === '取消签名' ? 0 : 1)
    } else {
      await expect(qr).toHaveCount(1)
      await expect(
        page.getByText('已授权设备（1）', { exact: true }),
      ).toBeVisible()
      expect(revoked).toEqual([oldest.name])
      if (mode === '旧密钥重用') {
        await expect(
          page
            .getByRole('region', { name: '授权手机交易', exact: true })
            .getByRole('alert'),
        ).toContainText('请使用最新版 App 重新扫码')
        await expect(
          page.getByRole('button', { name: '在主钱包确认授权' }),
        ).toHaveCount(0)
      }
      await page.getByText('已授权设备（1）', { exact: true }).click()
      await expect(page.getByText(newest.name, { exact: true })).toBeVisible()
      await expect(page.getByText(oldest.name, { exact: true })).toHaveCount(0)
      if (mode === '自动清理')
        await page.screenshot({
          path: 'output-tdd/playwright/phone-device-revoke/automatic.png',
          fullPage: true,
        })
    }
    expect(exchange.writes).toHaveLength(0)
  })
}

for (const failure of ['通知丢失', '代理满额', '提交失败'] as const) {
  test(`手机配对：${failure}可恢复，查询不重复签名`, async ({ page }) => {
    test.skip(
      !process.env.NEXT_PUBLIC_PHONE_PAIRING_URL,
      '显式配置本地配对服务地址才运行扫码场景',
    )
    const { encryptPairing, decryptPairing, pairingCode } = await import(
      '../src/features/wallet/lib/phone-pairing'
    )
    const exchange = await mockExchange(page)
    await page.addInitScript(() => {
      const original = crypto.getRandomValues.bind(crypto)
      crypto.getRandomValues = <T extends ArrayBufferView | null>(
        array: T,
      ): T => {
        if (array instanceof Uint8Array && array.length === 32) {
          array.fill(7)
          return array
        }
        if (array)
          original(
            new Uint8Array(array.buffer, array.byteOffset, array.byteLength),
          )
        return array
      }
    })
    const relay = process.env.NEXT_PUBLIC_PHONE_PAIRING_URL as string
    const offer = {
      version: 1 as const,
      relay,
      id: '1'.repeat(32),
      token: '2'.repeat(64),
      key: '07'.repeat(32),
      account: address as `0x${string}`,
      expiresAt: Date.now() + 300000,
    }
    const phone = {
      account: address as `0x${string}`,
      agentAddress: `0x${'3'.repeat(40)}` as const,
      agentName: 'Phone-3333333333',
      expiresAt: Date.now() + 604800000,
    }
    let scanned = false
    let approved = false
    let full = false
    let signs = 0
    let deleted = 0
    let responseEnvelope = ''
    let publishCalls = 0
    await page.route(`${relay}/**`, async (route) => {
      const request = route.request()
      const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type',
        'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      }
      if (request.method() === 'OPTIONS') {
        await route.fulfill({ status: 204, headers })
        return
      }
      if (request.url().endsWith('/pairings')) {
        // 复现线上服务器比电脑快几秒，刚创建的二维码仍应显示。
        offer.expiresAt = Date.now() + 302500
        await route.fulfill({
          headers,
          json: {
            id: offer.id,
            phoneToken: offer.token,
            webToken: '4'.repeat(64),
            expiresAt: offer.expiresAt,
          },
        })
        return
      }
      if (request.method() === 'DELETE') {
        deleted++
        await route.fulfill({ headers, json: { ok: true } })
        return
      }
      if (request.url().endsWith('/approval')) {
        publishCalls++
        const envelope = request.postDataJSON().envelope
        expect(decryptPairing(offer, 'approval', envelope)).toEqual(phone)
        if (!responseEnvelope) {
          responseEnvelope = envelope
          await route.abort('failed')
          return
        }
        expect(envelope).toBe(responseEnvelope)
        await route.fulfill({ headers, json: { ok: true } })
        return
      }
      await route.fulfill({
        headers,
        json: {
          ...(scanned
            ? { request: encryptPairing(offer, 'request', phone) }
            : {}),
        },
      })
    })
    await page.goto('/')
    await page.getByRole('button', { name: '连接钱包', exact: true }).click()
    await page.getByRole('button', { name: '浏览器钱包 连接 →' }).click()
    await expect.poll(exchange.agentRegistrations).toBe(1)
    await page.route(
      'https://api.hyperliquid-testnet.xyz/info',
      async (route) => {
        const type = route.request().postDataJSON().type
        if (type === 'subAccounts') {
          await route.fulfill({ contentType: 'application/json', body: 'null' })
          return
        }
        if (full && type === 'extraAgents') {
          await route.fulfill({
            json: [1, 2, 4].map((value) => ({
              address: `0x${String(value).repeat(40)}`,
              name: `Old-${value}`,
              validUntil: phone.expiresAt,
            })),
          })
          return
        }
        if (approved && type === 'extraAgents')
          await route.fulfill({
            json: [
              {
                address: phone.agentAddress,
                name: phone.agentName,
                validUntil: phone.expiresAt,
              },
            ],
          })
        else await route.fallback()
      },
    )
    await page.route(
      'https://api.hyperliquid-testnet.xyz/exchange',
      async (route) => {
        const action = route.request().postDataJSON().action
        expect(action.type).toBe('approveAgent')
        expect(action.hyperliquidChain).toBe('Testnet')
        expect(action.agentAddress.toLowerCase()).toBe(
          phone.agentAddress.toLowerCase(),
        )
        expect(action.agentName).toBe(
          `${phone.agentName} valid_until ${phone.expiresAt}`,
        )
        signs++
        if (failure === '提交失败' && signs === 1) {
          await route.abort('failed')
          return
        }
        approved = true
        await route.fulfill({
          json: { status: 'ok', response: { type: 'default' } },
        })
      },
    )
    await page
      .getByRole('button', { name: /^0x[0-9a-f]{4}…[0-9a-f]{4}$/i })
      .click()
    await page.getByRole('link', { name: '连接手机 App / 管理设备' }).click()
    await expect(page).toHaveURL(/\/connect$/)
    await page.getByRole('button', { name: '浏览器钱包 连接 →' }).click()
    await page.getByRole('button', { name: '生成手机授权二维码' }).click()
    await expect(
      page.locator('svg title', { hasText: '用 fameex-testnet 手机 App' }),
    ).toHaveCount(1)
    scanned = true
    full = failure === '代理满额'
    await expect(
      page.getByText(`两端核对码：${pairingCode(offer, phone)}`),
    ).toBeVisible()
    const approve = page.getByRole('button', { name: '在主钱包确认授权' })
    await expect(approve).toBeEnabled()
    await expect(page.getByRole('checkbox')).toHaveCount(0)
    await expect(
      page
        .getByRole('region', { name: '授权手机交易', exact: true })
        .getByRole('button'),
    ).toHaveCount(1)
    expect(signs).toBe(0)
    await page.screenshot({
      path: `output-tdd/playwright/phone-agent-pairing/web-confirmation-${failure}.png`,
      fullPage: true,
    })
    await approve.click()
    const retry = page.getByRole('button', {
      name: '查询授权结果（不重复签名）',
    })
    if (failure === '代理满额') {
      await expect(
        page
          .getByRole('region', { name: '授权手机交易', exact: true })
          .getByRole('alert'),
      ).toContainText('命名代理已达到 3 个上限')
      expect(signs).toBe(0)
      await expect(approve).toBeEnabled()
      await expect(
        page.getByRole('button', { name: '生成手机授权二维码' }),
      ).toBeEnabled()
      full = false
      await approve.click()
    }
    if (failure === '提交失败') {
      await expect(retry).toBeEnabled()
      await retry.click()
      await expect(
        page
          .getByRole('region', { name: '授权手机交易', exact: true })
          .getByRole('alert'),
      ).toContainText('交易所尚未登记本次手机授权')
      expect(signs).toBe(1)
      await expect(approve).toBeEnabled()
      await approve.click()
    }
    await expect(retry).toBeEnabled()
    await retry.click()
    await expect(
      page.getByText('手机已授权，有效期内无需重复扫码。'),
    ).toBeVisible()
    await expect(approve).toHaveCount(0)
    await expect(page.getByText(/^两端核对码：/)).toHaveCount(0)
    await expect(
      page.getByText('已授权设备（1）', { exact: true }),
    ).toBeVisible()
    await page.getByText('已授权设备（1）', { exact: true }).click()
    await expect(page.getByText(phone.agentName, { exact: true })).toBeVisible()
    await expect(page.getByText('暂无已授权手机。')).toHaveCount(0)
    await page.screenshot({
      path: `output-tdd/playwright/phone-agent-pairing/web-done-${failure}.png`,
      fullPage: true,
    })
    expect(signs).toBe(failure === '提交失败' ? 2 : 1)
    expect(publishCalls).toBe(2)
    await page.getByRole('link', { name: '返回交易', exact: true }).click()
    await expect(page).toHaveURL('/')
    expect(deleted).toBe(0)
    expect(exchange.writes).toHaveLength(0)
  })
}

test('手机连接页可直接访问，只连接账户不提前签名，换账户后清除配对', async ({
  page,
}) => {
  const exchange = await mockExchange(page)
  await page.goto('/connect')
  await expect(
    page.getByRole('heading', { name: '连接手机 App', exact: true }),
  ).toBeVisible()
  await expect(
    page.getByText('使用 App 的「扫码连接」，核对六位码后确认授权。', {
      exact: true,
    }),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: '生成手机授权二维码' }),
  ).toHaveCount(0)
  await page.getByRole('button', { name: '浏览器钱包 连接 →' }).click()
  await expect(page.getByText(address, { exact: true })).toBeVisible()
  await expect(
    page.getByRole('button', { name: '生成手机授权二维码' }),
  ).toBeVisible()
  expect(exchange.agentRegistrations()).toBe(0)
  expect(exchange.writes).toHaveLength(0)
  await page.evaluate(() =>
    window.dispatchEvent(new Event('test-account-change')),
  )
  await expect(
    page.getByRole('region', { name: '连接与授权' }).getByRole('alert'),
  ).toContainText('钱包账户已变化或断开')
  await expect(
    page.getByRole('button', { name: '生成手机授权二维码' }),
  ).toHaveCount(0)
  await page.getByRole('button', { name: '浏览器钱包 连接 →' }).click()
  await expect(
    page.getByText('0x2222222222222222222222222222222222222222', {
      exact: true,
    }),
  ).toBeVisible()
  await page.setViewportSize({ width: 390, height: 844 })
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true)
})

test('手机连接页没有钱包时展示安装与电脑操作说明', async ({ page }) => {
  await page.goto('/connect')
  await expect(page.getByText(/未检测到浏览器钱包/)).toBeVisible()
  await expect(
    page.getByRole('link', { name: 'MetaMask', exact: true }),
  ).toHaveAttribute('href', 'https://metamask.com/download')
  await expect(
    page.getByText('请在电脑连接测试钱包，再用 App 扫码。', { exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: '生成手机授权二维码' }),
  ).toHaveCount(0)
})
