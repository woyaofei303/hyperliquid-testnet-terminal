import {
  encodeAbiParameters,
  encodeEventTopics,
  encodePacked,
  type Hex,
  type Log,
  pad,
  parseAbi,
  parseUnits,
  stringToHex,
} from 'viem'

// 来自测试网实际 CCTP 返回形状；地址、哈希和 nonce 使用固定测试值。
export const coreWallet = '0x0b80659a4076e9e93c7dbe0f10675a16a3e5c206'
export const coreUsdc = '0x2b3370ee501b4a559b57d449569354196457d8ab'
export const forwarder = '0x02e39ecb8368b41bf68ff99ff351ac9864e5e2a2'
const messenger = '0x8fe6b999dc680ccfdd5bf7eb0974218be2542daa'
const arbUsdc = '0x75faf114eafb1bdbe2f0316df893fd58ce46aa4d'
export const mintHash = `0x${'ee'.repeat(32)}` as const
export const burnHash = `0x${'bb'.repeat(32)}` as const
export const cctpNonce = `0x${'ab'.repeat(32)}` as const
export const receiptAbi = parseAbi([
  'event MessageReceived(address indexed caller, uint32 sourceDomain, bytes32 indexed nonce, bytes32 sender, uint32 indexed finalityThresholdExecuted, bytes messageBody)',
  'event MintAndForward(address indexed forwardRecipient, address indexed forwardingAddress, address indexed token, uint32 destinationId, uint256 amount)',
  'event SendAsset(address indexed coreRecipient, uint64 coreAmount, uint32 destinationDex)',
])
export function cctpFixture(
  account: `0x${string}`,
  withdraw = false,
  nonce = 123,
  amount = '10',
  data: Hex = '0x',
) {
  const units = parseUnits(amount, 6)
  const net = units - 200000n
  const hook = withdraw
    ? encodePacked(
        ['bytes24', 'uint32', 'uint32', 'address', 'uint64', 'bytes'],
        [
          pad(stringToHex('cctp-forward'), { size: 24, dir: 'right' }),
          0,
          28 + (data.length - 2) / 2,
          account,
          BigInt(nonce),
          data,
        ],
      )
    : encodePacked(
        ['bytes24', 'uint32', 'uint32', 'address', 'uint32'],
        [
          pad(stringToHex('cctp-forward'), { size: 24, dir: 'right' }),
          0,
          24,
          account,
          0,
        ],
      )
  const messageBody = encodePacked(
    [
      'uint32',
      'bytes32',
      'bytes32',
      'uint256',
      'bytes32',
      'uint256',
      'uint256',
      'uint256',
      'bytes',
    ],
    [
      1,
      pad(withdraw ? coreUsdc : arbUsdc),
      pad(withdraw ? account : forwarder),
      units,
      pad(withdraw ? coreWallet : account),
      200000n,
      200000n,
      0n,
      hook,
    ],
  )
  const message = {
    eventNonce: cctpNonce,
    cctpVersion: 2,
    status: 'complete',
    forwardState: 'COMPLETE',
    destinationMintTxHash: mintHash,
    forwardTxHash: mintHash,
    decodedMessage: {
      sourceDomain: withdraw ? '19' : '3',
      destinationDomain: withdraw ? '3' : '19',
      nonce: cctpNonce,
      sender: messenger,
      recipient: messenger,
      messageBody,
      decodedMessageBody: {
        burnToken: withdraw ? coreUsdc : arbUsdc,
        mintRecipient: withdraw ? account : forwarder,
        amount: units.toString(),
        messageSender: withdraw ? coreWallet : account,
        feeExecuted: '200000',
        hookData: hook,
      },
    },
  }
  const receipt = {
    transactionHash: mintHash,
    transactionIndex: '0x0',
    blockHash: `0x${'cc'.repeat(32)}`,
    blockNumber: '0x1',
    from: forwarder,
    to: forwarder,
    cumulativeGasUsed: '0x5208',
    gasUsed: '0x5208',
    effectiveGasPrice: '0x1',
    contractAddress: null,
    logsBloom: `0x${'00'.repeat(256)}`,
    status: '0x1',
    type: '0x2',
    logs: [
      {
        address: '0xe737e5cebeeba77efe34d4aa090756590b1ce275' as const,
        topics: concreteTopics(
          encodeEventTopics({
            abi: receiptAbi,
            eventName: 'MessageReceived',
            args: {
              caller: forwarder,
              nonce: cctpNonce,
              finalityThresholdExecuted: 1000,
            },
          }),
        ),
        data: encodeAbiParameters(
          [{ type: 'uint32' }, { type: 'bytes32' }, { type: 'bytes' }],
          [withdraw ? 19 : 3, pad(messenger), messageBody],
        ),
      },
      ...(withdraw
        ? []
        : [
            {
              address: forwarder as typeof forwarder,
              topics: concreteTopics(
                encodeEventTopics({
                  abi: receiptAbi,
                  eventName: 'MintAndForward',
                  args: {
                    forwardRecipient: account,
                    forwardingAddress: coreWallet,
                    token: coreUsdc,
                  },
                }),
              ),
              data: encodeAbiParameters(
                [{ type: 'uint32' }, { type: 'uint256' }],
                [0, net],
              ),
            },
            {
              address: coreWallet as typeof coreWallet,
              topics: concreteTopics(
                encodeEventTopics({
                  abi: receiptAbi,
                  eventName: 'SendAsset',
                  args: { coreRecipient: account },
                }),
              ),
              data: encodeAbiParameters(
                [{ type: 'uint64' }, { type: 'uint32' }],
                [net * 100n, 0],
              ),
            },
          ]),
    ],
  }
  return { message, receipt }
}

function concreteTopics(
  topics: ReturnType<typeof encodeEventTopics>,
): Log['topics'] {
  if (topics.some((topic) => typeof topic !== 'string'))
    throw new Error('Fixture topics must be concrete')
  return topics as Log['topics']
}
