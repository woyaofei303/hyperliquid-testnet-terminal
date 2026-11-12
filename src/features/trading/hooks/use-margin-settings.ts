'use client'
import { useEffect, useState } from 'react'
import { validateLeverage } from '@/features/trading/lib/trading'
import {
  errorText,
  info,
  type MarketContext,
} from '@/shared/lib/fameex-testnet'

type Settings = Awaited<ReturnType<typeof info.activeAssetData>>
export function useMarginSettings({
  market,
  address,
  refreshAt,
  onApply,
}: {
  market: MarketContext
  address: `0x${string}` | null
  refreshAt: number
  onApply: (leverage: number, isCross: boolean) => void
}) {
  const [editor, setEditor] = useState<'margin' | 'leverage' | null>(null)
  const [confirmed, setConfirmed] = useState<Settings | null>(null)
  const [leverage, setLeverage] = useState('2')
  const [cross, setCross] = useState(true)
  const [error, setError] = useState('')
  const [loadError, setLoadError] = useState('')
  const current =
    confirmed?.user.toLowerCase() === address?.toLowerCase() &&
    confirmed?.coin === market.name
      ? confirmed
      : null
  const isolatedOnly = !!(market.onlyIsolated || market.marginMode)
  // biome-ignore lint/correctness/useExhaustiveDependencies: 账户或市场变化必须关闭编辑器并丢弃旧设置。
  useEffect(() => {
    setEditor(null)
    setConfirmed(null)
  }, [address, market.name])
  // biome-ignore lint/correctness/useExhaustiveDependencies: 账户快照刷新（含成功提交后）触发重新读取已生效设置。
  useEffect(() => {
    if (!address) return
    let active = true
    void info
      .activeAssetData({ user: address, coin: market.name })
      .then((data) => {
        if (
          active &&
          data.user.toLowerCase() === address.toLowerCase() &&
          data.coin === market.name
        ) {
          setConfirmed(data)
          setLoadError('')
        }
      })
      .catch((e) => {
        if (active) {
          setConfirmed(null)
          setLoadError(errorText(e))
        }
      })
    return () => {
      active = false
    }
  }, [address, market.name, refreshAt])
  function open(value: 'margin' | 'leverage') {
    setLeverage(
      String(current?.leverage.value ?? Math.min(2, market.maxLeverage)),
    )
    setCross(!isolatedOnly && (current?.leverage.type ?? 'cross') === 'cross')
    setError('')
    setEditor(value)
  }
  function apply() {
    try {
      if (!current) throw new Error('请先连接账户并等待当前设置读取完成')
      const value = validateLeverage(leverage, cross, market)
      onApply(value, cross)
      setEditor(null)
    } catch (e) {
      setError(errorText(e))
    }
  }
  return {
    editor,
    open,
    close: () => setEditor(null),
    current,
    leverage,
    setLeverage,
    cross,
    setCross,
    isolatedOnly,
    error,
    loadError,
    apply,
  }
}
