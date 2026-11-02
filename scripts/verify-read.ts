import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { SubscriptionClient, WebSocketTransport } from '@nktkas/hyperliquid'
import {
  API_URL,
  addressOf,
  info,
  loadAccount,
  loadMarkets,
  WS_URL,
} from '../src/lib/hyperliquid.ts'

// 此脚本只发 /info 查询与行情订阅，不接受密钥，也不调用 /exchange。
const markets = await loadMarkets()
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
  },
  market: {
    name: market.name,
    asset: market.asset,
    szDecimals: market.szDecimals,
  },
  candles: candles.length,
  httpBook: book,
  webSocketBook: liveBook,
  account,
}
await mkdir('output-tdd/hyperliquid', { recursive: true })
await writeFile(
  'output-tdd/hyperliquid/read-only.json',
  JSON.stringify(evidence, null, 2),
)
console.log(
  JSON.stringify({
    checks: evidence.checks,
    market: evidence.market,
    candles: candles.length,
    evidence: 'output-tdd/hyperliquid/read-only.json',
  }),
)
