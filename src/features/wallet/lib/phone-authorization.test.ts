import assert from 'node:assert/strict'
import test from 'node:test'
import {
  isUserRejection,
  type WalletSession,
} from '../../../shared/lib/fameex-testnet.ts'
import {
  assertPhoneAgentCapacity,
  PhoneApprovalBlockedError,
  phoneAgentToReplace,
  phoneApproval,
  revokePhoneAgent,
} from './phone-authorization.ts'
import { AGENT_DURATION } from './phone-pairing.ts'

test('设备撤销使用主钱包签署同名零地址，读回确认删除，不动网页代理', async (t) => {
  const device = {
    name: 'Phone-2222222222',
    address: `0x${'2'.repeat(40)}` as const,
    validUntil: Date.now() + AGENT_DURATION,
  }
  const web = { ...device, name: 'JulianTerminal' }
  let agents = [device, web]
  let signatures = 0
  let reject = false
  let remove = true
  let loseReply = false
  const wallet: WalletSession = {
    address: `0x${'1'.repeat(40)}`,
    exchange: null,
    expiresAt: 0,
    provider: {
      async request({ method }: { method: string }) {
        if (method === 'eth_accounts') return [wallet.address]
        if (method === 'eth_chainId') return '0x66eee'
        assert.equal(method, 'eth_signTypedData_v4')
        signatures++
        if (reject) throw Object.assign(new Error('用户取消'), { code: 4001 })
        return `0x${'1'.repeat(128)}1b`
      },
    } as WalletSession['provider'],
  }
  t.mock.method(
    globalThis,
    'fetch',
    async (_url: unknown, init: RequestInit) => {
      assert.equal(typeof init.body, 'string')
      const body = JSON.parse(init.body as string)
      if (body.type === 'extraAgents') return Response.json(agents)
      assert.equal(body.action.type, 'approveAgent')
      assert.equal(body.action.hyperliquidChain, 'Testnet')
      assert.equal(body.action.agentAddress, `0x${'0'.repeat(40)}`)
      assert.equal(body.action.agentName, device.name)
      if (remove) agents = [web]
      if (loseReply) throw new Error('请求中断')
      return Response.json({ status: 'ok', response: { type: 'default' } })
    },
  )
  await revokePhoneAgent(wallet, device)
  assert.equal(signatures, 1)
  assert.deepEqual(agents, [web])
  await revokePhoneAgent(wallet, device)
  assert.equal(signatures, 1, '已删除的设备不重复签名')
  await assert.rejects(revokePhoneAgent(wallet, web), /手机/)
  assert.equal(signatures, 1)
  agents = [{ ...device, address: `0x${'3'.repeat(40)}` }, web]
  await assert.rejects(revokePhoneAgent(wallet, device), /授权已变化/)
  assert.equal(signatures, 1)
  agents = [device, web]
  reject = true
  await assert.rejects(revokePhoneAgent(wallet, device), isUserRejection)
  assert.equal(signatures, 2)
  assert.equal(agents.length, 2)
  reject = false
  remove = false
  await assert.rejects(revokePhoneAgent(wallet, device), /尚未确认/)
  assert.equal(signatures, 3)
  remove = true
  loseReply = true
  await revokePhoneAgent(wallet, device)
  assert.equal(signatures, 4, '响应丢失时读回确认，不重复签名')
})

test('手机授权签名包含独立设备名与明确到期时间，拒绝超期及换账户', () => {
  const now = Date.now()
  const request = {
    account: `0x${'1'.repeat(40)}` as const,
    agentAddress: `0x${'2'.repeat(40)}` as const,
    agentName: 'Phone-2222222222',
    expiresAt: now + AGENT_DURATION,
  }
  assert.deepEqual(phoneApproval(request, request.account, now), {
    agentAddress: request.agentAddress,
    agentName: `Phone-2222222222 valid_until ${request.expiresAt}`,
  })
  assert.throws(() =>
    phoneApproval(
      { ...request, expiresAt: request.expiresAt + 30001 },
      request.account,
      now,
    ),
  )
  assert.throws(() => phoneApproval(request, request.agentAddress, now))
})

test('命名代理满额时先阻止签名，子账户提供的额外名额仍可使用', () => {
  assert.doesNotThrow(() => assertPhoneAgentCapacity(2, 0))
  assert.throws(() => assertPhoneAgentCapacity(3, 0), PhoneApprovalBlockedError)
  assert.doesNotThrow(() => assertPhoneAgentCapacity(4, 1))
  assert.throws(() => assertPhoneAgentCapacity(5, 1), /5 个上限/)
})

test('满额选择最早到期的手机；有剩余名额、过期设备及子账户不误删', async (t) => {
  const wallet: WalletSession = {
    address: `0x${'1'.repeat(40)}`,
    exchange: null,
    expiresAt: 0,
    provider: {
      async request({ method }: { method: string }) {
        assert.equal(method, 'eth_accounts')
        return [wallet.address]
      },
    } as WalletSession['provider'],
  }
  const oldest = {
    name: 'Phone-2222222222',
    address: `0x${'2'.repeat(40)}`,
    validUntil: Date.now() + 60000,
  }
  const newest = {
    name: 'Phone-3333333333',
    address: `0x${'3'.repeat(40)}`,
    validUntil: Date.now() + 120000,
  }
  const web = { ...oldest, name: 'JulianTerminal' }
  let agents = [newest, web, oldest]
  let accounts: object[] = []
  t.mock.method(
    globalThis,
    'fetch',
    async (_url: unknown, init: RequestInit) => {
      assert.equal(typeof init.body, 'string')
      const body = JSON.parse(init.body as string)
      assert.ok(
        ['extraAgents', 'subAccounts'].includes(body.type),
        '查询不能触发签名或写入',
      )
      return Response.json(body.type === 'extraAgents' ? agents : accounts)
    },
  )
  assert.deepEqual(await phoneAgentToReplace(wallet), oldest)
  accounts = [{}]
  assert.equal(await phoneAgentToReplace(wallet), undefined)
  accounts = []
  agents = [newest, web, { ...oldest, validUntil: Date.now() - 1 }]
  assert.equal(await phoneAgentToReplace(wallet), undefined)
  agents = [web, { ...web, name: 'Other-1' }, { ...web, name: 'Other-2' }]
  await assert.rejects(phoneAgentToReplace(wallet), /没有可自动清理的手机授权/)
})
