import assert from 'node:assert/strict'
import test from 'node:test'
import { marketMetadata } from './market-metadata.ts'

test('metadata follows the selected pair, product, language and live price', () => {
  const meta = marketMetadata('BTC / USDC', 'perp', '79423.5', 'zh-CN')
  assert.match(meta.title, /79,423.5.*BTC \/ USDC.*永续/)
  assert.match(
    marketMetadata('HYPE / USDC', 'spot', '20', 'en-US').title,
    /HYPE \/ USDC.*Spot/,
  )
  assert.doesNotMatch(
    marketMetadata('ETH / USDC', 'perp', undefined, 'en-US').title,
    /79,423|undefined|NaN/,
  )
  assert.match(meta.description, /测试网/)
})
