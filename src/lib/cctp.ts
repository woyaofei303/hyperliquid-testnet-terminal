import {
  decodeEventLog,
  encodePacked,
  type Hex,
  type Log,
  pad,
  parseAbi,
  parseUnits,
  stringToHex,
} from 'viem'
import {
  CCTP_FORWARDER,
  DEPOSIT_USDC,
  depositParameters,
  type FundingRecord,
  TOKEN_MESSENGER,
  WITHDRAWAL_FEE,
} from './funding.ts'

export const CORE_DEPOSIT_WALLET = '0x0b80659a4076e9e93c7dbe0f10675a16a3e5c206'
const CORE_USDC = '0x2b3370ee501b4a559b57d449569354196457d8ab'
const MESSAGE_TRANSMITTER = '0xe737e5cebeeba77efe34d4aa090756590b1ce275'
const abi = parseAbi([
  'event MessageReceived(address indexed caller, uint32 sourceDomain, bytes32 indexed nonce, bytes32 sender, uint32 indexed finalityThresholdExecuted, bytes messageBody)',
  'event MintAndForward(address indexed forwardRecipient, address indexed forwardingAddress, address indexed token, uint32 destinationId, uint256 amount)',
  'event SendAsset(address indexed coreRecipient, uint64 coreAmount, uint32 destinationDex)',
])
type CctpLog = Pick<Log, 'address' | 'topics' | 'data'>
function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : {}
}
function same(a: unknown, b: string) {
  return typeof a === 'string' && a.toLowerCase() === b.toLowerCase()
}
function hash(value: unknown): value is Hex {
  return typeof value === 'string' && /^0x[0-9a-fA-F]{64}$/.test(value)
}

// Circle 的 CCTP nonce 与 HyperCore nonce 不同，不能用旧桥索引替代消息核验。
export function cctpMessage(value: unknown, record: FundingRecord) {
  const messages = object(value).messages
  if (!Array.isArray(messages) || messages.length !== 1) return null
  const item = object(messages[0])
  const message = object(item.decodedMessage)
  const body = object(message.decodedMessageBody)
  if (record.kind !== 'deposit') return null
  const hook = depositParameters(record.account, record.amount).args[7]
  if (
    item.cctpVersion !== 2 ||
    item.status !== 'complete' ||
    !hash(item.destinationMintTxHash) ||
    !hash(item.eventNonce) ||
    !same(message.nonce, item.eventNonce) ||
    String(message.sourceDomain) !== '3' ||
    String(message.destinationDomain) !== '19' ||
    !same(message.sender, TOKEN_MESSENGER) ||
    !same(message.recipient, TOKEN_MESSENGER) ||
    !same(body.burnToken, DEPOSIT_USDC) ||
    !same(body.mintRecipient, CCTP_FORWARDER) ||
    !same(body.messageSender, record.account) ||
    !same(body.hookData, hook) ||
    body.amount !== parseUnits(record.amount, 6).toString() ||
    typeof body.feeExecuted !== 'string' ||
    !/^\d+$/.test(body.feeExecuted) ||
    BigInt(body.feeExecuted) > parseUnits(WITHDRAWAL_FEE, 6) ||
    typeof message.messageBody !== 'string' ||
    !/^0x(?:[0-9a-fA-F]{2})+$/.test(message.messageBody)
  )
    return null
  return {
    hash: item.destinationMintTxHash,
    nonce: item.eventNonce,
    messageBody: message.messageBody as Hex,
    netAmount: parseUnits(record.amount, 6) - BigInt(body.feeExecuted),
  }
}
export async function readCctpMessage(sourceHash: Hex, record: FundingRecord) {
  const response = await fetch(
    `https://iris-api-sandbox.circle.com/v2/messages/3?transactionHash=${sourceHash}`,
    { signal: AbortSignal.timeout(10000) },
  )
  if (response.status === 404) return null
  if (!response.ok) throw new Error('CCTP 消息暂不可用，请稍后核对，勿重复提交')
  return cctpMessage(await response.json(), record)
}
type CctpMessage = NonNullable<ReturnType<typeof cctpMessage>>
function events(logs: CctpLog[]) {
  return logs.flatMap((log) => {
    try {
      return [{ address: log.address, event: decodeEventLog({ abi, ...log }) }]
    } catch {
      return []
    }
  })
}
export function receivedCctp(
  logs: CctpLog[],
  message: CctpMessage,
  sourceDomain: number,
) {
  return events(logs).some(
    ({ address, event }) =>
      same(address, MESSAGE_TRANSMITTER) &&
      event.eventName === 'MessageReceived' &&
      event.args.sourceDomain === sourceDomain &&
      same(event.args.nonce, message.nonce) &&
      same(event.args.sender, pad(TOKEN_MESSENGER)) &&
      same(event.args.messageBody, message.messageBody),
  )
}
export function creditedDeposit(
  logs: CctpLog[],
  timestamp: bigint,
  message: CctpMessage,
  ledger: unknown,
  record: FundingRecord,
) {
  if (!Array.isArray(ledger) || !receivedCctp(logs, message, 3)) return false
  const decoded = events(logs)
  if (
    !decoded.some(
      ({ address, event }) =>
        same(address, CCTP_FORWARDER) &&
        event.eventName === 'MintAndForward' &&
        same(event.args.forwardRecipient, record.account) &&
        same(event.args.forwardingAddress, CORE_DEPOSIT_WALLET) &&
        same(event.args.token, CORE_USDC) &&
        event.args.destinationId === 0 &&
        event.args.amount === message.netAmount,
    )
  )
    return false
  const sends = decoded.filter(
    ({ address, event }) =>
      same(address, CORE_DEPOSIT_WALLET) &&
      event.eventName === 'SendAsset' &&
      same(event.args.coreRecipient, record.account) &&
      event.args.destinationDex === 0,
  )
  if (sends.length !== 1 || sends[0].event.eventName !== 'SendAsset')
    return false
  const amount = sends[0].event.args.coreAmount
  if (amount <= 0n || amount > message.netAmount * 100n) return false
  // EVM→Core 在同一个 L1 区块处理；同秒出现多个同额流水时保留待核对，不能猜配。
  return (
    ledger.filter((item) => {
      const entry = object(item)
      const delta = object(entry.delta)
      return (
        typeof entry.time === 'number' &&
        Math.floor(entry.time / 1000) === Number(timestamp) &&
        delta.type === 'send' &&
        same(delta.user, CORE_DEPOSIT_WALLET) &&
        same(delta.destination, record.account) &&
        delta.sourceDex === 'spot' &&
        delta.destinationDex === '' &&
        delta.token === 'USDC' &&
        typeof delta.amount === 'string' &&
        /^\d+(\.\d{1,8})?$/.test(delta.amount) &&
        parseUnits(delta.amount, 8) === amount
      )
    }).length === 1
  )
}

// 系统交易不在普通 EVM 日志中；在目标 MessageReceived 的 hook 中核对原 HyperCore nonce。
export function withdrawalMessageAmount(
  logs: CctpLog[],
  record: FundingRecord,
) {
  if (record.kind !== 'withdraw' || record.nonce == null) return null
  const prefix = encodePacked(
    ['uint32', 'bytes32', 'bytes32', 'uint256', 'bytes32'],
    [
      1,
      pad(CORE_USDC),
      pad(record.account),
      parseUnits(record.amount, 6),
      pad(CORE_DEPOSIT_WALLET),
    ],
  ).toLowerCase()
  const magic = pad(stringToHex('cctp-forward'), { size: 24, dir: 'right' })
  const hooks = ['0x', magic].map((data) =>
    encodePacked(
      ['bytes24', 'uint32', 'uint32', 'address', 'uint64', 'bytes'],
      [
        magic,
        0,
        28 + (data.length - 2) / 2,
        record.account,
        BigInt(record.nonce as number),
        data as Hex,
      ],
    ).toLowerCase(),
  )
  for (const { address, event } of events(logs)) {
    if (
      !same(address, MESSAGE_TRANSMITTER) ||
      event.eventName !== 'MessageReceived' ||
      event.args.sourceDomain !== 19 ||
      !same(event.args.sender, pad(TOKEN_MESSENGER))
    )
      continue
    const body = event.args.messageBody.toLowerCase()
    if (
      !body.startsWith(prefix) ||
      body.length < 458 ||
      !hooks.includes(`0x${body.slice(458)}`)
    )
      continue
    const maxFee = BigInt(`0x${body.slice(266, 330)}`)
    const fee = BigInt(`0x${body.slice(330, 394)}`)
    if (maxFee > parseUnits(WITHDRAWAL_FEE, 6) || fee > maxFee) continue
    return parseUnits(record.amount, 6) - fee
  }
  return null
}
