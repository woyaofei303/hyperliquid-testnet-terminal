import { Button } from '@fameex/ui'
import { useCallback, useEffect, useState } from 'react'
import { errorText, info, type WalletSession } from '@/shared/lib/hyperliquid'

export function PhoneDevices({ wallet }: { wallet: WalletSession }) {
  const [agents, setAgents] = useState<
    Awaited<ReturnType<typeof info.extraAgents>>
  >([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
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
    <div className="space-y-2 border-t border-edge pt-3 text-xs">
      <div className="flex items-center justify-between">
        <span>手机设备 · 交易所授权</span>
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
      {!loading && !error && !agents.length && <p>当前没有手机代理授权。</p>}
      <a
        href="https://app.hyperliquid-testnet.xyz/API"
        target="_blank"
        rel="noopener noreferrer"
        className="inline-block rounded text-accent focus-visible:outline-2"
      >
        前往 Hyperliquid 测试网撤销授权 ↗
      </a>
      <p className="text-muted">
        在官方 API
        页面找到相同设备名和代理地址后撤销，再回此处刷新核验。删除手机密钥不会撤销授权。
      </p>
      {error && (
        <p role="alert" className="text-loss">
          {error}
        </p>
      )}
    </div>
  )
}
