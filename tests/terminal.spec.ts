import { readFile } from 'node:fs/promises'
import { createL1ActionHash } from '@nktkas/hyperliquid/signing'
import { expect, type Page, test } from '@playwright/test'
import { recoverTypedDataAddress, serializeSignature } from 'viem'

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
  let leverage = 2
  let isCross = true
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
    cancels?: { a: number; o: number }[]
    leverage?: number
    isCross?: boolean
    asset?: number
    grouping?: string
    twap?: { a: number; b: boolean; m: number; s: string; t: boolean }
    details?: { t: { p: string; a: boolean } | null; s: string | null }
    a?: number
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
  let pushMarket = (_coin: string, _price: number) => {}
  const candles = (coin: string, interval: string) =>
    Array.from({ length: 40 }, (_, i) => ({
      t: Math.floor(Date.now() / 300000) * 300000 - (40 - i) * 300000,
      T: Math.floor(Date.now() / 300000) * 300000 - (39 - i) * 300000,
      s: coin,
      i: interval,
      o: '69900',
      h: '70100',
      l: '69800',
      c: '70000',
      v: '1',
      n: 1,
    }))
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
    assetPositions: position
      ? [
          {
            type: 'oneWay',
            position: {
              coin: 'BTC',
              szi: String(position),
              leverage: { type: 'cross', value: leverage },
              entryPx: '70000',
              positionValue: String(Math.abs(position) * 70000),
              unrealizedPnl: '0',
              returnOnEquity: '0',
              liquidationPx: '35000',
              marginUsed: '35',
              maxLeverage: 40,
              cumFunding: { allTime: '0', sinceOpen: '0', sinceChange: '0' },
            },
          },
        ]
      : [],
  })
  await page.addInitScript(
    ({ address, mode }) => {
      let current = address
      const callbacks = new Map<string, Set<(...args: unknown[]) => void>>()
      Object.defineProperty(window, 'ethereum', {
        configurable: true,
        value: {
          request: async ({
            method,
            params,
          }: {
            method: string
            params?: string[]
          }) => {
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
              if (Number(typed.domain.chainId) !== 421614)
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
        },
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
          if (mode === 'slow-history')
            await new Promise((resolve) => setTimeout(resolve, 900))
          if (mode === 'delayed-history') await historyReady
          data = candles(request.req.coin, request.req.interval)
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
      if (action.type === 'order') {
        const reports = action.orders.map((order: WireOrder, index: number) => {
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
              ? `${order.t.trigger.tpsl} ${order.t.trigger.isMarket ? 'Market' : 'Limit'}`
              : 'Limit',
            isTrigger: !!order.t.trigger,
            triggerPx: order.t.trigger?.triggerPx ?? '0',
            triggerCondition: 'N/A',
            isPositionTpsl: action.grouping === 'positionTpsl',
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
      } else if (action.type === 'trailingStop') {
        data = {
          status: 'ok',
          response: { type: 'trailingStop', data: { oid: nextOid++ } },
        }
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
        pushMarket = (coin, price) => {
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
      if (s.type === 'l2Book')
        ws.send(JSON.stringify({ channel: 'l2Book', data: book(s.coin) }))
      if (s.type === 'candle')
        ws.send(
          JSON.stringify({
            channel: 'candle',
            data: candles(s.coin, s.interval).at(-1),
          }),
        )
    })
  })
  return {
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
    pushMarket: (coin: string, price: number) => pushMarket(coin, price),
    pushTrade: (coin: string, tid: number) => pushTrade(coin, tid),
  }
}

async function ready(page: Page) {
  await page.goto('/')
  await expect(page.getByText('实时连接', { exact: false })).toBeVisible()
  await page.getByRole('button', { name: '连接钱包', exact: true }).click()
  await page.getByRole('button', { name: '浏览器钱包 连接 →' }).click()
  await page.locator('header').getByRole('button', { name: '启用交易' }).click()
  await page.getByRole('button', { name: '建立连接' }).click()
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

test('连接后先读取余额，未完成查询时不提前要求启用交易', async ({ page }) => {
  const exchange = await mockExchange(page)
  const balanceQuery = exchange.pauseCashReads()
  await page.goto('/')
  await page.getByRole('button', { name: '连接钱包', exact: true }).click()
  await page.getByRole('button', { name: '浏览器钱包 连接 →' }).click()
  await expect(
    page.locator('header').getByRole('button', { name: /0x.*▾/ }),
  ).toBeVisible()
  await expect.poll(balanceQuery.reads).toBeGreaterThan(0)
  await expect(
    page.getByRole('button', { name: '启用交易', exact: true }),
  ).toHaveCount(0)
  await expect(page.getByRole('region', { name: '账户概览' })).toContainText(
    '正在读取余额',
  )
  expect(exchange.agentRegistrations()).toBe(0)
  balanceQuery.release()
  await expect(page.getByRole('region', { name: '账户概览' })).toContainText(
    '1,000.00',
  )
  await expect(
    page.locator('header').getByRole('button', { name: '启用交易' }),
  ).toBeEnabled()
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
  await expect(overview).toContainText('交易已启用')
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
    page.locator('header').getByRole('button', { name: /0x.*▾/ }),
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
  const overview = page.getByRole('region', { name: '账户概览' })
  await expect(overview).toContainText('账户核验失败')
  await expect(
    page.getByRole('button', { name: '启用交易', exact: true }),
  ).toHaveCount(0)
  fail = false
  await page.getByRole('button', { name: '刷新', exact: true }).click()
  await expect(overview).toContainText('1,000.00')
  await expect(
    page.locator('header').getByRole('button', { name: '启用交易' }),
  ).toBeEnabled()
  expect(exchange.agentRegistrations()).toBe(0)
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
  ['预测', 'BTC 达到目标价？ · Yes', '份', '20', 100000120, '0.5202'],
] as const) {
  test(`${category}市价共用滑点弹窗，设置实际限制成交价格`, async ({
    page,
  }) => {
    const { writes } = await mockExchange(page)
    await ready(page)
    await page.getByRole('button', { name: '交易市场', exact: true }).click()
    await page.getByRole('tab', { name: category, exact: true }).click()
    await page.getByRole('option', { name, exact: true }).click()
    const panel = page.getByRole('region', { name: '下单面板', exact: true })
    await panel.getByRole('tab', { name: '市价单', exact: true }).click()
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
  await mockExchange(page, 'deny-signature')
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
  await page.goto('/')
  await page.getByRole('button', { name: '连接钱包', exact: true }).click()
  await page.getByRole('button', { name: '浏览器钱包 连接 →' }).click()
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

test('账户类型取消签名或只读查看，不发送切换请求', async ({ page }) => {
  const { writes } = await mockExchange(page, 'deny-signature')
  await page.goto('/')
  const button = page.getByRole('button', { name: '账户类型', exact: true })
  await button.click()
  const dialog = page.getByRole('dialog', { name: '账户类型', exact: true })
  await expect(
    dialog.getByRole('button', { name: '确认账户类型', exact: true }),
  ).toBeDisabled()
  await dialog.getByRole('button', { name: '关闭账户类型' }).click()
  await page.getByRole('textbox', { name: '只读钱包地址' }).fill(address)
  await page.getByRole('button', { name: '查看', exact: true }).click()
  await expect(button).toContainText('手动')
  await button.click()
  await dialog
    .getByRole('radio', { name: '统一账户（推荐）', exact: true })
    .check()
  await expect(
    dialog.getByRole('button', { name: '确认账户类型', exact: true }),
  ).toBeDisabled()
  await dialog.getByRole('button', { name: '关闭账户类型' }).click()
  await page.getByRole('button', { name: '连接钱包', exact: true }).click()
  await page.getByRole('button', { name: '浏览器钱包 连接 →' }).click()
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
  await expect(page.getByLabel('BTC 减仓数量')).toHaveValue('0.001')
  await page.getByLabel('BTC 减仓数量').fill('0.0005')
  await page.getByRole('button', { name: '减仓 / 平仓', exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText('只减仓已启用')
  await confirmOrder(page)
  await expect(
    page.getByRole('cell', { name: '0.0005', exact: true }),
  ).toBeVisible()
  await page.getByRole('button', { name: '减仓 / 平仓', exact: true }).click()
  await confirmOrder(page)
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
      .getByLabel('止盈触发价（USDC，可选）')
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
  await page.locator('header').getByRole('button', { name: '启用交易' }).click()
  await page.getByRole('button', { name: '建立连接' }).click()
  await expect(
    page.getByRole('status').filter({ hasText: '签名已取消' }),
  ).toBeVisible()
  await expect(page.locator('[data-feedback="warning"]')).toContainText(
    '签名已取消',
  )
  await expect(
    page.getByRole('button', { name: '启用交易', exact: true }).first(),
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
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(
    page.getByRole('button', { name: '连接钱包', exact: true }),
  ).toBeVisible()
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
  expect(socketConnections).toHaveLength(1)
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
    .getByRole('button', { name: '取消', exact: true })
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
  await expect(connect).toHaveCSS('background-color', 'rgb(111, 222, 207)')
  const onboarding = page.getByRole('button', { name: '连接钱包开始交易' })
  await expect(onboarding).toBeEnabled()
  await onboarding.hover()
  await expect(onboarding).toHaveCSS('background-color', 'rgb(111, 222, 207)')
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
  await expect(cursor).toHaveCSS('background-color', 'rgb(242, 86, 104)')
  const box = await cursor.boundingBox()
  expect(box && box.width > 90 && box.height >= 27).toBeTruthy()
})

test('基础版完整周期、真实工具图标、指标和全屏可操作', async ({ page }) => {
  const { writes, socketConnections } = await mockExchange(page)
  await page.setViewportSize({ width: 1440, height: 1080 })
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/')
  const chart = page.getByRole('region', { name: /基础版 K 线图，已加载/ })
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
  await page.getByRole('checkbox', { name: '成交量 VOL' }).uncheck()
  await expect
    .poll(() => chart.locator('canvas').count())
    .toBeLessThan(canvasCount)
  await page.getByRole('checkbox', { name: '成交量 VOL' }).check()
  await expect.poll(() => chart.locator('canvas').count()).toBe(canvasCount)
  await page.getByRole('button', { name: '基础版', exact: true }).click()
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
  expect(socketConnections).toHaveLength(1)
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
  ).toHaveCSS('color', 'rgb(242, 86, 104)')
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
  expect(socketConnections).toHaveLength(1)
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
  await page.getByRole('button', { name: /性能 ·/ }).click()
  await expect(page.getByRole('table', { name: '模块性能指标' })).toContainText(
    '订单簿数据',
  )
  await expect(page.getByRole('table', { name: '模块性能指标' })).toContainText(
    '标记价 / 市场数据',
  )
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
      await page.getByRole('button', { name: '导出指标', exact: true }).click()
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
  expect(socketConnections).toHaveLength(1)
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
  await page
    .getByRole('textbox', { name: '止盈触发价（USDC，可选）' })
    .fill('72000')
  await page
    .getByRole('textbox', { name: '止损触发价（USDC，可选）' })
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
    page.locator('output').filter({ hasText: '无法按本地编号确认' }),
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
  await page.getByRole('textbox', { name: '仓位止盈价' }).fill('72000')
  await page.getByRole('textbox', { name: '仓位止损价' }).fill('68000')
  await page.getByRole('button', { name: '预览保护单' }).click()
  await confirmOrder(page)
  await expect.poll(() => writes.at(-1)?.grouping).toBe('positionTpsl')
  expect(
    writes
      .at(-1)
      ?.orders?.every((order) => order.r && !order.b && order.s === '0.01'),
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
    await page.getByRole('tab', { name: category, exact: true }).click()
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
  await expect(panel.getByText('预测交易', { exact: true })).toBeVisible()
  await panel.getByRole('textbox', { name: '价格（USDC）' }).fill('0.5')
  await panel.getByRole('textbox', { name: '数量（份）' }).fill('100')
  await signPreview(page)
  await expect.poll(() => writes.at(-1)?.orders?.[0]?.a).toBe(100000120)
  await panel.getByRole('button', { name: 'No', exact: true }).click()
  await expect(panel).toContainText('BTC 达到目标价？ · No')
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
  expect(socketConnections).toHaveLength(3) // 一个公共行情连接；账户在默认 DEX 与 HIP-3 各一次。
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
            Math.abs(data[i] - 33) < 2 &&
            Math.abs(data[i + 1] - 193) < 2 &&
            Math.abs(data[i + 2] - 166) < 2 &&
            Math.abs(data[i + 3] - 153) < 2
          )
            sum++
        return sum
      }, 0),
    )
  await expect.poll(volumePixels).toBeGreaterThan(100)
  await page.getByRole('button', { name: '指标', exact: true }).click()
  await page.getByRole('checkbox', { name: '成交量 VOL' }).uncheck()
  await page.getByRole('checkbox', { name: '成交量 VOL' }).check()
  await page.keyboard.press('Escape')
  await expect.poll(volumePixels).toBeGreaterThan(100)
  await page.getByRole('button', { name: 'TradingView', exact: true }).click()
  const frame = page.frameLocator('iframe').first()
  await expect(frame.locator('canvas').first()).toBeVisible()
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
              Math.abs(data[i] - 26) < 2 &&
              Math.abs(data[i + 1] - 126) < 2 &&
              Math.abs(data[i + 2] - 112) < 2 &&
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
      const ctx = element.getContext('2d')
      if (!ctx) throw Error('缺少画布上下文')
      const data = ctx.getImageData(0, 0, element.width, element.height).data
      const columns = []
      for (let x = 0; x < element.width; x++) {
        let hits = 0
        for (let y = 45; y < element.height - 20; y++) {
          const i = (y * element.width + x) * 4
          if (
            data[i] < 20 &&
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
  expect(socketConnections).toHaveLength(1)
  expect(writes).toEqual([])
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
      await expect(
        panel
          .getByRole('tablist', { name: '交易方向' })
          .locator('[data-slot="cursor"]'),
      ).toHaveCSS('background-color', 'rgb(242, 86, 104)')
    }
    const base = product === 'perp' ? 'BTC' : product === 'spot' ? 'HYPE' : '份'
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
    const amount = panel.getByRole('textbox', { name: '金额（USDC）' })
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
    .getByRole('tab', { name: outcome ? '预测' : '现货', exact: true })
    .click()
  await page
    .getByRole('option', {
      name: outcome ? 'BTC 达到目标价？ · Yes' : 'HYPE / USDC',
      exact: true,
    })
    .click()
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
    await trigger.click()
    await expect(menu.getByRole('menuitemradio')).toHaveCount(1)
    await expect(
      menu.getByRole('menuitemradio', { name: '阶梯单', exact: true }),
    ).toBeVisible()
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
  await selectAdvanced(page, '阶梯单')
  await page.getByRole('textbox', { name: '最低价格（USDC）' }).fill('0.33333')
  const upper = page.getByRole('textbox', { name: '最高价格（USDC）' })
  await upper.fill('1')
  await page.getByRole('textbox', { name: '阶梯档数（2–50）' }).fill('3')
  const quantity = page.getByRole('textbox', { name: '数量（份）' })
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

test('性能面板鼠标开关无自动描边，键盘焦点仍清晰可见', async ({ page }) => {
  await mockExchange(page)
  await page.goto('/')
  const trigger = page.getByRole('button', { name: /性能 ·/ })
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
  await page.route('https://dev.indexer.api.across.to/**', (route) =>
    route.fulfill({
      json: credited
        ? [{ depositTxnRef: depositHash, originChainId: 421614, nonce: '123' }]
        : [],
    }),
  )
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
                time: Date.now(),
                hash: `0x${'dd'.repeat(32)}`,
                delta: {
                  type: 'send',
                  destination: address,
                  user: '0x2222222222222222222222222222222222222222',
                  nonce: 123,
                  token: 'USDC:0xabc',
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

test('Web3 存款：切换测试链、一次点击连续授权和存款、核对到账后启用交易', async ({
  page,
}) => {
  await mockExchange(page)
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
    dialog.getByText('源链已确认 · 等待 Hyperliquid 到账'),
  ).toBeVisible()
  expect(funds.transactions).toHaveLength(2)
  expect(funds.transactions[1].to.toLowerCase()).toBe(
    '0x8fe6b999dc680ccfdd5bf7eb0974218be2542daa',
  )
  funds.setCredited()
  await dialog.getByRole('button', { name: '核对资金状态' }).click()
  await expect(
    dialog.getByText('源链已确认 · 等待 Hyperliquid 到账'),
  ).toBeVisible()
  funds.setLedger()
  await dialog.getByRole('button', { name: '核对资金状态' }).click()
  await expect(dialog.getByText('Hyperliquid 到账已核验')).toBeVisible()
  await page.screenshot({
    path: 'output-tdd/playwright/web3-onboarding/deposit-credited.png',
  })
  await dialog.getByRole('button', { name: '关闭钱包面板' }).click()
  await page
    .getByRole('button', { name: '启用交易', exact: true })
    .first()
    .click()
  await page.getByRole('button', { name: '建立连接' }).click()
  await expect(
    page.getByRole('button', { name: '下单', exact: true }),
  ).toBeEnabled()
})

test('Web3 未知资金结果刷新后保留保护且不会自动重发', async ({ page }) => {
  await mockExchange(page)
  const funds = await mockFunding(page, { lost: true })
  await openFunds(page)
  await page.getByLabel('存款金额（USDC）').fill('10')
  await page
    .getByRole('dialog')
    .getByRole('button', { name: '存款', exact: true })
    .click()
  await expect(
    page.getByText('结果未知，请核对钱包记录，勿重复提交'),
  ).toBeVisible()
  await page.reload()
  await page.getByRole('button', { name: '连接钱包', exact: true }).click()
  await page.getByRole('button', { name: '浏览器钱包 连接 →' }).click()
  await page
    .locator('header')
    .getByRole('button', { name: '存款', exact: true })
    .click()
  await expect(
    page.getByRole('button', { name: '资金请求待确认' }),
  ).toBeDisabled()
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

test('Web3 多钱包发现不会自动连接，用户选择后才请求地址', async ({ page }) => {
  await mockExchange(page)
  await mockFunding(page)
  await page.addInitScript(() => {
    const ethereum = window.ethereum
    if (!ethereum) throw new Error('Missing mock wallet')
    for (const name of ['MetaMask', 'Rabby']) {
      const provider = {
        ...ethereum,
        request: async (params: { method: string; params?: unknown[] }) => {
          if (params.method === 'eth_requestAccounts')
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
    page
      .locator('header')
      .getByRole('button', { name: '连接钱包', exact: true }),
  ).toBeVisible()
})

test('Web3 统一账户不能误用独立账户划转', async ({ page }) => {
  const { writes } = await mockExchange(page)
  await mockFunding(page)
  await page.route(
    'https://api.hyperliquid-testnet.xyz/info',
    async (route) => {
      if (route.request().postDataJSON().type === 'userAbstraction')
        await route.fulfill({ json: 'unifiedAccount' })
      else await route.fallback()
    },
  )
  await openFunds(page)
  await openFundOperation(page, '划转')
  await expect(
    page.getByText(
      '当前为统一账户或组合保证金模式，资金共享。请在官方测试网页管理资金。',
    ),
  ).toBeVisible()
  await expect(page.getByRole('button', { name: '确认划转' })).toHaveCount(0)
  expect(writes).toHaveLength(0)
})

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
    page.getByRole('button', { name: '连接钱包开始交易' }),
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
    expect(request.method).toBe('eth_gasPrice')
    await route.fulfill({
      json: {
        jsonrpc: '2.0',
        id: request.id,
        result: `0x${gasPrice.toString(16)}`,
      },
    })
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
    if (!route.request().url().includes('direction=out'))
      return route.fallback()
    await route.fulfill({
      json:
        indexed && writes[0]
          ? [
              {
                nonce: String(writes[0].nonce),
                destinationChainId: 421614,
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
          logs: received ? [log] : [],
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
  await dialog.getByRole('button', { name: '核对资金状态' }).click()
  await expect(
    dialog.getByText('目标链交易已找到 · 等待到账核验'),
  ).toBeVisible()
  await expect(dialog.getByText('Arbitrum Sepolia 到账已核验')).toHaveCount(0)
  funds.receive()
  await dialog.getByRole('button', { name: '核对资金状态' }).click()
  await expect(dialog.getByText('Arbitrum Sepolia 到账已核验')).toBeVisible()
  await expect(
    dialog.getByRole('link', { name: /查看链上交易/ }),
  ).toHaveAttribute('href', /^https:\/\/sepolia.arbiscan.io\/tx\/0x/)
})

test('Web3 提款未知响应刷新后保留保护，按 nonce 恢复查询且不自动重发', async ({
  page,
}) => {
  await mockExchange(page)
  await mockFunding(page)
  const funds = await mockWithdrawal(page, 'lost')
  await openFunds(page)
  const dialog = await fillWithdrawal(page)
  await dialog.getByRole('button', { name: '提现至 Arbitrum Sepolia' }).click()
  await expect(
    dialog.getByText('结果未知，请核对钱包记录，勿重复提交'),
  ).toBeVisible()
  await page.reload()
  await openFunds(page)
  await openFundOperation(page, '提款')
  await expect(dialog.getByLabel('提款金额（USDC）')).toBeDisabled()
  expect(funds.writes).toHaveLength(1)
  funds.index()
  funds.receive()
  await dialog.getByRole('button', { name: '核对资金状态' }).click()
  await expect(dialog.getByText('Arbitrum Sepolia 到账已核验')).toBeVisible()
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
  await page.locator('header').getByRole('button', { name: '启用交易' }).click()
  const dialog = page.getByRole('dialog')
  await expect(
    dialog.getByRole('heading', { name: '存款', exact: true }),
  ).toBeVisible()
  await dialog.getByLabel('存款金额（USDC）').fill('10')
  await expect(
    dialog.getByRole('button', { name: '需要 Arbitrum Sepolia ETH' }),
  ).toBeDisabled()
  await expect(dialog.getByText(/源链 ETH 余额为 0/)).toBeVisible()
  expect(exchangeWrites).toBe(0)
  expect(
    await page.evaluate(() => localStorage.getItem('test-sign-count')),
  ).toBeNull()
  await page.screenshot({
    path: 'output-tdd/playwright/deposit-gate/needs-gas.png',
  })
  exists = true
  await dialog.getByRole('button', { name: '关闭钱包面板' }).click()
  await page.locator('header').getByRole('button', { name: '启用交易' }).click()
  await expect(page.getByRole('dialog', { name: '启用交易' })).toBeVisible()
  await page.getByRole('button', { name: '建立连接' }).click()
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
  await page.locator('header').getByRole('button', { name: '启用交易' }).click()
  await page.getByRole('button', { name: '建立连接' }).click()
  await expect(
    page
      .getByRole('dialog')
      .getByRole('heading', { name: '存款', exact: true }),
  ).toBeVisible()
  await expect(
    page
      .getByRole('region', { name: '全局通知' })
      .getByText(
        'Hyperliquid 测试网账户尚未激活。请先存入测试 USDC 并等待到账，再启用交易。',
        { exact: true },
      ),
  ).toBeVisible()
  expect(attempts).toBe(1)
  await page.getByRole('button', { name: '关闭钱包面板' }).click()
  await expect(
    page.getByRole('button', { name: '启用交易', exact: true }).first(),
  ).toBeEnabled()
})

test('Web3 独立资金弹窗：入口直达、无钱包 Tab，FameEX 下拉完整可见，关闭不签名', async ({
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
      await page.screenshot({
        path: `output-tdd/playwright/funding-dialogs/${name}-asset-open.png`,
      })
      await page.getByRole('option', { name: 'USDC', exact: true }).click()
      const trigger = dialog.getByRole('button', {
        name: /Arbitrum Sepolia · 测试网/,
      })
      await trigger.focus()
      await page.keyboard.press('Enter')
      await expect(
        page.getByRole('option', {
          name: 'Arbitrum Sepolia · 测试网',
          exact: true,
        }),
      ).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(trigger).toBeFocused()
    }
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
  await dialog.getByRole('button', { name: '刷新余额' }).click()
  await expect(dialog.getByText(/0\.00004000 HYPE/)).toBeVisible()
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
    page.getByRole('dialog').getByRole('heading', { name: '连接钱包' }),
  ).toBeVisible()
  await page.getByRole('button', { name: '浏览器钱包 连接 →' }).click()
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
  await expect(
    dialog.getByText('结果未知，请核对钱包记录，勿重复提交'),
  ).toHaveCount(0)
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
    page.getByRole('button', { name: '启用交易', exact: true }).first(),
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

test('交易连接默认仅标签页保存；保持连接须主动勾选，断开清除凭据', async ({
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
  await page.locator('header').getByRole('button', { name: /0x.*▾/ }).click()
  await page.getByRole('button', { name: '断开钱包', exact: true }).click()
  expect(await storageState()).toEqual({ session: false, persistent: false })
  await page.getByRole('button', { name: '连接钱包', exact: true }).click()
  await page.getByRole('button', { name: '浏览器钱包 连接 →' }).click()
  await page.locator('header').getByRole('button', { name: '启用交易' }).click()
  await expect(page.getByRole('dialog', { name: '启用交易' })).toHaveCSS(
    'opacity',
    '1',
  )
  await page.screenshot({
    path: 'output-tdd/playwright/trading-flow-audit/enable-trading.png',
    animations: 'disabled',
  })
  await page.getByRole('checkbox', { name: '保持连接', exact: true }).check()
  await page.getByRole('button', { name: '建立连接' }).click()
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
  await page.locator('header').getByRole('button', { name: /0x.*▾/ }).click()
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
    page.locator('header').getByRole('button', { name: '启用交易' }),
  ).toBeVisible()
  expect(
    await page.evaluate(
      () => !!sessionStorage.getItem('hl-testnet-trading-connection-v1'),
    ),
  ).toBe(false)
  expect(exchange.agentRegistrations()).toBe(1)
  expect(exchange.writes).toHaveLength(0)
})

test('已启用连接被交易所拒绝后回到待启用状态，不保留错误连接或待确认锁', async ({
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
    page.locator('header').getByRole('button', { name: '启用交易' }),
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

test('开仓与平仓确认偏好相互独立，账户面板可恢复确认', async ({ page }) => {
  const exchange = await mockExchange(page)
  await ready(page)
  await page.getByRole('tab', { name: '市价单', exact: true }).click()
  await page.getByLabel('数量（BTC）', { exact: true }).fill('0.001')
  await page.getByRole('button', { name: '下单', exact: true }).click()
  await page.screenshot({
    path: 'output-tdd/playwright/trading-flow-audit/order-confirmation.png',
    animations: 'disabled',
  })
  await page.getByRole('checkbox', { name: '不再显示此消息' }).check()
  await confirmOrder(page)
  await expect(page.getByLabel('BTC 减仓数量')).toHaveValue('0.001')
  await page.getByLabel('BTC 减仓数量').fill('0.0005')
  await page.getByRole('button', { name: '减仓 / 平仓', exact: true }).click()
  await expect(
    page.getByRole('dialog', { name: '确认减仓 / 平仓' }),
  ).toBeVisible()
  await page.getByRole('checkbox', { name: '不再显示此消息' }).check()
  await confirmOrder(page)
  await expect(
    page.getByRole('cell', { name: '0.0005', exact: true }),
  ).toBeVisible()
  await page.getByRole('button', { name: '减仓 / 平仓', exact: true }).click()
  await expect(page.getByText('暂无记录', { exact: true })).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(exchange.writes).toHaveLength(3)
  expect(
    await page.evaluate(() => sessionStorage.getItem('mock-wallet-signs')),
  ).toBe('1')
  await page.locator('header').getByRole('button', { name: /0x.*▾/ }).click()
  await page.getByRole('button', { name: '恢复下单和平仓确认' }).click()
  await expect(
    page.getByRole('button', { name: '已恢复订单确认' }),
  ).toBeVisible()
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
  await expect(notices).toContainText('交易已启用')
  await expect(notices.locator('[data-feedback="success"]')).toBeVisible()
  const chart = page.getByRole('region', { name: '行情图表', exact: true })
  const before = await chart.boundingBox()
  await notices.getByRole('button', { name: '关闭提示' }).click()
  await expect(notices).toHaveCount(0)
  expect(await chart.boundingBox()).toEqual(before)
})

test('钱包连接等待原生权限确认，拒绝可重试，成功后不自动签名或下单', async ({
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
        if (params.method !== 'eth_requestAccounts') return request(params)
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
              else resolve(['0x1111111111111111111111111111111111111111'])
            },
            { once: true },
          )
        })
      },
    })
  })
  await page.getByRole('button', { name: '连接钱包', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '连接钱包', exact: true })
  await dialog.getByRole('button', { name: '浏览器钱包 连接 →' }).click()
  await expect(dialog.getByRole('status')).toContainText(
    '请在浏览器钱包中确认连接',
  )
  await expect(
    dialog.getByText('连接不会提交订单或转移资金。', { exact: true }),
  ).toBeVisible()
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
    page.locator('header').getByRole('button', { name: '启用交易' }),
  ).toBeVisible()
  expect(
    await page.evaluate(() => sessionStorage.getItem('test-connect-requests')),
  ).toBe('2')
  expect(
    await page.evaluate(() => sessionStorage.getItem('mock-wallet-signs')),
  ).toBeNull()
  expect(exchange.agentRegistrations()).toBe(0)
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
  await expect(page.getByRole('region', { name: '账户概览' })).toContainText(
    '已连接 · 待启用交易',
  )
  await page.locator('header').getByRole('button', { name: '启用交易' }).click()
  const dialog = page.getByRole('dialog', { name: '启用交易', exact: true })
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText('与账户是否曾交易无关')
  await expect(
    page.getByRole('dialog', { name: '存款', exact: true }),
  ).toHaveCount(0)
  expect(exchange.agentRegistrations()).toBe(1)
  expect(
    await page.evaluate(() => sessionStorage.getItem('mock-wallet-signs')),
  ).toBe('1')
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
        if (params.method !== 'eth_requestAccounts') return request(params)
        throw { code: -32002, message: 'Request already pending' }
      },
    })
  })
  await page.getByRole('button', { name: '连接钱包', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '连接钱包', exact: true })
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
  await page.getByRole('textbox', { name: '只读钱包地址' }).fill('invalid')
  await page.getByRole('button', { name: '查看', exact: true }).click()
  await expect(notices.locator('output')).toHaveCount(3)
  await page.route('**/info', async (route) => {
    if (route.request().postDataJSON()?.type === 'clearinghouseState')
      await route.fulfill({ status: 503, body: 'Service unavailable' })
    else await route.fallback()
  })
  await page.getByRole('button', { name: '刷新', exact: true }).click()
  await expect(notices).toContainText('账户查询失败')
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
    color: 'rgb(225, 236, 236)',
    background: 'rgb(35, 47, 53)',
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
  await expect(submit).toHaveCSS('background-color', 'rgb(242, 86, 104)')
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
  await expect(submit).toHaveCSS('color', 'rgb(15, 26, 31)')
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
