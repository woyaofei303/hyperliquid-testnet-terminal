'use client'

import { Button, Checkbox, Input, Modal, Select } from '@fameex/ui'
import Image from 'next/image'
import { useCallback, useEffect, useState } from 'react'
import { formatUnits } from 'viem'
import { sharedAccount } from '@/features/assets/lib/account-types'
import {
  DEPOSIT_CHAIN,
  fundingAmount,
  transferAmount,
} from '@/features/assets/lib/funding'
import type { TerminalModel } from '@/features/terminal/hooks/use-terminal'
import { Money } from '@/features/trading/lib/orders'
import { t, useLocale } from '@/i18n'
import { display } from '@/shared/lib/display'
import {
  FundingRoute,
  WithdrawalForm,
} from '../../assets/components/withdrawal-form'
import { PhonePairing } from './phone-pairing'

const walletDownloads = [
  {
    name: 'MetaMask',
    rdns: 'io.metamask',
    url: 'https://metamask.com/download',
  },
  { name: 'Rabby', rdns: 'io.rabby', url: 'https://rabby.io/' },
  {
    name: 'OKX Wallet',
    rdns: 'com.okex.wallet',
    url: 'https://web3.okx.com/download',
  },
  {
    name: 'Bitget Wallet',
    rdns: 'com.bitget.web3',
    url: 'https://web3.bitget.com/wallet-download',
  },
  {
    name: 'Phantom',
    rdns: 'app.phantom',
    url: 'https://phantom.com/download',
  },
  {
    name: 'Coinbase Wallet',
    rdns: 'com.coinbase.wallet',
    url: 'https://www.coinbase.com/wallet/downloads',
  },
  {
    name: 'Trust Wallet',
    rdns: 'com.trustwallet.app',
    url: 'https://trustwallet.com/download',
  },
  {
    name: 'Bybit Wallet',
    rdns: 'com.bybit',
    url: 'https://chromewebstore.google.com/detail/bybit-wallet/pdliaogehgdbhbnmkklieghmmjkpigpa',
  },
]

export function Web3Dialog({ model }: { model: TerminalModel }) {
  useLocale()

  const providers = model.providers
  const missingWallets = walletDownloads.filter(
    (wallet) =>
      !providers.some(
        (provider) =>
          provider.rdns === wallet.rdns ||
          provider.name.toLowerCase() === wallet.name.toLowerCase(),
      ),
  )
  const [amount, setAmount] = useState('')
  const [phoneBusy, setPhoneBusy] = useState(false)
  const [showPhone, setShowPhone] = useState(false)
  const [copied, setCopied] = useState(false)
  const [persist, setPersist] = useState(false)
  const [popoverContainer, setPopoverContainer] = useState<HTMLElement | null>(
    null,
  )
  // 下拉放在弹窗根节点，避免选项聚焦时滚动正文并触发自动关闭。
  const attachPopover = useCallback((node: HTMLDivElement | null) => {
    setPopoverContainer(node?.closest<HTMLElement>('[role="dialog"]') ?? null)
  }, [])
  const {
    wallet,
    funding: f,
    busy,
    web3Panel,
    setWeb3Panel,
    transferToPerp,
    setTransferToPerp,
  } = model
  const close = () => {
    if (phoneBusy) return
    f.cancelWithdrawal()
    setWeb3Panel(null)
  }
  const authorized = !!wallet?.exchange && Date.now() < wallet.expiresAt
  let units = 0n
  let amountError = ''
  try {
    if (amount) units = fundingAmount(amount)
  } catch (e) {
    amountError = e instanceof Error ? e.message : t('金额无效')
  }
  const sufficient =
    f.balances && f.balances.usdc >= units && f.balances.gas > 0n
  const transferAvailable =
    (transferToPerp ? f.core?.spot : f.core?.perp) ?? '0'
  let transferError = ''
  if (amount && web3Panel === 'transfer') {
    try {
      transferAmount(amount, transferAvailable)
    } catch (e) {
      transferError = e instanceof Error ? e.message : t('金额无效')
    }
  }
  const accountMode = model.account.snapshot?.mode
  const canTransfer = !!accountMode && !sharedAccount(accountMode)
  useEffect(() => {
    if (web3Panel === 'transfer' && accountMode && sharedAccount(accountMode))
      setWeb3Panel(null)
  }, [web3Panel, accountMode, setWeb3Panel])
  const connectingView = !wallet || (web3Panel === 'wallet' && !authorized)
  const title = connectingView
    ? t('连接')
    : web3Panel === 'deposit'
      ? t('存款')
      : web3Panel === 'transfer'
        ? t('划转 USDC')
        : web3Panel === 'withdraw'
          ? t('提款')
          : t('账户')
  return (
    <Modal
      title={t(title)}
      className={
        connectingView
          ? 'max-w-[520px] bg-panel [&_header]:px-6 [&_header]:pb-5 [&_header]:pt-12 [&_header]:text-center [&_header]:text-xl'
          : undefined
      }
      onClose={close}
      busy={busy || model.connecting || phoneBusy}
      closeLabel={t('关闭钱包面板')}
    >
      {!wallet ? (
        <>
          <section className="rounded-lg border border-edge bg-surface p-4 text-sm">
            <h3 className="font-medium">{t('在手机 App 上交易')}</h3>
            <p className="mt-2 text-xs leading-5 text-muted">
              {t(
                '先连接下方电脑钱包，再点「授权手机交易 / 管理设备」生成二维码。用 App 扫码并核对授权后，手机即可独立交易。',
              )}
            </p>
          </section>
          <div className="flex flex-col gap-3">
            {providers.map((item) => (
              <Button
                key={item.id}
                variant="flat"
                color="default"
                aria-label={`${t(item.name)} ${model.connectingWallet === item.name ? t('等待钱包确认…') : t('连接 →')}`}
                className="h-[54px] w-full justify-start gap-3 rounded-lg border-0 bg-surface px-5 text-sm font-medium text-ink hover:bg-hover"
                isDisabled={model.connecting}
                onPress={() =>
                  void model.connectProvider(
                    item.provider,
                    item.name,
                    item.rdns ?? item.id,
                    false,
                    persist,
                  )
                }
              >
                {item.icon ? (
                  <Image
                    src={item.icon}
                    width={20}
                    height={20}
                    unoptimized
                    alt=""
                    className="size-5 shrink-0 rounded-sm"
                  />
                ) : (
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 24 24"
                    className="size-5 shrink-0"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                  >
                    <path d="M20 8V5H5a2 2 0 0 0 0 4h16v11H5a2 2 0 0 1-2-2V7" />
                    <path d="M21 12h-5v5h5M17 14.5h1" />
                  </svg>
                )}
                <span>{t(item.name)}</span>
                {model.connectingWallet === item.name && (
                  <span className="ml-auto text-xs text-muted">
                    {t('等待钱包确认…')}
                  </span>
                )}
              </Button>
            ))}
            {missingWallets.map((item) => (
              <a
                key={item.rdns}
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`${item.name} ${t('未安装，前往官网安装')}`}
                className="flex h-[54px] w-full items-center gap-3 rounded-lg bg-surface px-5 text-sm font-medium text-ink hover:bg-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                <span>{item.name}</span>
                <span className="ml-auto text-xs text-muted">
                  {t('未安装')}
                </span>
                <span className="text-xs text-accent">{t('安装 ↗')}</span>
              </a>
            ))}
          </div>
          {missingWallets.length > 0 && (
            <p className="text-xs leading-5 text-muted">
              {t('安装并启用扩展后，刷新本页即可连接。')}
            </p>
          )}
          {model.connecting && (
            <output className="block rounded-[8px] border border-edge bg-panel p-4 text-sm leading-6">
              <span className="block font-medium text-ink">
                {t('请在')}
                {model.connectingWallet}
                {t('中确认连接')}
              </span>
            </output>
          )}
        </>
      ) : (
        <>
          {web3Panel === 'wallet' && (
            <>
              <div className="rounded-[8px] bg-panel p-3 text-xs leading-5">
                <p className="mb-1 text-muted">
                  {wallet.name ?? '浏览器钱包'} {t('· 当前地址')}
                </p>
                <p className="break-all font-mono">{wallet.address}</p>
                <div className="mt-3 flex items-center justify-between">
                  <Button
                    variant="light"
                    color="default"
                    size="sm"
                    onPress={async () => {
                      try {
                        await navigator.clipboard.writeText(wallet.address)
                        setCopied(true)
                      } catch {
                        setCopied(false)
                      }
                    }}
                  >
                    {copied ? t('已复制') : t('复制地址')}
                  </Button>
                  <a
                    className="rounded-md px-2 py-1 text-muted transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                    href={`https://app.hyperliquid-testnet.xyz/explorer/address/${wallet.address}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {t('链上记录 ↗')}
                  </a>
                </div>
              </div>
              <Button
                isDisabled={busy || phoneBusy}
                onPress={() => setShowPhone(!showPhone)}
              >
                {showPhone ? '收起手机授权' : '授权手机交易 / 管理设备'}
              </Button>
              {showPhone && (
                <PhonePairing wallet={wallet} onBusy={setPhoneBusy} />
              )}
              <dl className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <dt className="text-muted">{t('合约可提余额')}</dt>
                  <dd>{display(f.core?.perp)} USDC</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted">{t('现货可用余额')}</dt>
                  <dd>{display(f.core?.spot)} USDC</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted">{t('交易连接')}</dt>
                  <dd>
                    {model.account.error || model.connectionError
                      ? t('核验失败，请重试')
                      : model.checkingAccount
                        ? t('正在读取余额与核验连接')
                        : authorized
                          ? t('可交易')
                          : wallet.expiresAt
                            ? t('已过期')
                            : t('待完成连接')}
                  </dd>
                </div>
              </dl>
              {!authorized && (
                <>
                  <Checkbox
                    isSelected={persist}
                    onValueChange={setPersist}
                    isDisabled={busy || phoneBusy}
                  >
                    {t('保持连接')}
                  </Checkbox>
                  <Button
                    className="w-full"
                    isDisabled={busy || phoneBusy}
                    onPress={() =>
                      void model.connectProvider(
                        wallet.provider,
                        wallet.name ?? '浏览器钱包',
                        wallet.providerId,
                        false,
                        persist,
                      )
                    }
                  >
                    {model.connecting
                      ? t('等待钱包确认…')
                      : t('重新连接并核验')}
                  </Button>
                </>
              )}
              <div
                className={`grid gap-2.5 pt-1 ${canTransfer ? 'grid-cols-3' : 'grid-cols-2'}`}
              >
                {(['deposit', 'transfer', 'withdraw'] as const)
                  .filter((panel) => panel !== 'transfer' || canTransfer)
                  .map((panel) => (
                    <Button
                      key={panel}
                      color={panel === 'deposit' ? 'primary' : 'default'}
                      className="min-w-0 px-3"
                      isDisabled={busy || phoneBusy}
                      onPress={() => setWeb3Panel(panel)}
                    >
                      {t(
                        { deposit: '存款', transfer: '划转', withdraw: '提款' }[
                          panel
                        ],
                      )}
                    </Button>
                  ))}
              </div>
              <Button
                variant="light"
                color="default"
                className="w-full hover:!text-loss"
                isDisabled={busy || phoneBusy}
                onPress={model.disconnect}
              >
                {t('断开钱包')}
              </Button>
            </>
          )}
          {(web3Panel === 'deposit' || web3Panel === 'withdraw') && (
            <div ref={attachPopover} className="flex flex-col gap-4">
              <Select
                variant="bordered"
                className="w-full max-w-none"
                classNames={{
                  trigger: 'h-10 bg-panel px-3',
                  innerWrapper: 'w-full',
                }}
                label={t('资产')}
                aria-label={t('资产')}
                labelPlacement="outside"
                selectedKeys={['USDC']}
                items={[{ key: 'USDC', label: 'USDC' }]}
                isDisabled={busy || phoneBusy}
                popoverProps={{
                  portalContainer: popoverContainer ?? undefined,
                  shouldCloseOnScroll: false,
                  classNames: {
                    base: 'z-[1200]',
                    content: 'border border-edge bg-surface shadow-xl',
                  },
                }}
              />
              <Select
                variant="bordered"
                className="w-full max-w-none"
                classNames={{
                  trigger: 'h-10 bg-panel px-3',
                  innerWrapper: 'w-full',
                }}
                label={web3Panel === 'deposit' ? t('充值网络') : t('提款网络')}
                aria-label={
                  web3Panel === 'deposit' ? t('充值网络') : t('提款网络')
                }
                labelPlacement="outside"
                selectedKeys={['arbitrum']}
                items={[{ key: 'arbitrum', label: t('Arbitrum Sepolia') }]}
                isDisabled={busy || phoneBusy}
                popoverProps={{
                  portalContainer: popoverContainer ?? undefined,
                  shouldCloseOnScroll: false,
                  classNames: {
                    base: 'z-[1200]',
                    content: 'border border-edge bg-surface shadow-xl',
                  },
                }}
              />
            </div>
          )}
          {web3Panel === 'deposit' && (
            <>
              <Input
                label={t('存款金额（USDC）')}
                value={amount}
                onChange={setAmount}
                inputMode="decimal"
                placeholder={t('至少 5 USDC')}
                variant="bordered"
                size="md"
                inputWrapperClassName="bg-panel"
                readOnly={busy}
                isInvalid={
                  !!amountError || !!(f.balances && units > f.balances.usdc)
                }
                errorMessage={
                  amountError ||
                  (f.balances && units > f.balances.usdc
                    ? t('金额超过源链可用余额')
                    : '')
                }
                endContent={
                  <Button
                    variant="light"
                    size="sm"
                    isDisabled={busy || !f.balances}
                    onPress={() =>
                      f.balances && setAmount(formatUnits(f.balances.usdc, 6))
                    }
                  >
                    {t('最大值：')}
                    <span>
                      {f.balances ? formatUnits(f.balances.usdc, 6) : '—'}
                    </span>
                  </Button>
                }
              />
              {f.balances?.gas === 0n && (
                <output className="text-xs leading-5 text-loss">
                  {t('Arbitrum Sepolia ETH 余额不足')}
                </output>
              )}
              {f.chain !== DEPOSIT_CHAIN.id ? (
                <Button
                  className="w-full"
                  isDisabled={busy || phoneBusy}
                  onPress={f.switchChain}
                >
                  {t('切换至 Arbitrum Sepolia')}
                </Button>
              ) : (
                <Button
                  className="w-full"
                  isDisabled={busy || units === 0n || !sufficient}
                  onPress={() => f.deposit(amount)}
                >
                  {busy
                    ? f.record?.kind === 'approve'
                      ? f.record.status === 'submitted'
                        ? t('等待 USDC 授权确认…')
                        : t('请在钱包授权 USDC…')
                      : t('请在钱包确认存款…')
                    : f.balances?.gas === 0n
                      ? t('需要 Arbitrum Sepolia ETH')
                      : t('存款')}
                </Button>
              )}
              <dl className="space-y-2 text-xs">
                <div className="flex justify-between">
                  <dt className="text-muted">{t('跨链手续费')}</dt>
                  <dd>≤ 0.2 USDC + Gas</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted">{t('激活费（如适用）')}</dt>
                  <dd>1 USDC</dd>
                </div>
              </dl>
            </>
          )}
          {web3Panel === 'transfer' && canTransfer && (
            <>
              <FundingRoute
                from={transferToPerp ? t('现货账户') : t('合约账户')}
                to={transferToPerp ? t('合约账户') : t('现货账户')}
                onSwap={() => {
                  setTransferToPerp(!transferToPerp)
                  setAmount('')
                }}
                disabled={busy}
              />
              <Input
                label={t('划转金额（USDC）')}
                value={amount}
                onChange={setAmount}
                inputMode="decimal"
                placeholder={t('输入划转金额')}
                isDisabled={busy || phoneBusy}
                isInvalid={!!transferError}
                errorMessage={transferError}
                endContent={
                  <Button
                    variant="light"
                    size="sm"
                    isDisabled={busy || !f.core}
                    onPress={() =>
                      setAmount(
                        new Money(transferAvailable)
                          .toDecimalPlaces(6, Money.ROUND_DOWN)
                          .toFixed(),
                      )
                    }
                  >
                    {t('最大值：')}
                    {display(transferAvailable, 6)}
                  </Button>
                }
              />
              <Button
                className="w-full"
                isDisabled={busy || !f.core || !amount || !!transferError}
                onPress={() => model.transferFunds(amount, transferToPerp)}
              >
                {busy ? t('等待钱包确认…') : t('确认划转')}
              </Button>
            </>
          )}
          {web3Panel === 'withdraw' && <WithdrawalForm model={model} />}
          <FundingStatus model={model} />
          {f.error && (
            <p role="alert" className="text-xs leading-5 text-loss">
              {t(f.error)}
            </p>
          )}
        </>
      )}
      {model.connectionError && (
        <p role="alert" className="text-xs leading-5 text-loss">
          {t(model.connectionError)}
        </p>
      )}
    </Modal>
  )
}

function FundingStatus({ model }: { model: TerminalModel }) {
  useLocale()

  const { funding: f, busy, web3Panel } = model
  const record = f.record
  if (
    !record ||
    busy ||
    (record.kind !== web3Panel &&
      !(record.kind === 'approve' && web3Panel === 'deposit'))
  )
    return null
  return (
    <output className="block space-y-2 rounded-[8px] border border-edge p-3 text-xs leading-5">
      <p className="font-medium">
        {record.kind === 'approve'
          ? t('USDC 授权')
          : record.kind === 'transfer'
            ? t('USDC 划转')
            : record.kind === 'withdraw'
              ? t('USDC 提款')
              : t('USDC 存款')}{' '}
        · {record.amount} USDC
      </p>
      <p>
        {record.status === 'credited'
          ? record.kind === 'withdraw'
            ? t('Arbitrum Sepolia 到账已核验')
            : t('Hyperliquid 到账已核验')
          : record.status === 'confirmed'
            ? record.kind === 'deposit'
              ? t('源链已确认 · 等待 Hyperliquid 到账')
              : record.kind === 'withdraw'
                ? t('目标链交易已找到 · 等待到账核验')
                : t('操作已确认')
            : record.status === 'reverted'
              ? t('操作已取消或失败')
              : record.status === 'submitted'
                ? record.kind === 'withdraw'
                  ? t('提款请求已接受 · 等待跨链到账')
                  : t('已提交 · 等待源链确认')
                : t('资金结果待确认')}
      </p>
      {record.hash && (
        <a
          target="_blank"
          rel="noreferrer"
          className="block text-accent"
          href={`https://sepolia.arbiscan.io/tx/${record.hash}`}
        >
          {t('查看链上交易 ↗')}
        </a>
      )}
    </output>
  )
}
