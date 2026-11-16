import assert from 'node:assert/strict'
import test from 'node:test'
import { internalTransferAmount, transferToken } from './internal-transfer.ts'

const catalog = {
  tokens: [
    {
      index: 0,
      name: 'USDC',
      tokenId: '0x00000000000000000000000000000000',
      weiDecimals: 8,
    },
    {
      index: 9,
      name: 'ALT',
      tokenId: '0x11111111111111111111111111111111',
      weiDecimals: 8,
    },
  ],
  venues: [
    { dex: '', token: 0 },
    { dex: 'test', token: 0 },
    { dex: 'alt', token: 9 },
  ],
}
test('HIP-3 划转只使用源和目标共同支持的抵押币，保留原始 tokenId 与精度', () => {
  const route = { sourceDex: 'spot', destinationDex: 'alt', token: 9 }
  const token = transferToken(catalog, route)
  assert.equal(token.tokenId, catalog.tokens[1].tokenId)
  assert.equal(internalTransferAmount('1.12345678', '2', token), '1.12345678')
  assert.throws(() => internalTransferAmount('1.123456789', '2', token), /精度/)
  for (const balance of ['2', 'Infinity', 'NaN', '-1'])
    assert.throws(() => internalTransferAmount('3', balance, token), /余额/)
  for (const amount of ['0', '-1', '1e2', 'NaN'])
    assert.throws(() => internalTransferAmount(amount, '100', token))
  assert.throws(
    () => transferToken(catalog, { ...route, sourceDex: '' }),
    /抵押币/,
  )
  assert.throws(
    () => transferToken(catalog, { ...route, destinationDex: 'missing' }),
    /DEX/,
  )
  assert.throws(
    () => transferToken(catalog, { ...route, destinationDex: 'spot' }),
    /相同/,
  )
})

test('新版划转记录保留币种精度、路由与 nonce，异常记录不能恢复', async () => {
  const { parseFundingRecord } = await import('./funding.ts')
  const account = `0x${'11'.repeat(20)}`
  const record = {
    account,
    kind: 'transfer',
    amount: '1.12345678',
    token: 'ALT',
    decimals: 8,
    sourceDex: 'spot',
    destinationDex: 'alt',
    nonce: 123,
    at: 123,
    status: 'unknown',
  }
  assert.deepEqual(parseFundingRecord(JSON.stringify(record), account), record)
  for (const changed of [
    { decimals: 6 },
    { nonce: -1 },
    { sourceDex: null },
    { destinationDex: 'spot' },
    { token: '' },
  ])
    assert.throws(() =>
      parseFundingRecord(JSON.stringify({ ...record, ...changed }), account),
    )
})
