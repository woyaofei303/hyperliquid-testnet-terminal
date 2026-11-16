import assert from 'node:assert/strict'
import { test } from 'node:test'
import { loadPairingOrigin, pairingOrigin } from './runtime-config.ts'

test('配对配置必须明确启用，正式站只使用自身 HTTPS 来源', () => {
  const enabled = { schemaVersion: 1, phonePairingEnabled: true }
  assert.equal(
    pairingOrigin(enabled, 'https://app.fameex-testnet.xyz'),
    'https://app.fameex-testnet.xyz',
  )
  assert.equal(
    pairingOrigin(enabled, 'http://127.0.0.1:33211'),
    'http://127.0.0.1:33211',
  )
  for (const value of [
    null,
    {},
    { ...enabled, schemaVersion: 2 },
    { ...enabled, phonePairingEnabled: false },
    { ...enabled, phonePairingEnabled: 'true' },
  ]) {
    assert.throws(() =>
      pairingOrigin(value, 'https://staging-app.fameex-testnet.xyz'),
    )
  }
  assert.throws(() => pairingOrigin(enabled, 'http://app.fameex-testnet.xyz'))
  assert.throws(() => pairingOrigin(enabled, 'https://user:secret@example.com'))
})

test('配置查询失败、重定向或非法响应不得回退到生产地址', async (t) => {
  const fetch = t.mock.method(globalThis, 'fetch')
  for (const response of [
    new Response('{}', { status: 503 }),
    new Response('{}'),
    new Response('invalid'),
  ]) {
    fetch.mock.mockImplementation(async () => response)
    await assert.rejects(
      loadPairingOrigin('https://staging-app.fameex-testnet.xyz'),
    )
  }
  fetch.mock.mockImplementation(async (url, options) => {
    assert.equal(url, 'https://app.fameex-testnet.xyz/runtime-config.json')
    assert.equal(options?.cache, 'no-store')
    assert.equal(options?.redirect, 'error')
    return Response.json({ schemaVersion: 1, phonePairingEnabled: true })
  })
  assert.equal(
    await loadPairingOrigin('https://app.fameex-testnet.xyz'),
    'https://app.fameex-testnet.xyz',
  )
})
