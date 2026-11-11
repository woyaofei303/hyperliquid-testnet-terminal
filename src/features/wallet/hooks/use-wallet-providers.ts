'use client'
import { useEffect, useState } from 'react'
import {
  discoverWallets,
  type WalletProvider,
} from '@/features/wallet/lib/wallet-discovery'

export function useWalletProviders() {
  const [providers, setProviders] = useState<WalletProvider[]>([])
  useEffect(() => discoverWallets(window, setProviders), [])
  return providers
}
