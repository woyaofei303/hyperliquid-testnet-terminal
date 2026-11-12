import { isAddress, zeroAddress } from 'viem'
import {
  assertSession,
  errorText,
  info,
  isUserRejection,
  masterExchange,
  type WalletSession,
} from '../../../shared/lib/fameex-testnet.ts'
import {
  type PhoneRequest,
  parsePhoneRequest,
  phoneAgentName,
  verifiedPhoneExpiry,
} from './phone-pairing.ts'

// 已确认本次授权尚未建立，页面可让用户修正后手动重试，不能自动签名。
export class PhoneApprovalBlockedError extends Error {}

export type PhoneAgent = Awaited<ReturnType<typeof info.extraAgents>>[number]

function isPhoneAgent(agent: PhoneAgent) {
  return (
    isAddress(agent.address, { strict: false }) &&
    agent.address !== zeroAddress &&
    agent.name === phoneAgentName(agent.address)
  )
}

export function phoneDevices(agents: PhoneAgent[]) {
  return (
    agents
      .filter(
        (agent) =>
          isPhoneAgent(agent) &&
          (agent.validUntil === null || agent.validUntil > Date.now()),
      )
      // shortcut: 接口没有创建时间，七天授权按到期时间排序；支持自定义期限时需记录创建时间。
      .sort((a, b) => (a.validUntil ?? Infinity) - (b.validUntil ?? Infinity))
  )
}

export async function phoneAgentToReplace(wallet: WalletSession) {
  await assertSession(wallet)
  const agents = await info.extraAgents({ user: wallet.address })
  try {
    await checkCapacity(wallet, agents)
  } catch (e) {
    if (!(e instanceof PhoneApprovalBlockedError)) throw e
    await assertSession(wallet)
    const oldest = phoneDevices(agents)[0]
    if (!oldest || oldest.validUntil === null)
      throw new PhoneApprovalBlockedError(
        '名额已满，没有可自动清理的手机授权，请先处理其他设备授权。',
      )
    return oldest
  }
  await assertSession(wallet)
}

export async function revokePhoneAgent(
  wallet: WalletSession,
  device: PhoneAgent,
) {
  if (!isPhoneAgent(device)) throw new Error('只能撤销列表中的手机授权')
  await assertSession(wallet)
  const agents = await info.extraAgents({ user: wallet.address })
  const current = agents.find((agent) => agent.name === device.name)
  if (!current) return
  if (current.address.toLowerCase() !== device.address.toLowerCase())
    throw new Error('设备授权已变化，请刷新列表后重试')
  await assertSession(wallet)
  let failure: unknown
  try {
    // 与官方 API 页相同：同名零地址撤销，不授予另一把密钥权限。
    await masterExchange(wallet).approveAgent({
      agentAddress: zeroAddress,
      agentName: device.name,
    })
  } catch (e) {
    if (isUserRejection(e)) throw e
    failure = e
  }
  await assertSession(wallet)
  const remaining = await info.extraAgents({ user: wallet.address })
  await assertSession(wallet)
  if (
    remaining.some(
      (agent) =>
        agent.name === device.name &&
        agent.address.toLowerCase() === device.address.toLowerCase(),
    )
  )
    throw new Error(
      `${failure ? `${errorText(failure)}；` : ''}尚未确认设备授权已撤销，请刷新授权后重试。`,
    )
}

export function assertPhoneAgentCapacity(
  namedAgents: number,
  subAccounts: number,
) {
  const limit = 3 + 2 * subAccounts
  if (namedAgents >= limit)
    throw new PhoneApprovalBlockedError(
      `命名代理已达到 ${limit} 个上限，请在下方设备管理撤销旧手机授权，或重新生成二维码以清理最早的手机授权。`,
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
