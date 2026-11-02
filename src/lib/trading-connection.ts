import { isAddress } from 'viem'

export const tradingConnectionKey = 'hl-testnet-trading-connection-v1'
export interface TradingConnection {
  version: 1
  network: 'hyperliquid-testnet'
  account: `0x${string}`
  privateKey: `0x${string}`
  expiresAt: number
  providerId: string
  providerName: string
}
export function parseTradingConnection(
  raw: string | null,
): TradingConnection | null {
  try {
    const value = JSON.parse(raw ?? 'null')
    if (
      value?.version === 1 &&
      value.network === 'hyperliquid-testnet' &&
      typeof value.account === 'string' &&
      isAddress(value.account, { strict: false }) &&
      typeof value.privateKey === 'string' &&
      /^0x[0-9a-f]{64}$/i.test(value.privateKey) &&
      Number.isSafeInteger(value.expiresAt) &&
      value.expiresAt > Date.now() &&
      typeof value.providerId === 'string' &&
      value.providerId.length > 0 &&
      value.providerId.length <= 256 &&
      typeof value.providerName === 'string' &&
      value.providerName.length > 0 &&
      value.providerName.length <= 60
    )
      return value
  } catch {
    /* 损坏的本地数据不能成为签名来源。 */
  }
  return null
}
export function loadTradingConnection() {
  for (const kind of ['sessionStorage', 'localStorage'] as const) {
    try {
      const saved = parseTradingConnection(
        window[kind].getItem(tradingConnectionKey),
      )
      if (saved) return saved
    } catch {
      /* 禁用存储时仍可手动连接钱包。 */
    }
  }
  return null
}
export function clearTradingConnection() {
  for (const kind of ['sessionStorage', 'localStorage'] as const) {
    try {
      window[kind].removeItem(tradingConnectionKey)
    } catch {
      /* 当前内存会话仍会清除。 */
    }
  }
}
export function saveTradingConnection(
  saved: TradingConnection,
  persist: boolean,
) {
  clearTradingConnection()
  try {
    const storage = persist ? localStorage : sessionStorage
    storage.setItem(tradingConnectionKey, JSON.stringify(saved))
    return true
  } catch {
    return false
  }
}
export async function nextTradingNonce(agent: string) {
  if (!navigator.locks)
    throw new Error('当前浏览器不支持交易连接锁，请使用新版浏览器')
  const key = `hl-testnet-nonce:${agent.toLowerCase()}`
  return navigator.locks.request(key, () => {
    const previous = Number(localStorage.getItem(key) ?? 0)
    if (
      !Number.isSafeInteger(previous) ||
      previous < 0 ||
      previous > Date.now() + 86400000
    )
      throw new Error('本地交易序号异常，请断开并重新建立交易连接')
    const nonce = Math.max(Date.now(), previous + 1)
    localStorage.setItem(key, String(nonce))
    return nonce
  })
}

export function skipOrderConfirmation(close: boolean) {
  try {
    return (
      localStorage.getItem(
        close ? 'hl-skip-close-confirm' : 'hl-skip-order-confirm',
      ) === 'true'
    )
  } catch {
    return false
  }
}
export function rememberOrderConfirmation(close: boolean, skip: boolean) {
  try {
    localStorage.setItem(
      close ? 'hl-skip-close-confirm' : 'hl-skip-order-confirm',
      String(skip),
    )
  } catch {
    /* 存储不可用时下次继续确认。 */
  }
}
