import assert from 'node:assert/strict'
import test from 'node:test'
import type { Log } from 'viem'
import type { FundingRecord } from './funding.ts'
import { depositParameters, fundingAmount, transferAmount } from './funding.ts'

const user = '0x1111111111111111111111111111111111111111'
test('CCTP 固定测试网目标、收款人和 USDC 精度，拒绝低于最低充值额或超限', () => {
  const params = depositParameters(user, '10.123456')
  assert.equal(params.args[0], 10123456n)
  assert.equal(params.args[1], 19)
  assert.equal(params.args[5], 200000n)
  assert.equal(params.args[6], 1000)
  assert.equal(params.args[7].length, 114)
  assert.equal(params.args[7].slice(66, 106), user.slice(2))
  assert.equal(params.args[7].slice(-8), '00000000')
  for (const amount of ['0', '-1', '4.999999', '5.0000001', '1e3', '10000000'])
    assert.throws(() => fundingAmount(amount))
  assert.equal(fundingAmount('5'), 5000000n)
})
test('划转校验可用余额而非总余额，不截断用户金额', () => {
  assert.equal(transferAmount('1.000001', '2'), '1.000001')
  assert.throws(() => transferAmount('3', '2'), /余额/)
  assert.throws(() => transferAmount('0.0000001', '2'), /精度/)
})

test('跨链到账要求哈希、源链、nonce 与 HyperCore 收款流水一致', async () => {
  const { creditedDeposit } = await import('./funding.ts')
  const record: FundingRecord = {
    account: user,
    amount: '10',
    kind: 'deposit',
    at: 1,
    status: 'confirmed' as const,
    hash: `0x${'ab'.repeat(32)}` as `0x${string}`,
  }
  const transfers = [
    { depositTxnRef: record.hash, originChainId: 421614, nonce: '77' },
  ]
  const ledger = [
    {
      delta: {
        type: 'send',
        destination: user,
        nonce: 77,
        token: 'USDC:0xabc',
      },
    },
  ]
  assert.equal(creditedDeposit(transfers, [], record), false)
  assert.equal(creditedDeposit([], ledger, record), false)
  assert.equal(creditedDeposit(transfers, ledger, record), true)
  assert.equal(
    creditedDeposit(
      [{ ...transfers[0], originChainId: 42161 }],
      ledger,
      record,
    ),
    false,
  )
  assert.equal(
    creditedDeposit(
      transfers,
      [{ delta: { ...ledger[0].delta, nonce: 78 } }],
      record,
    ),
    false,
  )
  assert.equal(
    creditedDeposit(
      transfers,
      [{ delta: { ...ledger[0].delta, destination: `0x${'22'.repeat(20)}` } }],
      record,
    ),
    false,
  )
})

test('资金请求持久化只接受当前账户和合法交易记录', async () => {
  const { parseFundingRecord } = await import('./funding.ts')
  const record = {
    account: user,
    amount: '10',
    kind: 'deposit',
    at: 1,
    status: 'unknown',
  }
  assert.equal(parseFundingRecord(null, user), null)
  assert.deepEqual(parseFundingRecord(JSON.stringify(record), user), record)
  assert.throws(() =>
    parseFundingRecord(JSON.stringify(record), `0x${'22'.repeat(20)}`),
  )
  assert.throws(() =>
    parseFundingRecord(
      JSON.stringify({ ...record, hash: 'javascript:alert(1)' }),
      user,
    ),
  )
})

test('提款固定 CCTP 域 3、当前收款地址，校验最低金额与可提余额', async () => {
  const { withdrawalParameters, withdrawalAmount } = await import(
    './funding.ts'
  )
  assert.equal(withdrawalAmount('0.4', '1'), '0.4')
  for (const value of ['0.399999', '1.0000001', '10000000.01', '-1'])
    assert.throws(() => withdrawalAmount(value, '20000000'))
  assert.throws(() => withdrawalAmount('1.1', '1'), /余额/)
  assert.throws(() => withdrawalAmount('1', 'NaN'), /余额/)
  assert.throws(() => transferAmount('1', 'Infinity'), /余额/)
  assert.deepEqual(withdrawalParameters(user, '10', 'spot'), {
    token: 'USDC',
    amount: '10',
    sourceDex: 'spot',
    destinationRecipient: user,
    addressEncoding: 'hex',
    destinationChainId: 3,
    gasLimit: 200000,
    data: '0x',
  })
})

test('提款可用额扣除维护保证金限制、Gas 预留与激活费', async () => {
  const { withdrawalAvailable, spotAvailable } = await import('./funding.ts')
  const spot = {
    balances: [
      { coin: 'USDC', token: 0, total: '100', hold: '10', entryNtl: '0' },
    ],
    tokenToAvailableAfterMaintenance: [[0, '30']] as [number, string][],
  }
  assert.equal(spotAvailable(spot, 'USDC', false), '90')
  assert.equal(spotAvailable(spot, 'USDC', true), '30')
  assert.equal(spotAvailable({ balances: spot.balances }, 'USDC', true), '0')
  assert.equal(withdrawalAvailable('30', '0.00002', '2500', '0', '1'), '28.95')
  assert.equal(withdrawalAvailable('30', '0.00002', '2500', '1', '0'), '30')
})

test('提款状态按 nonce 和测试网链匹配，不把主网或别的请求当作到账', async () => {
  const { withdrawalTransaction, parseFundingRecord } = await import(
    './funding.ts'
  )
  const record: FundingRecord = {
    account: user,
    amount: '10',
    kind: 'withdraw',
    sourceDex: '',
    nonce: 123,
    at: 123,
    status: 'submitted',
  }
  const hash = `0x${'cd'.repeat(32)}`
  assert.equal(
    withdrawalTransaction(
      [{ nonce: '123', destinationChainId: 421614, fillTxnRef: hash }],
      record,
    ),
    hash,
  )
  assert.equal(
    withdrawalTransaction(
      [{ nonce: '123', destinationChainId: 42161, fillTxnRef: hash }],
      record,
    ),
    null,
  )
  assert.equal(
    withdrawalTransaction(
      [{ nonce: '124', destinationChainId: 421614, fillTxnRef: hash }],
      record,
    ),
    null,
  )
  assert.equal(
    withdrawalTransaction(
      [{ nonce: '123', destinationChainId: 421614 }],
      record,
    ),
    null,
  )
  assert.throws(() =>
    parseFundingRecord(JSON.stringify({ ...record, nonce: undefined }), user),
  )
})

test('目标链提款到账须包含足额 USDC Transfer，其他币种、收款人或空日志不算到账', async () => {
  const { DEPOSIT_USDC, receivedWithdrawal } = await import('./funding.ts')
  const { toEventSelector, pad, encodeAbiParameters, zeroAddress } =
    await import('viem')
  const record: FundingRecord = {
    account: user,
    amount: '10',
    kind: 'withdraw',
    sourceDex: '',
    nonce: 123,
    at: 123,
    status: 'confirmed',
  }
  const log: Pick<Log, 'address' | 'topics' | 'data'> = {
    address: DEPOSIT_USDC,
    topics: [
      toEventSelector('Transfer(address,address,uint256)'),
      pad(zeroAddress),
      pad(user),
    ],
    data: encodeAbiParameters([{ type: 'uint256' }], [9800000n]),
  }
  assert.equal(receivedWithdrawal([log], record), true)
  assert.equal(receivedWithdrawal([], record), false)
  assert.equal(
    receivedWithdrawal([{ ...log, address: zeroAddress }], record),
    false,
  )
  assert.equal(
    receivedWithdrawal(
      [{ ...log, data: encodeAbiParameters([{ type: 'uint256' }], [1n]) }],
      record,
    ),
    false,
  )
  assert.equal(
    receivedWithdrawal(
      [
        {
          ...log,
          topics: [
            toEventSelector('Transfer(address,address,uint256)'),
            pad(user),
            pad(zeroAddress),
          ],
        },
      ],
      record,
    ),
    false,
  )
})

test('资金失败分类仅识别明确拒绝，超时和 nonce 冲突仍按未知处理', async () => {
  const { depositRejectionMessage } = await import('./funding.ts')
  assert.match(
    depositRejectionMessage(
      new Error('wrapper', {
        cause: {
          code: -32000,
          message:
            'max fee per gas less than block base fee: maxFeePerGas: 20122000 baseFee: 20600000',
        },
      }),
    ) ?? '',
    /Gas 费低于/,
  )
  assert.match(
    depositRejectionMessage({ name: 'InsufficientFundsError' }) ?? '',
    /ETH 不足/,
  )
  for (const message of [
    'timeout',
    'wallet response lost',
    'nonce too low',
    'already known',
    'execution reverted',
  ])
    assert.equal(depositRejectionMessage(new Error(message)), null)
})

test('无哈希授权不标记待处理，未知或在途资金记录仍需核对结果', async () => {
  const { isFundingPending } = await import('./funding.ts')
  const record: FundingRecord = {
    account: user,
    amount: '10',
    kind: 'approve',
    at: 1,
    status: 'unknown',
  }
  assert.equal(isFundingPending(record), false)
  assert.equal(
    isFundingPending({ ...record, hash: `0x${'ab'.repeat(32)}` }),
    true,
  )
  assert.equal(isFundingPending({ ...record, status: 'submitted' }), true)
  assert.equal(isFundingPending({ ...record, status: 'confirmed' }), false)
  for (const kind of ['deposit', 'withdraw', 'transfer'] as const)
    assert.equal(isFundingPending({ ...record, kind }), true)
  assert.equal(
    isFundingPending({ ...record, kind: 'deposit', status: 'confirmed' }),
    true,
  )
  assert.equal(isFundingPending({ ...record, status: 'reverted' }), false)
})
