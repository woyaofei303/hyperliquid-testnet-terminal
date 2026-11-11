import {
  assertSession,
  info,
  masterExchange,
  type WalletSession,
} from '../../../shared/lib/hyperliquid.ts'
import {
  type PhoneRequest,
  parsePhoneRequest,
  verifiedPhoneExpiry,
} from './phone-pairing.ts'

// 已确认本次授权尚未建立，页面可让用户修正后手动重试，不能自动签名。
export class PhoneApprovalBlockedError extends Error {}

export function assertPhoneAgentCapacity(
  namedAgents: number,
  subAccounts: number,
) {
  const limit = 3 + 2 * subAccounts
  if (namedAgents >= limit)
    throw new PhoneApprovalBlockedError(
      `命名代理已达到 ${limit} 个上限，请先到下方官方 API 页面撤销不再使用的旧代理，再重新确认手机授权。删除 App 内密钥不会释放名额。`,
    )
}

async function checkCapacity(
  wallet: WalletSession,
  agents: Awaited<ReturnType<typeof info.extraAgents>>,
) {
  const named = agents.filter(
    (agent) =>
      agent.name &&
      (agent.validUntil === null || agent.validUntil > Date.now()),
  ).length
  if (named >= 3) {
    const accounts = await info.subAccounts({ user: wallet.address })
    assertPhoneAgentCapacity(named, accounts?.length ?? 0)
  }
}

export function phoneApproval(
  request: PhoneRequest,
  account: string,
  now = Date.now(),
) {
  const parsed = parsePhoneRequest(request, account, now)
  return {
    agentAddress: parsed.agentAddress,
    agentName: `${parsed.agentName} valid_until ${parsed.expiresAt}`,
  }
}
export async function verifyPhoneAgent(
  wallet: WalletSession,
  request: PhoneRequest,
) {
  await assertSession(wallet)
  const agents = await info.extraAgents({ user: wallet.address })
  if (
    !agents.some(
      (agent) =>
        agent.name === request.agentName &&
        agent.address.toLowerCase() === request.agentAddress.toLowerCase(),
    )
  ) {
    await checkCapacity(wallet, agents)
    throw new PhoneApprovalBlockedError(
      '交易所尚未登记本次手机授权。可以重新确认授权；二维码已过期时，请重新生成并扫码。',
    )
  }
  const expiresAt = verifiedPhoneExpiry(request, agents)
  await assertSession(wallet)
  return expiresAt
}
export async function approvePhoneAgent(
  wallet: WalletSession,
  request: PhoneRequest,
) {
  const params = phoneApproval(request, wallet.address)
  await assertSession(wallet)
  const agents = await info.extraAgents({ user: wallet.address })
  if (agents.some((agent) => agent.name === request.agentName)) {
    // 重试只核验已有授权，绝不覆盖同名的另一台设备。
    verifiedPhoneExpiry(request, agents)
    return
  }
  await checkCapacity(wallet, agents)
  await assertSession(wallet)
  await masterExchange(wallet).approveAgent(params)
  await verifyPhoneAgent(wallet, request)
}
