import assert from 'node:assert/strict'
import test from 'node:test'
import type { EIP1193Provider } from 'viem'
import { assertDepositSession } from './funding.ts'
import { assertSession, connectWallet } from './hyperliquid.ts'

const address = '0x1111111111111111111111111111111111111111'
function provider(accounts: () => Promise<`0x${string}`[]>, chain = '0x66eee') {
  return {
    request: async ({ method }: { method: string }) =>
      method === 'eth_chainId'
        ? chain
        : method === 'wallet_requestPermissions'
          ? [{ parentCapability: 'eth_accounts' }]
          : accounts(),
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

test('每次手动连接均请求原生账户权限，确认后读地址；静默恢复不弹权限', async () => {
  const requests: { method: string; params?: unknown }[] = []
  let permissionsGranted = false
  const wallet = {
    ...provider(async () => [address]),
    request: async (request: { method: string; params?: unknown }) => {
      requests.push(request)
      if (request.method === 'wallet_requestPermissions') {
        assert.deepEqual(request.params, [{ eth_accounts: {} }])
        permissionsGranted = true
        return [{ parentCapability: 'eth_accounts' }]
      }
      assert.equal(request.method, 'eth_accounts')
      assert.equal(permissionsGranted, true)
      return [address]
    },
  } as EIP1193Provider
  const session = await connectWallet(wallet)
  assert.equal(session.address, address)
  assert.equal(session.exchange, null)
  await connectWallet(wallet)
  await connectWallet(wallet, true)
  assert.deepEqual(
    requests.map(({ method }) => method),
    [
      'wallet_requestPermissions',
      'eth_accounts',
      'wallet_requestPermissions',
      'eth_accounts',
      'eth_accounts',
    ],
  )
})

for (const code of [4001, 4100, -32002, -32603]) {
  test(`权限拒绝、待确认或失败 ${code} 不得绕过权限读取账户或签名`, async () => {
    const methods: string[] = []
    const wallet = {
      ...provider(async () => [address]),
      request: async ({ method }: { method: string }) => {
        methods.push(method)
        throw { code, message: 'Permission request failed' }
      },
    } as EIP1193Provider
    await assert.rejects(() => connectWallet(wallet), { code })
    assert.deepEqual(methods, ['wallet_requestPermissions'])
  })
}

for (const code of [4200, -32601]) {
  test(`仅钱包不支持原生权限接口 ${code} 时回退标准连接请求`, async () => {
    const methods: string[] = []
    const wallet = {
      ...provider(async () => [address]),
      request: async ({ method }: { method: string }) => {
        methods.push(method)
        if (method === 'wallet_requestPermissions') throw { code }
        assert.equal(method, 'eth_requestAccounts')
        return [address]
      },
    } as EIP1193Provider
    assert.equal((await connectWallet(wallet)).address, address)
    assert.deepEqual(methods, [
      'wallet_requestPermissions',
      'eth_requestAccounts',
    ])
  })
}

test('没有授予 eth_accounts 时停止连接，不把空权限当成同意', async () => {
  const methods: string[] = []
  const wallet = {
    ...provider(async () => [address]),
    request: async ({ method }: { method: string }) => {
      methods.push(method)
      return []
    },
  } as EIP1193Provider
  await assert.rejects(() => connectWallet(wallet), /账户访问权限/)
  assert.deepEqual(methods, ['wallet_requestPermissions'])
})
