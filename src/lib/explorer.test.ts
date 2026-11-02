import assert from 'node:assert/strict'
import test from 'node:test'
import { transactionUrl } from './explorer.ts'
import { fundingCountdown } from './market-summary.ts'

test('成交链接仅接受真实格式的非零哈希，固定测试网', () => {
  assert.equal(
    transactionUrl(`0x${'ab'.repeat(32)}`),
    `https://app.hyperliquid-testnet.xyz/explorer/tx/0x${'ab'.repeat(32)}`,
  )
  for (const bad of [
    undefined,
    '',
    'javascript:alert(1)',
    '0x1234',
    `0x${'0'.repeat(64)}`,
  ])
    assert.equal(transactionUrl(bad), null)
})
test('资金费率倒计时跨小时重置', () => {
  assert.equal(fundingCountdown(0), '01:00:00')
  assert.equal(fundingCountdown(3599000), '00:00:01')
  assert.equal(fundingCountdown(3600000), '01:00:00')
})
