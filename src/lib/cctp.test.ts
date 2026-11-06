import assert from 'node:assert/strict'
import test from 'node:test'
import { cctpFixture, coreWallet } from '../../tests/cctp-fixtures.ts'
import type { FundingRecord } from './funding.ts'

const account = '0x1111111111111111111111111111111111111111'
const record: FundingRecord = {
  account,
  amount: '10',
  kind: 'deposit',
  hash: `0x${'bb'.repeat(32)}`,
  at: 1000,
  status: 'confirmed',
}

test('CCTP 接受实网消息形状，拒绝错域、错币、错收款人、超额桥费和模糊消息', async () => {
  const { cctpMessage } = await import('./cctp.ts')
  const { message } = cctpFixture(account)
  assert.ok(cctpMessage({ messages: [message] }, record))
  assert.equal(cctpMessage({ messages: [] }, record), null)
  assert.equal(cctpMessage({ messages: [message, message] }, record), null)
  for (const changed of [
    { sourceDomain: '0' },
    { destinationDomain: '3' },
    { nonce: '0x00' },
  ])
    assert.equal(
      cctpMessage(
        {
          messages: [
            {
              ...message,
              decodedMessage: { ...message.decodedMessage, ...changed },
            },
          ],
        },
        record,
      ),
      null,
    )
  for (const changed of [
    { amount: '11000000' },
    { feeExecuted: '200001' },
    { burnToken: account },
    { mintRecipient: account },
    { messageSender: coreWallet },
    { hookData: '0x' },
  ])
    assert.equal(
      cctpMessage(
        {
          messages: [
            {
              ...message,
              decodedMessage: {
                ...message.decodedMessage,
                decodedMessageBody: {
                  ...message.decodedMessage.decodedMessageBody,
                  ...changed,
                },
              },
            },
          ],
        },
        record,
      ),
      null,
    )
})

test('CCTP 存款要求目标消息、转发事件和同区块唯一 HyperCore 流水，不能用 CCTP nonce 代替 Core nonce', async () => {
  const { cctpMessage, creditedDeposit } = await import('./cctp.ts')
  const { message, receipt } = cctpFixture(account)
  const proof = cctpMessage({ messages: [message] }, record)
  assert.ok(proof)
  const entry = {
    time: 2000400,
    delta: {
      type: 'send',
      user: coreWallet,
      destination: account,
      sourceDex: 'spot',
      destinationDex: '',
      token: 'USDC',
      amount: '9.8',
      nonce: 696692,
    },
  }
  assert.equal(
    creditedDeposit(receipt.logs, 2000n, proof, [entry], record),
    true,
  )
  for (const logs of [[], receipt.logs.slice(1), receipt.logs.slice(0, 2)])
    assert.equal(creditedDeposit(logs, 2000n, proof, [entry], record), false)
  assert.equal(
    creditedDeposit(receipt.logs, 2001n, proof, [entry], record),
    false,
  )
  assert.equal(
    creditedDeposit(receipt.logs, 2000n, proof, [entry, entry], record),
    false,
  )
  for (const changed of [
    { amount: '10' },
    { token: 'BTC' },
    { user: account },
    { destination: coreWallet },
    { destinationDex: 'spot' },
  ])
    assert.equal(
      creditedDeposit(
        receipt.logs,
        2000n,
        proof,
        [{ ...entry, delta: { ...entry.delta, ...changed } }],
        record,
      ),
      false,
    )
})

test('提现以目标链 CCTP 消息核对原账户、金额和 nonce，支持默认与显式转发', async () => {
  const { withdrawalMessageAmount } = await import('./cctp.ts')
  const withdraw: FundingRecord = {
    ...record,
    kind: 'withdraw',
    sourceDex: '',
    nonce: 123,
  }
  for (const data of [
    '0x',
    '0x636374702d666f7277617264000000000000000000000000',
  ] as const) {
    const { receipt } = cctpFixture(account, true, 123, '10', data)
    assert.equal(withdrawalMessageAmount(receipt.logs, withdraw), 9800000n)
    assert.equal(
      withdrawalMessageAmount(receipt.logs, { ...withdraw, nonce: 124 }),
      null,
    )
    assert.equal(
      withdrawalMessageAmount(receipt.logs, { ...withdraw, amount: '11' }),
      null,
    )
    assert.equal(
      withdrawalMessageAmount(
        receipt.logs.map((log) => ({ ...log, address: account })),
        withdraw,
      ),
      null,
    )
  }
})

test('提现索引不能把主网或其他 nonce 的记录作为候选，也不接受重复候选', async () => {
  const { withdrawalTransaction } = await import('./funding.ts')
  const withdraw: FundingRecord = {
    ...record,
    kind: 'withdraw',
    nonce: 123,
    sourceDex: '',
  }
  const entry = {
    originChainId: 998,
    destinationChainId: 421614,
    nonce: '123',
    fillTxnRef: `0x${'ee'.repeat(32)}`,
  }
  assert.equal(withdrawalTransaction([entry], withdraw), entry.fillTxnRef)
  for (const changed of [
    { originChainId: 1337 },
    { destinationChainId: 42161 },
    { nonce: '124' },
    { fillTxnRef: '0x0' },
  ])
    assert.equal(
      withdrawalTransaction([{ ...entry, ...changed }], withdraw),
      null,
    )
  assert.equal(withdrawalTransaction([entry, entry], withdraw), null)
})
