'use client'
import { useEffect, useState } from 'react'
import type { EIP1193Provider } from 'viem'

export interface WalletProvider {
  id: string
  rdns?: string
  name: string
  provider: EIP1193Provider
}
export function useWalletProviders() {
  const [providers, setProviders] = useState<WalletProvider[]>([])
  useEffect(() => {
    const announce = (event: Event) => {
      const detail = (event as CustomEvent).detail
      if (
        !detail ||
        typeof detail.info?.uuid !== 'string' ||
        typeof detail.info?.name !== 'string' ||
        typeof detail.provider?.request !== 'function' ||
        typeof detail.provider?.on !== 'function' ||
        typeof detail.provider?.removeListener !== 'function'
      )
        return
      setProviders((old) => [
        ...old.filter(
          (item) =>
            item.id !== detail.info.uuid &&
            item.provider !== detail.provider &&
            item.id !== 'injected',
        ),
        {
          id: detail.info.uuid,
          rdns:
            typeof detail.info.rdns === 'string'
              ? detail.info.rdns.slice(0, 256)
              : undefined,
          name: detail.info.name.slice(0, 60),
          provider: detail.provider,
        },
      ])
    }
    window.addEventListener('eip6963:announceProvider', announce)
    if (window.ethereum)
      setProviders([
        { id: 'injected', name: '浏览器钱包', provider: window.ethereum },
      ])
    window.dispatchEvent(new Event('eip6963:requestProvider'))
    return () =>
      window.removeEventListener('eip6963:announceProvider', announce)
  }, [])
  return providers
}
