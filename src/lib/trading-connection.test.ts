import assert from 'node:assert/strict'
import test from 'node:test'
import {
  loadTradingConnection,
  nextTradingNonce,
  parseTradingConnection,
  saveTradingConnection,
  setTradingConnectionDisconnected,
  tradingConnectionKey,
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
    { disconnected: 'false' },
  ])
    assert.equal(
      parseTradingConnection(JSON.stringify({ ...saved, ...patch })),
      null,
    )
  for (const raw of [null, '{', 'null', '[]', '42'])
    assert.equal(parseTradingConnection(raw), null)
})

for (const persist of [false, true]) {
  test(`断开保留${persist ? '持久' : '标签页'}凭据但标记暂停；同账户恢复不生成新密钥`, (t) => {
    const storage = () => {
      const values = new Map<string, string>()
      return {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key),
      }
    }
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'window')
    const stores = { sessionStorage: storage(), localStorage: storage() }
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: stores,
    })
    try {
      const saved = {
        version: 1 as const,
        network: 'hyperliquid-testnet' as const,
        account: `0x${'1'.repeat(40)}` as const,
        privateKey: `0x${'2'.repeat(64)}` as const,
        expiresAt: Date.now() + 60000,
        providerId: 'injected',
        providerName: '测试钱包',
      }
      assert.equal(saveTradingConnection(saved, persist), true)
      assert.equal(setTradingConnectionDisconnected(saved.account, true), true)
      assert.deepEqual(loadTradingConnection(), {
        ...saved,
        disconnected: true,
      })
      assert.equal(
        setTradingConnectionDisconnected(`0x${'3'.repeat(40)}`, false),
        false,
      )
      assert.equal(loadTradingConnection()?.disconnected, true)
      assert.equal(setTradingConnectionDisconnected(saved.account, false), true)
      assert.deepEqual(loadTradingConnection(), {
        ...saved,
        disconnected: false,
      })
      const target = persist ? stores.localStorage : stores.sessionStorage
      const other = persist ? stores.sessionStorage : stores.localStorage
      assert.equal(other.getItem(tradingConnectionKey), null)
      t.mock.method(target, 'setItem', () => {
        throw new Error('QuotaExceededError')
      })
      assert.equal(setTradingConnectionDisconnected(saved.account, true), false)
      assert.equal(loadTradingConnection(), null)
    } finally {
      if (descriptor) Object.defineProperty(globalThis, 'window', descriptor)
      else Reflect.deleteProperty(globalThis, 'window')
    }
  })
}

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
