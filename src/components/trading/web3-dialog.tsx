'use client'
import { Button, Checkbox, Input, Modal, Select } from '@fameex/ui'
import { useCallback, useState } from 'react'
import { formatUnits } from 'viem'
import type { TerminalModel } from '@/hooks/use-terminal'
import { display } from '@/lib/display'
import { DEPOSIT_CHAIN, fundingAmount, transferAmount } from '@/lib/funding'
import { DEPOSIT_REQUIRED_MESSAGE } from '@/lib/hyperliquid'
import { Money } from '@/lib/orders'
import { rememberOrderConfirmation } from '@/lib/trading-connection'
import { FundingRoute, WithdrawalForm } from './withdrawal-form'

export function Web3Dialog({ model }: { model: TerminalModel }) {
  const providers = model.providers
  const [amount, setAmount] = useState('')
  const [copied, setCopied] = useState(false)
  const [confirmationsReset, setConfirmationsReset] = useState(false)
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
    f.cancelWithdrawal()
    setWeb3Panel(null)
  }
  const authorized = !!wallet?.exchange && Date.now() < wallet.expiresAt
  let units = 0n
  let amountError = ''
  try {
    if (amount) units = fundingAmount(amount)
  } catch (e) {
    amountError = e instanceof Error ? e.message : '金额无效'
  }
  const sufficient =
    f.balances && f.balances.usdc >= units && f.balances.gas > 0n
  const allowance = units > 0n && f.balances && f.balances.allowance >= units
  const transferAvailable =
    (transferToPerp ? f.core?.spot : f.core?.perp) ?? '0'
  let transferError = ''
  if (amount && web3Panel === 'transfer') {
    try {
      transferAmount(amount, transferAvailable)
    } catch (e) {
      transferError = e instanceof Error ? e.message : '金额无效'
    }
  }
  const title = !wallet
    ? '连接钱包'
    : web3Panel === 'deposit'
      ? '存款'
      : web3Panel === 'transfer'
        ? '划转 USDC'
        : web3Panel === 'withdraw'
          ? '提款'
          : '账户'
  return (
    <Modal
      title={title}
      onClose={close}
      busy={busy || model.connecting}
      closeLabel="关闭钱包面板"
    >
      {!wallet ? (
        <>
          <p className="text-sm leading-6 text-muted">
            选择钱包后，在钱包扩展中允许本站连接。已允许连接的钱包可能直接返回账户。
          </p>
          {providers.map((item) => (
            <Button
              key={item.id}
              variant="bordered"
              color="default"
              className="h-14 w-full justify-between px-4"
              isDisabled={model.connecting}
              onPress={() =>
                void model.connectProvider(
                  item.provider,
                  item.name,
                  item.rdns ?? item.id,
                )
              }
            >
              <span>{item.name}</span>
              <span className="text-xs text-muted">
                {model.connectingWallet === item.name
                  ? '等待钱包确认…'
                  : '连接 →'}
              </span>
            </Button>
          ))}
          {providers.length === 0 && (
            <output className="block rounded-[8px] bg-panel p-3 text-sm leading-6">
              未检测到浏览器钱包。请在已安装 MetaMask、Rabby
              等扩展的浏览器打开本页。
            </output>
          )}
          {model.connecting && (
            <output className="block rounded-[8px] border border-edge bg-panel p-4 text-sm leading-6">
              <span className="block font-medium text-ink">
                请在{model.connectingWallet}中确认连接
              </span>
              <span className="mt-1 block text-xs text-muted">
                若未弹出窗口，请打开浏览器工具栏中的钱包扩展。取消连接请在钱包中操作。
              </span>
            </output>
          )}
          <div className="space-y-2 text-xs leading-5 text-muted">
            <p>连接后可读取公开地址、余额与交易记录，并向钱包发起签名请求。</p>
            <p>连接不会提交订单或转移资金。</p>
            <p>
              当前浏览器没有有效交易连接时，需单独确认一次无 Gas
              签名；存款、划转和提款仍由你在钱包中确认。
            </p>
          </div>
          {model.connectionError && (
            <p role="alert" className="text-xs leading-5 text-loss">
              {model.connectionError}
            </p>
          )}
        </>
      ) : (
        <>
          {web3Panel === 'wallet' && (
            <>
              <div className="rounded-[8px] bg-panel p-3 text-xs leading-5">
                <p className="mb-1 text-muted">
                  {wallet.name ?? '浏览器钱包'} · 当前地址
                </p>
                <p className="break-all font-mono">{wallet.address}</p>
                <div className="mt-3 flex items-center justify-between">
                  <Button
                    variant="light"
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
                    {copied ? '已复制' : '复制地址'}
                  </Button>
                  <a
                    className="text-accent"
                    href={`https://app.hyperliquid-testnet.xyz/explorer/address/${wallet.address}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    链上记录 ↗
                  </a>
                </div>
              </div>
              <dl className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <dt className="text-muted">合约可提余额</dt>
                  <dd>{display(f.core?.perp)} USDC</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted">现货可用余额</dt>
                  <dd>{display(f.core?.spot)} USDC</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted">交易连接</dt>
                  <dd>
                    {model.account.error || model.connectionError
                      ? '核验失败，请重试'
                      : model.checkingAccount
                        ? '正在读取余额与核验连接'
                        : authorized
                          ? '已启用'
                          : wallet.expiresAt
                            ? '已过期'
                            : '尚未启用'}
                  </dd>
                </div>
              </dl>
              <Button
                className="w-full"
                isDisabled={busy || !model.needsTradingConnection}
                onPress={() => {
                  close()
                  void model.previewApproval()
                }}
              >
                {model.checkingAccount
                  ? '正在核验账户…'
                  : authorized
                    ? '交易会话已启用'
                    : '启用测试网交易'}
              </Button>
              {!authorized && (
                <Button
                  variant="light"
                  isDisabled={busy}
                  onPress={() =>
                    void model.connectProvider(
                      wallet.provider,
                      wallet.name ?? '浏览器钱包',
                      wallet.providerId,
                    )
                  }
                >
                  重新连接并核验
                </Button>
              )}
              <Button
                variant="light"
                color="default"
                onPress={() => {
                  rememberOrderConfirmation(false, false)
                  rememberOrderConfirmation(true, false)
                  setConfirmationsReset(true)
                }}
              >
                {confirmationsReset ? '已恢复订单确认' : '恢复下单和平仓确认'}
              </Button>
              <div className="grid grid-cols-3 gap-2">
                {(['deposit', 'transfer', 'withdraw'] as const).map(
                  (panel, i) => (
                    <Button
                      key={panel}
                      variant="bordered"
                      onPress={() => setWeb3Panel(panel)}
                    >
                      {['存款', '划转', '提款'][i]}
                    </Button>
                  ),
                )}
              </div>
              <Button
                variant="light"
                color="default"
                isDisabled={busy}
                onPress={model.disconnect}
              >
                断开钱包
              </Button>
              <p className="text-xs leading-5 text-muted">
                断开仅清除本地会话。交易所授权可在{' '}
                <a
                  href="https://app.hyperliquid-testnet.xyz/API"
                  target="_blank"
                  rel="noreferrer"
                  className="text-accent"
                >
                  API 钱包页 ↗
                </a>{' '}
                撤销。
              </p>
            </>
          )}
          {(web3Panel === 'deposit' || web3Panel === 'withdraw') && (
            <div ref={attachPopover} className="flex flex-col gap-4">
              <p className="text-sm leading-6 text-muted">
                {web3Panel === 'deposit'
                  ? '从 Arbitrum Sepolia 存入 USDC，到账后即可启用交易。'
                  : '将 USDC 提现到 Arbitrum Sepolia 的当前钱包地址。'}
              </p>
              {web3Panel === 'deposit' && (
                <p className="-mt-2 text-xs leading-5 text-muted">
                  跨链手续费上限 0.2 USDC，另付源链 Gas；新账户可能扣除 1 USDC
                  激活费。
                </p>
              )}
              <Select
                variant="bordered"
                className="w-full max-w-none"
                classNames={{
                  trigger: 'h-10 bg-panel px-3',
                  label: 'text-xs font-normal text-muted',
                  innerWrapper: 'w-full',
                }}
                label="资产"
                aria-label="资产"
                labelPlacement="outside"
                selectedKeys={['USDC']}
                items={[{ key: 'USDC', label: 'USDC' }]}
                isDisabled={busy || f.pending}
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
                  label: 'text-xs font-normal text-muted',
                  innerWrapper: 'w-full',
                }}
                label={web3Panel === 'deposit' ? '充值网络' : '提款网络'}
                aria-label={web3Panel === 'deposit' ? '充值网络' : '提款网络'}
                labelPlacement="outside"
                selectedKeys={['arbitrum']}
                items={[
                  { key: 'arbitrum', label: 'Arbitrum Sepolia · 测试网' },
                ]}
                isDisabled={busy || f.pending}
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
              {model.message === DEPOSIT_REQUIRED_MESSAGE &&
                Number(f.core?.perp ?? 0) === 0 &&
                Number(f.core?.spot ?? 0) === 0 && (
                  <output className="text-xs leading-5 text-muted">
                    {DEPOSIT_REQUIRED_MESSAGE}
                  </output>
                )}
              <Input
                label="存款金额（USDC）"
                value={amount}
                onChange={setAmount}
                inputMode="decimal"
                placeholder="至少 5 USDC"
                variant="bordered"
                size="md"
                inputWrapperClassName="bg-panel"
                readOnly={busy || f.pending}
                isInvalid={
                  !!amountError || !!(f.balances && units > f.balances.usdc)
                }
                errorMessage={
                  amountError ||
                  (f.balances && units > f.balances.usdc
                    ? '金额超过源链可用余额'
                    : '')
                }
                endContent={
                  <Button
                    variant="light"
                    size="sm"
                    isDisabled={busy || f.pending || !f.balances}
                    onPress={() =>
                      f.balances && setAmount(formatUnits(f.balances.usdc, 6))
                    }
                  >
                    最大值：
                    <span>
                      {f.balances ? formatUnits(f.balances.usdc, 6) : '—'}
                    </span>
                  </Button>
                }
              />
              {f.balances?.gas === 0n && (
                <output className="text-xs leading-5 text-loss">
                  源链 ETH 余额为 0，暂时无法支付 USDC 授权和存款 Gas。请先领取
                  Arbitrum Sepolia 测试 ETH，再刷新余额。
                  <a
                    className="ml-1 text-accent"
                    href="https://docs.arbitrum.io/chain-info"
                    target="_blank"
                    rel="noreferrer"
                  >
                    测试 ETH 水龙头列表 ↗
                  </a>
                </output>
              )}
              {f.chain !== DEPOSIT_CHAIN.id ? (
                <Button
                  className="w-full"
                  isDisabled={busy || f.pending}
                  onPress={f.switchChain}
                >
                  切换至 Arbitrum Sepolia
                </Button>
              ) : (
                <Button
                  className="w-full"
                  isDisabled={busy || f.pending || units === 0n || !sufficient}
                  onPress={() => f.deposit(amount)}
                >
                  {busy
                    ? f.record?.kind === 'approve'
                      ? f.record.status === 'submitted'
                        ? '等待 USDC 授权确认…'
                        : '请在钱包授权 USDC…'
                      : '请在钱包确认存款…'
                    : f.pending
                      ? '资金请求待确认'
                      : f.balances?.gas === 0n
                        ? '需要 Arbitrum Sepolia ETH'
                        : '存款'}
                </Button>
              )}
              <p className="text-xs leading-5 text-muted">
                {allowance
                  ? 'USDC 已授权。确认存款后等待跨链到账。'
                  : '点击存款后，请依次在钱包确认 USDC 授权与存款。已有足够授权时只需确认存款。'}
              </p>
              <details className="text-xs leading-5 text-muted">
                <summary className="cursor-pointer">没有测试资金？</summary>
                <p className="mt-2">
                  领取{' '}
                  <a
                    href="https://faucet.circle.com/"
                    target="_blank"
                    rel="noreferrer"
                    className="text-accent"
                  >
                    Circle 测试 USDC ↗
                  </a>{' '}
                  和 Arbitrum Sepolia ETH。
                  <a
                    href="https://app.hyperliquid-testnet.xyz/drip"
                    target="_blank"
                    rel="noreferrer"
                    className="text-accent"
                  >
                    Hyperliquid 水龙头 ↗
                  </a>{' '}
                  要求同一地址已有主网存款历史。
                </p>
              </details>
            </>
          )}
          {web3Panel === 'transfer' && (
            <>
              <p className="text-sm leading-6 text-muted">
                在您的合约和现货余额之间划转 USDC。
              </p>
              {f.core &&
              ['unifiedAccount', 'portfolioMargin'].includes(f.core.mode) ? (
                <p className="rounded-[8px] bg-panel p-3 text-sm leading-6">
                  当前为统一账户或组合保证金模式，资金共享。请在官方测试网页管理资金。
                </p>
              ) : (
                <>
                  <FundingRoute
                    from={transferToPerp ? '现货账户' : '合约账户'}
                    to={transferToPerp ? '合约账户' : '现货账户'}
                    onSwap={() => {
                      setTransferToPerp(!transferToPerp)
                      setAmount('')
                    }}
                    disabled={busy || f.pending}
                  />
                  <Input
                    label="划转金额（USDC）"
                    value={amount}
                    onChange={setAmount}
                    inputMode="decimal"
                    placeholder="输入划转金额"
                    isDisabled={busy || f.pending}
                    isInvalid={!!transferError}
                    errorMessage={transferError}
                    endContent={
                      <Button
                        variant="light"
                        size="sm"
                        isDisabled={busy || f.pending || !f.core}
                        onPress={() =>
                          setAmount(
                            new Money(transferAvailable)
                              .toDecimalPlaces(6, Money.ROUND_DOWN)
                              .toFixed(),
                          )
                        }
                      >
                        最大值：{display(transferAvailable, 6)}
                      </Button>
                    }
                  />
                  <Button
                    className="w-full"
                    isDisabled={
                      busy || f.pending || !f.core || !amount || !!transferError
                    }
                    onPress={() => model.transferFunds(amount, transferToPerp)}
                  >
                    {busy ? '等待钱包确认…' : '确认划转'}
                  </Button>
                  <p className="text-xs text-muted">
                    手续费 0 USDC，无需链上 Gas。
                  </p>
                </>
              )}
            </>
          )}
          {web3Panel === 'withdraw' && <WithdrawalForm model={model} />}
          <FundingStatus
            model={model}
            onContinue={() => {
              close()
              if (!authorized) void model.previewApproval()
            }}
          />
          {f.error && (
            <p role="alert" className="text-xs leading-5 text-loss">
              {f.error}
            </p>
          )}
          <div className="flex items-center justify-between border-t border-edge pt-3 text-xs">
            <Button
              variant="light"
              size="sm"
              isDisabled={f.loading || f.quoteLoading || busy}
              onPress={() => {
                void f.refresh()
                if (web3Panel === 'withdraw') void f.loadWithdrawalQuote()
              }}
            >
              {f.loading ? '查询中…' : '刷新余额'}
            </Button>
            <a
              className="text-accent"
              target="_blank"
              rel="noreferrer"
              href="https://app.hyperliquid-testnet.xyz/portfolio"
            >
              资金记录 ↗
            </a>
          </div>
        </>
      )}
    </Modal>
  )
}

function FundingStatus({
  model,
  onContinue,
}: {
  model: TerminalModel
  onContinue: () => void
}) {
  const [acknowledged, setAcknowledged] = useState(false)
  const { funding: f, busy, web3Panel } = model
  const record = f.record
  if (
    !record ||
    (!f.pending &&
      record.kind !== web3Panel &&
      !(record.kind === 'approve' && web3Panel === 'deposit') &&
      web3Panel !== 'wallet')
  )
    return null
  return (
    <output className="block space-y-2 rounded-[8px] border border-edge p-3 text-xs leading-5">
      <p className="font-medium">
        {record.kind === 'approve'
          ? 'USDC 授权'
          : record.kind === 'transfer'
            ? 'USDC 划转'
            : record.kind === 'withdraw'
              ? 'USDC 提款'
              : 'USDC 存款'}{' '}
        · {record.amount} USDC
      </p>
      <p>
        {record.status === 'credited'
          ? record.kind === 'withdraw'
            ? 'Arbitrum Sepolia 到账已核验'
            : 'Hyperliquid 到账已核验'
          : record.status === 'confirmed'
            ? record.kind === 'deposit'
              ? '源链已确认 · 等待 Hyperliquid 到账'
              : record.kind === 'withdraw'
                ? '目标链交易已找到 · 等待到账核验'
                : '操作已确认，请核对最新余额'
            : record.status === 'reverted'
              ? '操作已取消或失败'
              : record.status === 'submitted'
                ? record.kind === 'withdraw'
                  ? '提款请求已接受 · 等待跨链到账'
                  : '已提交 · 等待源链确认'
                : record.kind === 'approve' && !record.hash
                  ? '上次授权结果未确认。点击存款将重新读取授权额度，需要时请在钱包再次确认。'
                  : '结果未知，请核对钱包记录，勿重复提交'}
      </p>
      {record.hash && (
        <a
          target="_blank"
          rel="noreferrer"
          className="block text-accent"
          href={`https://sepolia.arbiscan.io/tx/${record.hash}`}
        >
          查看链上交易 ↗
        </a>
      )}
      <Button variant="light" size="sm" isDisabled={busy} onPress={f.check}>
        核对资金状态
      </Button>
      {record.kind === 'deposit' && record.status === 'credited' && (
        <Button className="w-full" onPress={onContinue}>
          {model.wallet?.exchange ? '返回交易' : '启用交易并继续'}
        </Button>
      )}
      {f.pending && (
        <details>
          <summary className="cursor-pointer text-muted">
            手动核对未确认请求
          </summary>
          <p className="my-2 text-muted">
            先到钱包及官方页面核对。解除保护不代表交易失败，尚在处理的请求仍可能完成。
          </p>
          <Checkbox isSelected={acknowledged} onValueChange={setAcknowledged}>
            已核对，没有待处理的资金请求
          </Checkbox>
          <Button
            variant="bordered"
            size="sm"
            isDisabled={!acknowledged || busy}
            onPress={() => {
              f.acknowledge()
              setAcknowledged(false)
            }}
          >
            解除本地保护
          </Button>
        </details>
      )}
    </output>
  )
}
