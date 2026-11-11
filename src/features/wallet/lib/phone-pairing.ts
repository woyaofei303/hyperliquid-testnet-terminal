// Web 与 RN 共用 v1 消息格式；对应副本位于 Web 的 features/wallet/lib。
import { gcm } from '@noble/ciphers/aes'
import { bytesToHex, hexToBytes, isAddress, sha256, stringToBytes } from 'viem'

export const PAIRING_TTL = 5 * 60_000
export const AGENT_DURATION = 7 * 24 * 60 * 60_000
export const PHONE_AGENT_PREFIX = 'Phone-'
export interface PairingOffer {
  version: 1
  relay: string
  id: string
  token: string
  key: string
  account: `0x${string}`
  expiresAt: number
}
export interface PhoneRequest {
  account: `0x${string}`
  agentAddress: `0x${string}`
  agentName: string
  expiresAt: number
}
export function randomHex(bytes: number) {
  return bytesToHex(crypto.getRandomValues(new Uint8Array(bytes))).slice(2)
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('配对数据格式无效')
  return value as Record<string, unknown>
}
function hex(value: unknown, size: number): value is string {
  return (
    typeof value === 'string' && new RegExp(`^[a-f0-9]{${size}}$`).test(value)
  )
}
export function relayURL(value: string) {
  const url = new URL(value)
  if (
    !['https:', 'http:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/'
  )
    throw new Error('配对服务地址必须是独立的 HTTP(S) 域名或端口')
  return url.origin
}
export function pairingQR(offer: PairingOffer) {
  return `hlphone:${JSON.stringify(offer)}`
}
export function parsePairingQR(
  raw: string,
  trustedRelay: string,
  now = Date.now(),
): PairingOffer {
  if (!raw.startsWith('hlphone:') || raw.length > 2048)
    throw new Error('请扫描 Web「授权手机交易」中的二维码')
  const v = object(JSON.parse(raw.slice(8)))
  if (
    v.version !== 1 ||
    !hex(v.id, 32) ||
    !hex(v.token, 64) ||
    !hex(v.key, 64) ||
    typeof v.account !== 'string' ||
    !isAddress(v.account, { strict: false }) ||
    typeof v.relay !== 'string' ||
    relayURL(v.relay) !== relayURL(trustedRelay)
  )
    throw new Error('二维码版本、账户或配对服务不匹配')
  if (
    typeof v.expiresAt !== 'number' ||
    !Number.isSafeInteger(v.expiresAt) ||
    v.expiresAt <= now ||
    v.expiresAt > now + PAIRING_TTL
  )
    throw new Error('二维码已过期或设备时间不正确，请在 Web 重新生成')
  return {
    version: 1,
    relay: relayURL(v.relay),
    id: v.id,
    token: v.token,
    key: v.key,
    account: v.account as `0x${string}`,
    expiresAt: v.expiresAt,
  }
}
export function phoneAgentName(address: string) {
  return `${PHONE_AGENT_PREFIX}${address.slice(2, 12).toLowerCase()}`
}
export function parsePhoneRequest(
  value: unknown,
  account: string,
  now = Date.now(),
): PhoneRequest {
  const v = object(value)
  if (
    typeof v.account !== 'string' ||
    !isAddress(v.account, { strict: false }) ||
    v.account.toLowerCase() !== account.toLowerCase() ||
    typeof v.agentAddress !== 'string' ||
    !isAddress(v.agentAddress, { strict: false }) ||
    /^0x0{40}$/i.test(v.agentAddress) ||
    v.agentAddress.toLowerCase() === account.toLowerCase() ||
    v.agentName !== phoneAgentName(v.agentAddress) ||
    typeof v.expiresAt !== 'number' ||
    !Number.isSafeInteger(v.expiresAt) ||
    v.expiresAt <= now ||
    v.expiresAt > now + AGENT_DURATION
  )
    throw new Error('手机代理地址、授权期限或账户不匹配')
  return {
    account: v.account as `0x${string}`,
    agentAddress: v.agentAddress as `0x${string}`,
    agentName: v.agentName as string,
    expiresAt: v.expiresAt,
  }
}
function binding(offer: PairingOffer, phase: 'request' | 'approval') {
  return stringToBytes(
    `hlphone:1:${offer.id}:${offer.account.toLowerCase()}:${phase}`,
  )
}
export function encryptPairing(
  offer: PairingOffer,
  phase: 'request' | 'approval',
  value: unknown,
) {
  const nonce = crypto.getRandomValues(new Uint8Array(12))
  const encrypted = gcm(
    hexToBytes(`0x${offer.key}`),
    nonce,
    binding(offer, phase),
  ).encrypt(stringToBytes(JSON.stringify(value)))
  return `${bytesToHex(nonce).slice(2)}${bytesToHex(encrypted).slice(2)}`
}
export function decryptPairing(
  offer: PairingOffer,
  phase: 'request' | 'approval',
  envelope: unknown,
): unknown {
  if (
    typeof envelope !== 'string' ||
    envelope.length < 56 ||
    envelope.length > 4096 ||
    envelope.length % 2 ||
    !/^[a-f0-9]+$/.test(envelope)
  )
    throw new Error('配对密文无效')
  const plain = gcm(
    hexToBytes(`0x${offer.key}`),
    hexToBytes(`0x${envelope.slice(0, 24)}`),
    binding(offer, phase),
  ).decrypt(hexToBytes(`0x${envelope.slice(24)}`))
  return JSON.parse(new TextDecoder().decode(plain))
}
export function pairingCode(offer: PairingOffer, request: PhoneRequest) {
  // 将账户、手机公钥和期限都绑定到核对码，防止只比对设备名称。
  const digest = sha256(
    stringToBytes(
      JSON.stringify([
        offer.id,
        offer.key,
        request.account.toLowerCase(),
        request.agentAddress.toLowerCase(),
        request.agentName,
        request.expiresAt,
      ]),
    ),
  )
  return (Number.parseInt(digest.slice(2, 10), 16) % 1_000_000)
    .toString()
    .padStart(6, '0')
}
export function verifiedPhoneExpiry(
  request: PhoneRequest,
  agents: { address: string; name: string; validUntil: number | null }[],
  now = Date.now(),
) {
  const grant = agents.find(
    (a) =>
      a.address.toLowerCase() === request.agentAddress.toLowerCase() &&
      a.name === request.agentName,
  )
  if (
    !grant ||
    typeof grant.validUntil !== 'number' ||
    !Number.isSafeInteger(grant.validUntil) ||
    grant.validUntil <= now ||
    grant.validUntil > request.expiresAt ||
    request.expiresAt <= now
  )
    throw new Error('手机交易授权不存在、已撤销或已到期，请在 Web 重新授权')
  return Math.min(request.expiresAt, grant.validUntil)
}
export async function pairingFetch(
  relay: string,
  path: string,
  token?: string,
  body?: unknown,
  method = body === undefined ? 'GET' : 'POST',
) {
  const response = await fetch(`${relayURL(relay)}${path}`, {
    method,
    cache: 'no-store',
    redirect: 'error',
    signal: AbortSignal.timeout(10_000),
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
  if (!response.ok)
    throw new Error(
      response.status === 410
        ? '配对已过期或取消，请重新扫码；已提交的授权请到设备列表核验'
        : response.status === 409
          ? '二维码已被使用，请重新生成'
          : '配对服务不可用，请检查地址和网络后重试',
    )
  return response.json()
}
