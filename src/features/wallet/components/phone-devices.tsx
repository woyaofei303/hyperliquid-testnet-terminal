import { Button } from '@fameex/ui'
import { useCallback, useEffect, useState } from 'react'
import {
  errorText,
  info,
  type WalletSession,
} from '@/shared/lib/fameex-testnet'
import { type PhoneAgent, phoneDevices } from '../lib/phone-authorization'

export function PhoneDevices({
  wallet,
  disabled,
  onRevoke,
}: {
  wallet: WalletSession
  disabled: boolean
  onRevoke: (device: PhoneAgent) => Promise<void>
}) {
  const [agents, setAgents] = useState<
    Awaited<ReturnType<typeof info.extraAgents>>
  >([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const refresh = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setAgents(phoneDevices(await info.extraAgents({ user: wallet.address })))
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
          isDisabled={loading || disabled}
          onPress={() => void refresh()}
        >
          刷新授权
        </Button>
      </div>
      {agents.map((agent) => (
        <div key={agent.address} className="space-y-1 rounded bg-panel p-2">
          <div className="flex items-center justify-between gap-2">
            <p>{agent.name}</p>
            <Button
              size="sm"
              variant="light"
              className="text-loss"
              isDisabled={loading || disabled}
              aria-label={`撤销授权 ${agent.name}`}
              onPress={() => void onRevoke(agent)}
            >
              撤销授权
            </Button>
          </div>
          <p className="break-all font-mono">{agent.address}</p>
          <p>
            {agent.validUntil
              ? `到期：${new Date(agent.validUntil).toLocaleString()}`
              : '交易所未返回到期时间'}
          </p>
        </div>
      ))}
      {!loading && !error && !agents.length && <p>暂无已授权手机。</p>}
      <p className="text-muted">
        撤销需主钱包确认，该手机随后无法交易；已有委托不会取消。删除 App
        内密钥不会撤销授权。
      </p>
      {error && (
        <p role="alert" className="text-loss">
          {error}
        </p>
      )}
    </details>
  )
}
