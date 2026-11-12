import { Button } from '@fameex/ui'
import { useCallback, useEffect, useState } from 'react'
import {
  errorText,
  info,
  type WalletSession,
} from '@/shared/lib/fameex-testnet'

export function PhoneDevices({ wallet }: { wallet: WalletSession }) {
  const [agents, setAgents] = useState<
    Awaited<ReturnType<typeof info.extraAgents>>
  >([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const refresh = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setAgents(
        (await info.extraAgents({ user: wallet.address })).filter((agent) =>
          /^Phone-[a-f0-9]{10}$/.test(agent.name),
        ),
      )
    } catch (e) {
      setError(errorText(e))
    } finally {
      setLoading(false)
    }
  }, [wallet.address])
  useEffect(() => {
    void refresh()
  }, [refresh])
  return (
    <details className="space-y-2 border-t border-edge pt-3 text-xs">
      <summary className="cursor-pointer rounded focus-visible:outline-2">
        已授权设备{loading ? ' · 加载中' : error ? '' : `（${agents.length}）`}
      </summary>
      <div className="flex items-center justify-between">
        <span>设备管理</span>
        <Button
          size="sm"
          variant="light"
          isDisabled={loading}
          onPress={() => void refresh()}
        >
          刷新授权
        </Button>
      </div>
      {agents.map((agent) => (
        <div key={agent.address} className="space-y-1 rounded bg-panel p-2">
          <p>{agent.name}</p>
          <p className="break-all font-mono">{agent.address}</p>
          <p>
            {agent.validUntil
              ? `到期：${new Date(agent.validUntil).toLocaleString()}`
              : '交易所未返回到期时间'}
          </p>
        </div>
      ))}
      {!loading && !error && !agents.length && <p>暂无已授权手机。</p>}
      <a
        href="https://app.hyperliquid-testnet.xyz/API"
        target="_blank"
        rel="noopener noreferrer"
        className="inline-block rounded text-accent focus-visible:outline-2"
      >
        前往测试网撤销授权 ↗
      </a>
      <p className="text-muted">
        撤销时请核对设备名和授权地址。删除手机密钥不会撤销授权。
      </p>
      {error && (
        <p role="alert" className="text-loss">
          {error}
        </p>
      )}
    </details>
  )
}
