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
  const expiresAt = verifiedPhoneExpiry(
    request,
    await info.extraAgents({ user: wallet.address }),
  )
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
  await assertSession(wallet)
  await masterExchange(wallet).approveAgent(params)
  await verifyPhoneAgent(wallet, request)
}
