import assert from 'node:assert/strict'
import test from 'node:test'
import {
  nextTradingNonce,
  parseTradingConnection,
} from './trading-connection.ts'

test('交易连接只接受当前测试网、有效账户、密钥格式和未过期记录', () => {
  const saved = {
    version: 1,
    network: 'hyperliquid-testnet',
    account: `0x${'1'.repeat(40)}`,
    privateKey: `0x${'2'.repeat(64)}`,
    expiresAt: Date.now() + 60000,
    providerId: 'injected',
    providerName: '测试钱包',
  }
  assert.ok(parseTradingConnection(JSON.stringify(saved)))
  for (const patch of [
    { network: 'mainnet' },
    { version: 2 },
    { account: 'invalid' },
    { privateKey: 'invalid' },
    { expiresAt: Date.now() - 1 },
    { expiresAt: Infinity },
    { providerId: '' },
    { providerName: null },
  ])
    assert.equal(
      parseTradingConnection(JSON.stringify({ ...saved, ...patch })),
      null,
    )
  for (const raw of [null, '{', 'null', '[]', '42'])
    assert.equal(parseTradingConnection(raw), null)
})

test('同一交易连接并发请求与刷新后 nonce 不重复，异常序号拒绝发送', async (t) => {
  const values = new Map<string, string>()
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    },
  })
  t.mock.method(Date, 'now', () => 1800000000000)
  try {
    const nonces = await Promise.all(
      Array.from({ length: 50 }, () => nextTradingNonce('0xTEST')),
    )
    assert.equal(new Set(nonces).size, 50)
    assert.equal(await nextTradingNonce('0xtest'), Math.max(...nonces) + 1)
    values.set('hl-testnet-nonce:0xtest', 'bad')
    await assert.rejects(nextTradingNonce('0xtest'), /序号异常/)
  } finally {
    if (descriptor)
      Object.defineProperty(globalThis, 'localStorage', descriptor)
    else Reflect.deleteProperty(globalThis, 'localStorage')
  }
})
