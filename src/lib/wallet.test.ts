import assert from 'node:assert/strict'
import test from 'node:test'
import type { EIP1193Provider } from 'viem'
import { assertDepositSession } from './funding.ts'
import { assertSession, connectWallet } from './hyperliquid.ts'

const address = '0x1111111111111111111111111111111111111111'
function provider(accounts: () => Promise<`0x${string}`[]>, chain = '0x66eee') {
  return {
    request: async ({ method }: { method: string }) =>
      method === 'eth_chainId' ? chain : accounts(),
    on() {},
    removeListener() {},
  } as EIP1193Provider
}
test('已断开及查询过程中断开的会话不可签名', async () => {
  const session = await connectWallet(provider(async () => [address]))
  await assertSession(session)
  if (session.lifecycle) session.lifecycle.active = false
  await assert.rejects(() => assertSession(session), /断开/)
  const { promise, resolve } = Promise.withResolvers<`0x${string}`[]>()
  const changed = {
    ...session,
    lifecycle: { active: true },
    provider: provider(() => promise),
  }
  const checking = assertSession(changed)
  changed.lifecycle.active = false
  resolve([address])
  await assert.rejects(() => checking, /断开/)
})
test('充值禁止主网及钱包账户变化，HyperCore 授权不强制切换 EVM 链', async () => {
  const session = await connectWallet(provider(async () => [address], '0xa4b1'))
  await assertSession(session)
  await assert.rejects(() => assertDepositSession(session), /Arbitrum Sepolia/)
  session.provider = provider(async () => [`0x${'22'.repeat(20)}`])
  await assert.rejects(() => assertDepositSession(session), /账户已变化/)
})

test('手动连接只请求账户权限，刷新只读已有账户，不请求签名或切链', async () => {
  const methods: string[] = []
  const wallet = {
    ...provider(async () => [address]),
    request: async ({ method }: { method: string }) => {
      methods.push(method)
      if (method !== 'eth_requestAccounts' && method !== 'eth_accounts')
        throw new Error(`Unexpected method: ${method}`)
      return [address]
    },
  } as EIP1193Provider
  const session = await connectWallet(wallet)
  assert.equal(session.address, address)
  assert.equal(session.exchange, null)
  assert.deepEqual(methods, ['eth_requestAccounts'])
  await connectWallet(wallet, true)
  assert.deepEqual(methods, ['eth_requestAccounts', 'eth_accounts'])
})
