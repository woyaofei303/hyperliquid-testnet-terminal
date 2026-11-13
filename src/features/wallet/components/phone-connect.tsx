'use client'

import { Button } from '@fameex/ui'
import Image from 'next/image'
import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import {
  connectWallet,
  errorText,
  type WalletSession,
} from '@/shared/lib/fameex-testnet'
import { useWalletProviders } from '../hooks/use-wallet-providers'
import type { WalletProvider } from '../lib/wallet-discovery'
import { PhonePairing } from './phone-pairing'

export function PhoneConnect() {
  const providers = useWalletProviders()
  const [wallet, setWallet] = useState<WalletSession | null>(null)
  const [connecting, setConnecting] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const version = useRef(0)
  const pending = useRef(false)
  useEffect(
    () => () => {
      version.current++
    },
    [],
  )
  useEffect(() => {
    if (!wallet) return
    const changed = () => {
      if (wallet.lifecycle) wallet.lifecycle.active = false
      setWallet(null)
      setBusy(false)
      setError('钱包账户已变化或断开，请重新连接并生成新的二维码。')
    }
    wallet.provider.on('accountsChanged', changed)
    wallet.provider.on('disconnect', changed)
    return () => {
      if (wallet.lifecycle) wallet.lifecycle.active = false
      wallet.provider.removeListener('accountsChanged', changed)
      wallet.provider.removeListener('disconnect', changed)
    }
  }, [wallet])

  async function connect(item: WalletProvider) {
    if (pending.current) return
    pending.current = true
    const current = ++version.current
    setConnecting(item.id)
    setError('')
    try {
      const session = await connectWallet(item.provider)
      if (version.current !== current) {
        if (session.lifecycle) session.lifecycle.active = false
        return
      }
      setWallet({ ...session, name: item.name })
    } catch (e) {
      if (version.current === current)
        setError(
          `连接未完成：${errorText(e)}。请在钱包中完成或取消请求后重试。`,
        )
    } finally {
      pending.current = false
      if (version.current === current) setConnecting('')
    }
  }

  return (
    <div className="min-h-dvh bg-canvas">
      <header className="flex items-center justify-between gap-4 border-b border-edge bg-panel px-5 py-4">
        <Link
          href="/"
          className="flex items-center gap-2"
          aria-label="fameex-testnet 首页"
        >
          <Image src="/fameex-logo.svg" alt="FameEX" width={91} height={20} />
          <span className="rounded border border-accent/30 px-1.5 py-0.5 text-xs text-accent">
            testnet
          </span>
        </Link>
        <Link href="/" className="text-sm text-muted hover:text-ink">
          返回交易
        </Link>
      </header>
      <main className="mx-auto max-w-4xl px-5 py-8 sm:py-14">
        <p className="text-sm text-accent">电脑与手机配对</p>
        <h1 className="mt-3 text-3xl font-semibold">连接手机 App</h1>
        <p className="mt-3 leading-7 text-muted">
          在电脑上保持此页打开，用 fameex-testnet App
          扫码。完成一次授权后，手机可独立使用测试网交易。
        </p>
        <ol className="my-7 grid gap-3 sm:grid-cols-3">
          {[
            '1. 电脑连接测试钱包',
            '2. App 扫描本页二维码',
            '3. 核对六位码并确认授权',
          ].map((step) => (
            <li
              key={step}
              className="rounded-xl border border-edge bg-panel p-4 text-sm"
            >
              {step}
            </li>
          ))}
        </ol>
        <div className="grid items-start gap-5 md:grid-cols-[1fr_280px]">
          <section
            className="min-w-0 space-y-4 rounded-2xl border border-edge bg-panel p-5"
            aria-label="连接与授权"
          >
            {wallet ? (
              <>
                <div className="space-y-2 text-sm">
                  <p className="text-mint">电脑钱包已连接 · {wallet.name}</p>
                  <p className="break-all font-mono text-xs">
                    {wallet.address}
                  </p>
                  <Button
                    variant="light"
                    size="sm"
                    isDisabled={busy}
                    onPress={() => setWallet(null)}
                  >
                    更换钱包
                  </Button>
                </div>
                <PhonePairing
                  key={wallet.address}
                  wallet={wallet}
                  onBusy={setBusy}
                />
              </>
            ) : (
              <>
                <h2 className="text-lg font-medium">先连接电脑钱包</h2>
                <p className="text-sm leading-6 text-muted">
                  选择浏览器里的测试钱包。此步仅获取账户地址；手机交易授权会在扫码核对后单独确认。
                </p>
                {providers.map((item) => (
                  <Button
                    key={item.id}
                    className="w-full"
                    isDisabled={!!connecting}
                    onPress={() => void connect(item)}
                  >
                    {item.name}{' '}
                    {connecting === item.id ? '等待钱包确认…' : '连接 →'}
                  </Button>
                ))}
                {!providers.length && (
                  <p className="text-sm leading-6 text-muted">
                    未检测到浏览器钱包。请在电脑安装并解锁{' '}
                    <a
                      className="text-accent underline"
                      href="https://metamask.com/download"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      MetaMask
                    </a>{' '}
                    或已有的钱包扩展，再刷新此页。
                  </p>
                )}
              </>
            )}
            {error && (
              <p role="alert" className="text-sm text-loss">
                {error}
              </p>
            )}
          </section>
          <aside className="space-y-4 rounded-2xl bg-panel p-5 text-sm leading-6">
            <h2 className="font-medium">手机上怎么操作？</h2>
            <p className="text-muted">
              打开 App → 资产 → 连接钱包 → 扫码连接。相机对准左侧生成的二维码。
            </p>
            <p className="text-muted">
              扫描后，在手机和电脑核对相同账户及六位码，再回到电脑点击「在主钱包确认授权」。
            </p>
            <p className="text-muted">
              只使用测试钱包。二维码五分钟有效，请勿转发；手机授权有效期七天，不含提款权限。
            </p>
            <p className="text-muted">如果正在手机浏览器查看，请在电脑打开：</p>
            <p className="break-all font-mono text-xs text-accent">
              https://app.fameex-testnet.xyz/connect
            </p>
          </aside>
        </div>
      </main>
    </div>
  )
}
