import type { EIP1193Provider } from 'viem'

export interface WalletProvider {
  id: string
  rdns?: string
  name: string
  icon?: string
  provider: EIP1193Provider
}
function isProvider(value: unknown): value is EIP1193Provider {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<EIP1193Provider>
  return (
    typeof candidate.request === 'function' &&
    typeof candidate.on === 'function' &&
    typeof candidate.removeListener === 'function'
  )
}
export function discoverWallets(
  target: EventTarget & { ethereum?: unknown },
  changed: (wallets: WalletProvider[]) => void,
) {
  let wallets: WalletProvider[] = []
  const announce = (event: Event) => {
    const detail = (event as CustomEvent).detail
    if (
      !detail ||
      typeof detail.info?.uuid !== 'string' ||
      typeof detail.info?.name !== 'string' ||
      !isProvider(detail.provider)
    )
      return
    if (
      wallets.some(
        (item) =>
          item.id === detail.info.uuid || item.provider === detail.provider,
      )
    )
      return
    wallets = [
      ...wallets.filter((item) => !item.id.startsWith('injected')),
      {
        id: detail.info.uuid,
        name: detail.info.name.slice(0, 60),
        rdns:
          typeof detail.info.rdns === 'string'
            ? detail.info.rdns.slice(0, 256)
            : undefined,
        icon:
          typeof detail.info.icon === 'string' &&
          detail.info.icon.length < 131072 &&
          /^data:image\/(?:png|jpeg|webp|gif|svg\+xml)[;,]/i.test(
            detail.info.icon,
          )
            ? detail.info.icon
            : undefined,
        provider: detail.provider,
      },
    ]
    changed(wallets)
  }
  target.addEventListener('eip6963:announceProvider', announce)
  target.dispatchEvent(new Event('eip6963:requestProvider'))
  // EIP-6963 优先；旧钱包兜底不能让相互冲突的 ethereum getter 中断发现。
  const timer = setTimeout(() => {
    if (wallets.length) return
    try {
      const injected = target.ethereum
      if (!isProvider(injected)) return
      const candidates = (
        injected as EIP1193Provider & { providers?: unknown[] }
      ).providers ?? [injected]
      wallets = [...new Set(candidates)]
        .filter(isProvider)
        .map((provider, index) => ({
          id: index ? `injected-${index}` : 'injected',
          name:
            candidates.length > 1 ? `浏览器钱包 ${index + 1}` : '浏览器钱包',
          provider,
        }))
      changed(wallets)
    } catch {
      /* 扩展仍可通过 announceProvider 独立注册。 */
    }
  }, 200)
  return () => {
    clearTimeout(timer)
    target.removeEventListener('eip6963:announceProvider', announce)
  }
}
export function isWalletInjectionConflict(error: {
  message?: string
  filename?: string
  stack?: string
}) {
  const source = error.filename || error.stack || ''
  return (
    /(?:chrome|moz|safari-web)-extension:\/\//.test(source) &&
    /Cannot redefine property: (?:ethereum|tronWeb)|TronWeb is already initiated/.test(
      error.message ?? '',
    )
  )
}
