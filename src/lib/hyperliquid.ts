import { ExchangeClient, HttpTransport, InfoClient } from '@nktkas/hyperliquid'
import { TwapOrderRequest } from '@nktkas/hyperliquid/api/exchange'
import type {
  AbstractViemJsonRpcAccount,
  AbstractViemLocalAccount,
} from '@nktkas/hyperliquid/signing'
import { canonicalize, signL1Action } from '@nktkas/hyperliquid/signing'
import {
  createWalletClient,
  custom,
  type EIP1193Provider,
  getAddress,
  isAddress,
} from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { type AccountMode, parseAccountMode } from './account-types.ts'
import {
  builderMarkets,
  cashMarkets,
  predictionMarkets,
} from './market-catalog.ts'
import { nativeOrderResult } from './native-orders.ts'
import type { TrailingAction, TwapAction } from './order-ticket.ts'
import type { Market } from './orders.ts'
import {
  clearTradingConnection,
  loadTradingConnection,
  nextTradingNonce,
  saveTradingConnection,
  setTradingConnectionDisconnected,
} from './trading-connection.ts'

export const API_URL = 'https://api.hyperliquid-testnet.xyz'
export const WS_URL = 'wss://api.hyperliquid-testnet.xyz/ws'
// 不接受环境变量或表单覆盖端点，签名及请求都固定为测试网。
const transport = new HttpTransport({
  isTestnet: true,
  apiUrl: API_URL,
  timeout: 12000,
})
export const info = new InfoClient({ transport })
export type AccountState = Awaited<ReturnType<typeof info.clearinghouseState>>
export type OpenOrder = Awaited<
  ReturnType<typeof info.frontendOpenOrders>
>[number]
export type Fill = Awaited<ReturnType<typeof info.userFills>>[number]
export type Book = NonNullable<Awaited<ReturnType<typeof info.l2Book>>>
type PerpContext = Awaited<ReturnType<typeof info.metaAndAssetCtxs>>[1][number]
export type AssetContext = Pick<
  PerpContext,
  'markPx' | 'prevDayPx' | 'dayNtlVlm'
> &
  Partial<PerpContext>
export interface MarketContext extends Market {
  onlyIsolated?: true
  marginMode?: 'strictIsolated' | 'noCross'
  context: AssetContext
}
export interface AccountSnapshot {
  address: `0x${string}`
  mode: AccountMode
  state: AccountState
  dex: string
  spot: Awaited<ReturnType<typeof info.spotClearinghouseState>>
  orders: OpenOrder[]
  fills: Fill[]
  at: number
  twaps: Awaited<ReturnType<typeof info.twapHistory>>
}
export interface WalletSession {
  address: `0x${string}`
  provider: EIP1193Provider
  exchange: ExchangeClient | null
  expiresAt: number
  name?: string
  providerId?: string
  connectionSaved?: boolean
  lifecycle?: { active: boolean }
  sendNative?: (action: TrailingAction | TwapAction) => Promise<number>
}

declare global {
  interface Window {
    ethereum?: EIP1193Provider
  }
}

export async function loadMarkets(): Promise<MarketContext[]> {
  const [meta, contexts] = await info.metaAndAssetCtxs()
  return meta.universe
    .map((asset, index) => ({
      ...asset,
      asset: index,
      kind: 'perp' as const,
      quote: 'USDC',
      context: contexts[index],
    }))
    .filter(
      (market) =>
        !market.isDelisted &&
        market.context &&
        market.szDecimals >= 0 &&
        market.szDecimals <= 6,
    )
}

export async function loadMarketCatalog() {
  const [spot, perps, outcomes, templates] = await Promise.all([
    info.spotMetaAndAssetCtxs(),
    info.allPerpMetas(),
    info.outcomeMeta(),
    info.outcomeTemplates(),
  ])
  return [
    ...cashMarkets(spot),
    ...builderMarkets(perps, spot[0].tokens),
    ...predictionMarkets(outcomes, templates, spot[1]),
  ]
}

export async function loadAccount(
  address: `0x${string}`,
  dex = '',
): Promise<AccountSnapshot> {
  const [state, orders, fills, twaps, spot, mode] = await Promise.all([
    info.clearinghouseState({ user: address, dex }),
    info.frontendOpenOrders({ user: address, dex }),
    info.userFills({ user: address }),
    info.twapHistory({ user: address }),
    info.spotClearinghouseState({ user: address }),
    info.userAbstraction({ user: address }),
  ])
  return {
    address,
    mode: parseAccountMode(mode),
    dex,
    spot,
    state,
    orders,
    fills: fills.slice(0, 30),
    twaps: twaps.slice(0, 50),
    at: Date.now(),
  }
}

export function addressOf(value: string): `0x${string}` {
  if (!isAddress(value, { strict: false }))
    throw new Error('请输入有效的钱包公开地址')
  return getAddress(value)
}

export async function assertWallet(
  provider: EIP1193Provider,
  expected: string,
) {
  const accounts = await provider.request({ method: 'eth_accounts' })
  if (accounts[0]?.toLowerCase() !== expected.toLowerCase())
    throw new Error('钱包账户已变化，请重新连接后确认操作')
}

export async function connectWallet(
  provider: EIP1193Provider,
  silent = false,
): Promise<WalletSession> {
  let accountMethod: 'eth_accounts' | 'eth_requestAccounts' = 'eth_accounts'
  if (!silent) {
    try {
      // 主动重连也展示钱包原生权限页，不能直接复用扩展已允许的地址。
      const permissions = await provider.request({
        method: 'wallet_requestPermissions',
        params: [{ eth_accounts: {} }],
      })
      if (
        !Array.isArray(permissions) ||
        !permissions.some((item) => item?.parentCapability === 'eth_accounts')
      )
        throw new Error('钱包未授予账户访问权限')
    } catch (error) {
      if (
        !error ||
        typeof error !== 'object' ||
        !('code' in error) ||
        (error.code !== 4200 && error.code !== -32601)
      )
        throw error
      accountMethod = 'eth_requestAccounts'
    }
  }
  const accounts = await provider.request({ method: accountMethod })
  if (!accounts[0]) throw new Error('钱包没有返回账户')
  const address = addressOf(accounts[0])
  return {
    address,
    provider,
    exchange: null,
    expiresAt: 0,
    lifecycle: { active: true },
  }
}

export async function assertSession(session: WalletSession) {
  const check = () => {
    if (session.lifecycle?.active === false)
      throw new Error('钱包会话已断开，请重新连接')
  }
  check()
  await assertWallet(session.provider, session.address)
  check()
}

export function masterExchange(session: WalletSession, nonce?: number) {
  const { address, provider } = session
  const client = createWalletClient({
    account: address,
    transport: custom(provider, { retryCount: 0 }),
  })
  const wallet: AbstractViemJsonRpcAccount = {
    getAddresses: () => client.getAddresses(),
    getChainId: () => client.getChainId(),
    async signTypedData(params) {
      await assertSession(session)
      // Hyperliquid 的用户授权类型包含冒号，不能经过 viem 的 Solidity 类型名校验。
      const signature = await provider.request({
        method: 'eth_signTypedData_v4',
        params: [address, JSON.stringify(params)],
      })
      await assertSession(session)
      return signature
    },
  }
  return new ExchangeClient({
    transport,
    wallet,
    ...(nonce === undefined ? {} : { nonceManager: () => nonce }),
  })
}

export const DEPOSIT_REQUIRED_MESSAGE =
  'Hyperliquid 测试网账户尚未激活。请先存入测试 USDC 并等待到账，再完成钱包连接。'

export function isDepositRequired(error: unknown) {
  const text = errorText(error)
  return (
    text === DEPOSIT_REQUIRED_MESSAGE ||
    /Must deposit before performing actions/i.test(text)
  )
}

export async function assertTradingAccount(session: WalletSession) {
  await assertSession(session)
  const { role } = await info.userRole({ user: session.address })
  await assertSession(session)
  // 零余额的已有账户仍可授权，只有交易所明确不存在的账户需要先入金。
  if (role === 'missing') throw new Error(DEPOSIT_REQUIRED_MESSAGE)
}

export async function authorizeTrading(
  session: WalletSession,
  persist = false,
): Promise<WalletSession> {
  await assertTradingAccount(session)
  const privateKey = generatePrivateKey()
  const agent = privateKeyToAccount(privateKey)
  await masterExchange(session).approveAgent({
    agentAddress: agent.address,
    agentName: 'JulianTerminal',
  })
  await assertSession(session)
  const expiresAt = Number.MAX_SAFE_INTEGER
  const connectionSaved = saveTradingConnection(
    {
      version: 1,
      network: 'hyperliquid-testnet',
      account: session.address,
      privateKey,
      expiresAt,
      providerId: session.providerId ?? 'injected',
      providerName: session.name ?? '浏览器钱包',
    },
    persist,
  )
  return tradingSession({ ...session, connectionSaved }, privateKey, expiresAt)
}

export async function restoreTrading(
  session: WalletSession,
  persist = false,
): Promise<WalletSession> {
  const saved = loadTradingConnection()
  if (!saved || saved.account.toLowerCase() !== session.address.toLowerCase())
    return session
  await assertSession(session)
  let agentAddress: string
  try {
    agentAddress = privateKeyToAccount(saved.privateKey).address
  } catch {
    clearTradingConnection()
    return session
  }
  const agents = await info.extraAgents({ user: session.address })
  await assertSession(session)
  const registered = agents.find(
    (agent) =>
      agent.address.toLowerCase() === agentAddress.toLowerCase() &&
      agent.name === 'JulianTerminal',
  )
  const expiresAt = registered?.validUntil ?? Number.MAX_SAFE_INTEGER
  if (!registered || expiresAt <= Date.now()) {
    clearTradingConnection()
    return session
  }
  return tradingSession(
    {
      ...session,
      connectionSaved: persist
        ? saveTradingConnection({ ...saved, disconnected: false }, true)
        : setTradingConnectionDisconnected(session.address, false),
    },
    saved.privateKey,
    Math.min(expiresAt, saved.expiresAt),
  )
}

function tradingSession(
  session: WalletSession,
  privateKey: `0x${string}`,
  expiresAt: number,
): WalletSession {
  const agent = privateKeyToAccount(privateKey)
  const signer: AbstractViemLocalAccount = {
    address: agent.address,
    async signTypedData(params) {
      if (Date.now() >= expiresAt)
        throw new Error('交易连接已过期，请重新连接钱包')
      await assertSession(session)
      return agent.signTypedData(params)
    },
  }
  const nonceManager = () => nextTradingNonce(agent.address)
  return {
    ...session,
    expiresAt,
    async sendNative(input) {
      // SDK 0.33 未暴露 trailingStop，且旧 TWAP schema 限 1 天；沿用其签名与传输，范围由 prepareTicket 校验。
      const action =
        input.type === 'twapOrder'
          ? canonicalize(TwapOrderRequest.entries.action, input)
          : {
              type: input.type,
              asset: input.asset,
              isBuy: input.isBuy,
              sz: input.sz,
              reduceOnly: input.reduceOnly,
              retracement: input.retracement,
              activationPx: input.activationPx,
            }
      const nonce = await nonceManager()
      const expiresAfter = Math.min(Date.now() + 60000, expiresAt)
      const signature = await signL1Action({
        wallet: signer,
        action,
        nonce,
        expiresAfter,
        isTestnet: true,
      })
      const response = await transport.request('exchange', {
        action,
        nonce,
        signature,
        expiresAfter,
      })
      return nativeOrderResult(response, input.type)
    },
    exchange: new ExchangeClient({
      transport,
      wallet: signer,
      nonceManager,
      defaultExpiresAfter: () => Math.min(Date.now() + 60000, expiresAt),
    }),
  }
}

export function errorText(error: unknown) {
  return error instanceof Error
    ? error.message.slice(0, 350)
    : '请求失败，请检查网络后重试查询'
}

export function isUserRejection(error: unknown): boolean {
  let current = error
  for (
    let depth = 0;
    depth < 8 && current && typeof current === 'object';
    depth++
  ) {
    if (
      ('code' in current && current.code === 4001) ||
      ('name' in current && current.name === 'UserRejectedRequestError')
    )
      return true
    current = 'cause' in current ? current.cause : null
  }
  return false
}
