import {
  createPublicClient,
  createWalletClient,
  custom,
  decodeEventLog,
  encodePacked,
  erc20Abi,
  formatEther,
  http,
  type Log,
  pad,
  parseAbi,
  parseUnits,
  stringToHex,
  toHex,
  zeroAddress,
} from 'viem'
import { arbitrumSepolia } from 'viem/chains'
import { assertSession, info, type WalletSession } from './hyperliquid.ts'
import { Money, positiveDecimal } from './orders.ts'

export const DEPOSIT_CHAIN = arbitrumSepolia
export const DEPOSIT_RPC = 'https://sepolia-rollup.arbitrum.io/rpc'
export const DEPOSIT_USDC = '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d'
export const TOKEN_MESSENGER = '0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA'
export const CCTP_FORWARDER = '0x02e39ECb8368b41bF68FF99ff351aC9864e5E2a2'
export const depositClient = createPublicClient({
  chain: { ...DEPOSIT_CHAIN, fees: { baseFeeMultiplier: 2 } },
  transport: http(DEPOSIT_RPC, { retryCount: 0, timeout: 15000 }),
})
const messengerAbi = parseAbi([
  'function depositForBurnWithHook(uint256 amount, uint32 destinationDomain, bytes32 mintRecipient, address burnToken, bytes32 destinationCaller, uint256 maxFee, uint32 minFinalityThreshold, bytes hookData)',
])

function usdcAmount(value: string) {
  const amount = positiveDecimal(value, '金额')
  if (amount.decimalPlaces() > 6) throw new Error('USDC 金额精度最多 6 位小数')
  return amount
}
export function fundingAmount(value: string) {
  const amount = usdcAmount(value)
  if (amount.lt(5) || amount.gte(10000000))
    throw new Error('单笔充值须至少 5 USDC，且小于 10,000,000 USDC')
  return parseUnits(amount.toFixed(), 6)
}
export function transferAmount(value: string, available: string) {
  const amount = usdcAmount(value)
  const balance = new Money(available)
  if (!balance.isFinite() || balance.lt(0))
    throw new Error('可用余额无效，请刷新后重试')
  if (amount.gt(balance)) throw new Error('划转金额超过可用余额')
  return amount.toFixed()
}
export function depositParameters(address: `0x${string}`, amount: string) {
  return {
    address: TOKEN_MESSENGER,
    abi: messengerAbi,
    functionName: 'depositForBurnWithHook',
    args: [
      fundingAmount(amount),
      19,
      pad(CCTP_FORWARDER),
      DEPOSIT_USDC,
      pad(CCTP_FORWARDER),
      200000n,
      1000,
      encodePacked(
        ['bytes24', 'uint32', 'uint32', 'address', 'uint32'],
        [
          pad(stringToHex('cctp-forward'), { size: 24, dir: 'right' }),
          0,
          24,
          address,
          0,
        ],
      ),
    ],
  } as const
}
export async function depositBalances(address: `0x${string}`) {
  const [usdc, allowance, gas] = await Promise.all([
    depositClient.readContract({
      address: DEPOSIT_USDC,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [address],
    }),
    depositClient.readContract({
      address: DEPOSIT_USDC,
      abi: erc20Abi,
      functionName: 'allowance',
      args: [address, TOKEN_MESSENGER],
    }),
    depositClient.getBalance({ address }),
  ])
  return { usdc, allowance, gas }
}
export async function switchDepositChain(session: WalletSession) {
  await assertSession(session)
  try {
    await session.provider.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: toHex(DEPOSIT_CHAIN.id) }],
    })
  } catch (error) {
    if (
      !error ||
      typeof error !== 'object' ||
      !('code' in error) ||
      error.code !== 4902
    )
      throw error
    await session.provider.request({
      method: 'wallet_addEthereumChain',
      params: [
        {
          chainId: toHex(DEPOSIT_CHAIN.id),
          chainName: DEPOSIT_CHAIN.name,
          nativeCurrency: DEPOSIT_CHAIN.nativeCurrency,
          rpcUrls: [DEPOSIT_RPC],
          blockExplorerUrls: ['https://sepolia.arbiscan.io'],
        },
      ],
    })
    await session.provider.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: toHex(DEPOSIT_CHAIN.id) }],
    })
  }
  await assertDepositSession(session)
}
export async function assertDepositSession(session: WalletSession) {
  await assertSession(session)
  if (
    Number(await session.provider.request({ method: 'eth_chainId' })) !==
    DEPOSIT_CHAIN.id
  )
    throw new Error('请先切换到 Arbitrum Sepolia 测试网')
}
export type FundingWrite = 'approve' | 'deposit'
export async function sendDeposit(
  session: WalletSession,
  amount: string,
  kind: FundingWrite,
  beforeSend: () => void,
) {
  await assertDepositSession(session)
  const units = fundingAmount(amount)
  const balances = await depositBalances(session.address)
  if (balances.usdc < units) throw new Error('Arbitrum Sepolia USDC 余额不足')
  if (balances.gas === 0n) throw new Error('需要 Arbitrum Sepolia ETH 支付 Gas')
  const wallet = createWalletClient({
    account: session.address,
    chain: DEPOSIT_CHAIN,
    transport: custom(
      {
        request: async (args) => {
          try {
            return await session.provider.request(args)
          } catch (error) {
            const reason = depositRejectionMessage(error)
            // 不让 viem 把 Gas 拒绝当作参数错误，再尝试 wallet_sendTransaction。
            if (reason) throw new Error(reason, { cause: error })
            throw error
          }
        },
      },
      { retryCount: 0 },
    ),
  })
  const fees = await depositClient.estimateFeesPerGas()
  if (kind === 'approve') {
    const { request } = await depositClient.simulateContract({
      type: 'eip1559',
      ...fees,
      account: session.address,
      address: DEPOSIT_USDC,
      abi: erc20Abi,
      functionName: 'approve',
      args: [TOKEN_MESSENGER, units],
    })
    await assertDepositSession(session)
    beforeSend()
    return wallet.writeContract(request)
  }
  if (balances.allowance < units) throw new Error('请先授权本次 USDC 金额')
  const { request } = await depositClient.simulateContract({
    type: 'eip1559',
    ...fees,
    account: session.address,
    ...depositParameters(session.address, amount),
  })
  await assertDepositSession(session)
  beforeSend()
  return wallet.writeContract(request)
}

export interface FundingRecord {
  account: `0x${string}`
  amount: string
  kind: FundingWrite | 'transfer' | 'withdraw'
  sourceDex?: '' | 'spot'
  nonce?: number
  toPerp?: boolean
  hash?: `0x${string}`
  at: number
  status: 'submitted' | 'confirmed' | 'credited' | 'reverted' | 'unknown'
}
// 授权不划走资产；无哈希的授权可在重新读取 allowance 后由用户再次确认。
export function isFundingPending(record: FundingRecord | null) {
  return (
    !!record &&
    ((record.status === 'unknown' &&
      (record.kind !== 'approve' || !!record.hash)) ||
      record.status === 'submitted' ||
      (['deposit', 'withdraw'].includes(record.kind) &&
        record.status === 'confirmed'))
  )
}

export function depositRejectionMessage(error: unknown): string | null {
  let current = error
  for (
    let depth = 0;
    depth < 8 && current && typeof current === 'object';
    depth++
  ) {
    const message =
      'message' in current ? String(current.message).toLowerCase() : ''
    const name = 'name' in current ? current.name : ''
    if (
      name === 'FeeCapTooLowError' ||
      /max fee per gas less than block base fee|fee cap less than block base fee/.test(
        message,
      )
    )
      return 'Gas 费低于当前区块基础费，交易被拒绝。请重新点击存款，系统会重新估算 Gas；无需解除保护。'
    if (
      name === 'InsufficientFundsError' ||
      /insufficient funds for gas|insufficient funds for intrinsic transaction cost/.test(
        message,
      )
    )
      return '源链 ETH 不足以支付 Gas，交易被拒绝。补充测试 ETH 后可重新存款。'
    current = 'cause' in current ? current.cause : null
  }
  return null
}

export const fundingKey = (address: string) =>
  `hl-testnet-funding:${address.toLowerCase()}`
export function parseFundingRecord(
  value: string | null,
  address: string,
): FundingRecord | null {
  if (!value) return null
  const record = JSON.parse(value)
  if (
    !record ||
    record.account?.toLowerCase() !== address.toLowerCase() ||
    !['approve', 'deposit', 'transfer', 'withdraw'].includes(record.kind) ||
    !['submitted', 'confirmed', 'credited', 'reverted', 'unknown'].includes(
      record.status,
    ) ||
    (record.kind === 'withdraw' &&
      (!Number.isSafeInteger(record.nonce) ||
        record.nonce <= 0 ||
        !['', 'spot'].includes(record.sourceDex))) ||
    !Number.isSafeInteger(record.at) ||
    typeof record.amount !== 'string' ||
    (record.hash && !/^0x[0-9a-fA-F]{64}$/.test(record.hash))
  )
    throw new Error('本地资金记录格式异常，请先在官方页面核对')
  usdcAmount(record.amount)
  return record
}

export const WITHDRAWAL_FEE = '0.2'
export const evmClient = createPublicClient({
  transport: http('https://rpc.hyperliquid-testnet.xyz/evm', {
    retryCount: 0,
    timeout: 15000,
  }),
})
export function withdrawalAmount(value: string, available: string) {
  const amount = usdcAmount(value)
  if (amount.lt(0.4) || amount.gt(10000000))
    throw new Error('单笔提款须在 0.4 至 10,000,000 USDC 之间')
  const balance = new Money(available)
  if (!balance.isFinite() || balance.lt(0))
    throw new Error('可提余额无效，请刷新后重试')
  if (amount.gt(balance)) throw new Error('提款金额超过扣除费用后的可用余额')
  return amount.toFixed()
}
export function withdrawalParameters(
  address: `0x${string}`,
  amount: string,
  sourceDex: '' | 'spot',
) {
  return {
    token: 'USDC',
    amount,
    sourceDex,
    destinationRecipient: address.toLowerCase(),
    // 此字段是 CCTP 域编号，不是 Arbitrum Sepolia 的 EVM chainId。
    addressEncoding: 'hex',
    destinationChainId: 3,
    gasLimit: 200000,
    data: '0x',
  } as const
}
export function spotAvailable(
  spot: Awaited<ReturnType<typeof info.spotClearinghouseState>>,
  coin: string,
  shared: boolean,
) {
  const balance = spot.balances.find((item) => item.coin === coin)
  if (!balance || !('token' in balance)) return '0'
  const available = Money.max(0, new Money(balance.total).minus(balance.hold))
  if (!shared) return available.toFixed()
  const maintenance = spot.tokenToAvailableAfterMaintenance?.find(
    ([token]) => token === balance.token,
  )?.[1]
  return Money.max(0, Money.min(available, maintenance ?? '0')).toFixed()
}
export function withdrawalAvailable(
  available: string,
  gasHype: string,
  hypePrice: string,
  hypeBalance: string,
  activation: string,
) {
  const gasUsdc = new Money(hypeBalance).gte(gasHype)
    ? new Money(0)
    : new Money(gasHype).mul(hypePrice)
  return Money.max(0, new Money(available).minus(gasUsdc).minus(activation))
    .toDecimalPlaces(6, Money.ROUND_DOWN)
    .toFixed()
}
export async function withdrawalQuote(
  address: `0x${string}`,
  sourceDex?: '' | 'spot',
) {
  const [mode, perp, spot, gas, mids, activation, routing, bridgeFee] =
    await Promise.all([
      info.userAbstraction({ user: address }),
      info.clearinghouseState({ user: address }),
      info.spotClearinghouseState({ user: address }),
      evmClient.getGasPrice(),
      info.allMids(),
      info.preTransferCheck({
        user: '0x2000000000000000000000000000000000000000',
        source: address,
      }),
      info.usdcRouting(),
      evmClient.readContract({
        address: '0x0b80659a4076e9e93c7dbe0f10675a16a3e5c206',
        abi: parseAbi([
          'function calculateCrossChainWithdrawalFee(bool,uint32) view returns (uint256)',
        ]),
        functionName: 'calculateCrossChainWithdrawalFee',
        args: [true, 3],
      }),
    ])
  if (bridgeFee !== parseUnits(WITHDRAWAL_FEE, 6))
    throw new Error('CCTP 转发费已变化，请先在官方页面核对')
  if (routing.withdrawalRoute !== 'cctp')
    throw new Error('当前官方提款通道已变化，请前往官方资金管理核对')
  if (activation.isSanctioned) throw new Error('当前通道无法接收资金')
  const shared = ['unifiedAccount', 'portfolioMargin'].includes(mode)
  sourceDex ??= shared ? 'spot' : ''
  if (shared && sourceDex !== 'spot')
    throw new Error('统一账户请从共享现货余额提款')
  const hypePrice = positiveDecimal(mids.HYPE, 'HYPE 价格').toFixed()
  const gasHype = formatEther(gas * 200000n)
  const hypeBalance = spotAvailable(spot, 'HYPE', shared)
  const available = withdrawalAvailable(
    sourceDex === 'spot'
      ? spotAvailable(spot, 'USDC', shared)
      : perp.withdrawable,
    gasHype,
    hypePrice,
    hypeBalance,
    activation.fee,
  )
  return {
    account: address,
    sourceDex,
    gasHype,
    gasUsdc: new Money(gasHype).mul(hypePrice).toFixed(),
    gasInHype: new Money(hypeBalance).gte(gasHype),
    activationFee: activation.fee,
    available,
    at: Date.now(),
  }
}
export type WithdrawalQuote = Awaited<ReturnType<typeof withdrawalQuote>>
export function withdrawalTransaction(
  transfers: unknown,
  record: FundingRecord,
): `0x${string}` | null {
  if (
    !Array.isArray(transfers) ||
    record.kind !== 'withdraw' ||
    record.nonce == null
  )
    return null
  const matches = transfers.filter(
    (item) =>
      String(item?.nonce) === String(record.nonce) &&
      item.originChainId === 998 &&
      item.destinationChainId === DEPOSIT_CHAIN.id,
  )
  const hash = matches.length === 1 ? matches[0].fillTxnRef : null
  return typeof hash === 'string' && /^0x[0-9a-fA-F]{64}$/.test(hash)
    ? (hash as `0x${string}`)
    : null
}
export function receivedWithdrawal(
  logs: Pick<Log, 'address' | 'data' | 'topics'>[],
  record: FundingRecord,
  expected = parseUnits(
    new Money(record.amount).minus(WITHDRAWAL_FEE).toFixed(),
    6,
  ),
) {
  return logs.some((log) => {
    if (log.address.toLowerCase() !== DEPOSIT_USDC.toLowerCase()) return false
    try {
      const event = decodeEventLog({ abi: erc20Abi, ...log })
      return (
        event.eventName === 'Transfer' &&
        event.args.from === zeroAddress &&
        event.args.to.toLowerCase() === record.account.toLowerCase() &&
        event.args.value === expected
      )
    } catch {
      return false
    }
  })
}
