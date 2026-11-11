import assert from 'node:assert/strict'
import test from 'node:test'
import {
  assertPhoneAgentCapacity,
  PhoneApprovalBlockedError,
  phoneApproval,
} from './phone-authorization.ts'
import { AGENT_DURATION } from './phone-pairing.ts'

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
