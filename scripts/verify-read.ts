import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { SubscriptionClient, WebSocketTransport } from '@nktkas/hyperliquid'
import {
  loadTransferCatalog,
  transferToken,
} from '../src/features/assets/lib/internal-transfer.ts'
import { isPrelaunch } from '../src/features/market/lib/market-catalog.ts'
import { supportedOrderKinds } from '../src/features/trading/lib/order-ticket.ts'
import {
  formatOrderPrice,
  Money,
  prepareOrder,
} from '../src/features/trading/lib/orders.ts'
import {
  API_URL,
  addressOf,
  info,
  loadAccount,
  loadMarketCatalog,
  loadMarkets,
  WS_URL,
} from '../src/shared/lib/fameex-testnet.ts'

// 此脚本只发 /info 查询与行情订阅，不接受密钥，也不调用 /exchange。
const markets = await loadMarkets()
const catalog = await loadMarketCatalog()
const dexes = await info.perpDexs()
const transfers = await loadTransferCatalog()
for (const venue of transfers.venues)
  transferToken(transfers, {
    sourceDex: 'spot',
    destinationDex: venue.dex,
    token: venue.token,
  })
const representatives = [
  ['合约', markets.find((m) => m.name === 'BTC')],
  [
    '现货',
    catalog.find(
      (m) => m.kind === 'spot' && m.base === 'HYPE' && m.quoteToken === 0,
    ),
  ],
  ['HIP-3', catalog.find((m) => m.name === 'test:ABC')],
  [
    '预测 / HIP-4',
    catalog
      .filter((m) => m.kind === 'outcome' && !m.settled && !m.fallback)
      .sort(
        (a, b) => Number(b.context.dayNtlVlm) - Number(a.context.dayNtlVlm),
      )[0],
  ],
  [
    '预上线',
    markets.find((m) => isPrelaunch(m) && m.name === 'HYPE') ??
      markets.find(isPrelaunch),
  ],
] as const
const productChecks = []
for (const [product, selected] of representatives) {
  assert(selected, `测试网缺少${product}样本`)
  if (selected.dex) {
    const dexIndex = dexes.findIndex((dex) => dex?.name === selected.dex)
    const meta = await info.meta({ dex: selected.dex })
    const index = meta.universe.findIndex((m) => m.name === selected.name)
    assert(dexIndex > 0 && index >= 0)
    assert.equal(selected.asset, 100000 + dexIndex * 10000 + index)
  }
  const book = await info.l2Book({ coin: selected.name })
  assert(book && book.coin === selected.name, `${product}订单簿代码不匹配`)
  const reference =
    book.levels[1][0]?.px ?? book.levels[0][0]?.px ?? selected.context.markPx
  assert(reference && new Money(reference).gt(0), `${product}没有可验证的报价`)
  const price = formatOrderPrice(reference, selected)
  const size = new Money(20)
    .div(price)
    .toDecimalPlaces(selected.szDecimals, Money.ROUND_CEIL)
    .toFixed()
  const orders = (['buy', 'sell'] as const).map((side) =>
    prepareOrder({
      market: selected,
      side,
      kind: 'limit',
      price,
      size,
      reduceOnly: false,
      slippageBps: 50,
    }),
  )
  assert(
    orders.every((order) => order.a === selected.asset && order.r === false),
  )
  productChecks.push({
    product,
    coin: selected.name,
    asset: selected.asset,
    szDecimals: selected.szDecimals,
    quote: selected.quote,
    marginMode: selected.marginMode,
    orderTypes: supportedOrderKinds(selected).map(([kind]) => kind),
    bookTime: book.time,
    bookLevels: book.levels.map((side) => side.length),
    unsignedOrders: orders,
    exchangeAccepted: false,
  })
}
const market = markets.find((m) => m.name === 'BTC')
assert(market, '测试网缺少 BTC 市场')
const [book, candles] = await Promise.all([
  info.l2Book({ coin: market.name }),
  info.candleSnapshot({
    coin: market.name,
    interval: '5m',
    startTime: Date.now() - 86400000,
  }),
])
assert(
  book &&
    book.coin === market.name &&
    book.levels.every((side) => side.length > 0),
)
assert(Date.now() - book.time < 30000, '订单簿时间戳已过期')
assert(
  candles.length > 10 &&
    candles.every((c) => c.s === market.name && c.i === '5m'),
)
const transport = new WebSocketTransport({ isTestnet: true, url: WS_URL })
const sub = new SubscriptionClient({ transport })
let liveBook: typeof book | undefined
try {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('30 秒内没有收到测试网订单簿推送')),
      30000,
    )
    void sub
      .l2Book({ coin: market.name }, (data) => {
        if (
          !data ||
          data.coin !== market.name ||
          !data.levels.every((side) => side.length > 0)
        )
          return
        liveBook = data
        clearTimeout(timer)
        resolve()
      })
      .catch((error) => {
        clearTimeout(timer)
        reject(error)
      })
  })
} finally {
  transport.close()
}
const account = process.argv[2]
  ? await loadAccount(addressOf(process.argv[2]))
  : null
const evidence = {
  capturedAt: new Date().toISOString(),
  network: 'hyperliquid-testnet',
  apiUrl: API_URL,
  checks: {
    marketMetadata: true,
    orderbookHttp: true,
    candleHistory: true,
    orderbookWebSocket: true,
    accountRead: !!account,
    exchangeWrites: false,
    transferRoutes: true,
  },
  market: {
    name: market.name,
    asset: market.asset,
    szDecimals: market.szDecimals,
  },
  productChecks,
  transferCatalog: transfers,
  candles: candles.length,
  httpBook: book,
  webSocketBook: liveBook,
  account,
}
await mkdir('output-tdd/fameex-testnet', { recursive: true })
await writeFile(
  'output-tdd/fameex-testnet/read-only.json',
  JSON.stringify(evidence, null, 2),
)
console.log(
  JSON.stringify({
    checks: evidence.checks,
    market: evidence.market,
    productChecks,
    candles: candles.length,
    evidence: 'output-tdd/fameex-testnet/read-only.json',
  }),
)
