import assert from 'node:assert/strict'
import test from 'node:test'
import {
  decryptPairing,
  encryptPairing,
  pairingQR,
  parsePairingQR,
} from './phone-pairing.ts'

const now = 1800000000000
const offer = {
  version: 1 as const,
  relay: 'https://pair.example.com',
  id: '1'.repeat(32),
  token: '2'.repeat(64),
  key: '3'.repeat(64),
  account: `0x${'4'.repeat(40)}` as const,
  expiresAt: now + 300000,
}
test('二维码只接受配置的服务、测试网版本和有效期限', () => {
  const qr = pairingQR(offer)
  assert.deepEqual(parsePairingQR(qr, offer.relay, now), offer)
  assert.throws(() => parsePairingQR(qr, 'https://evil.example.com', now))
  assert.throws(() => parsePairingQR(qr, offer.relay, now + 300001))
  assert.throws(() =>
    parsePairingQR(qr.replace('"version":1', '"version":2'), offer.relay, now),
  )
})
test('消息必须通过密钥和配对编号校验，不能跨会话或跨阶段重放', () => {
  const value = { agent: `0x${'5'.repeat(40)}` }
  const envelope = encryptPairing(offer, 'request', value)
  assert.deepEqual(decryptPairing(offer, 'request', envelope), value)
  assert.throws(() =>
    decryptPairing({ ...offer, id: '6'.repeat(32) }, 'request', envelope),
  )
  assert.throws(() => decryptPairing(offer, 'approval', envelope))
  assert.throws(() =>
    decryptPairing({ ...offer, key: '7'.repeat(64) }, 'request', envelope),
  )
})

test('只有交易所返回的同名、同地址且未到期授权可以恢复', async () => {
  const { verifiedPhoneExpiry, parsePhoneRequest, phoneAgentName } =
    await import('./phone-pairing.ts')
  const address = `0x${'5'.repeat(40)}` as const
  const request = parsePhoneRequest(
    {
      account: offer.account,
      agentAddress: address,
      agentName: phoneAgentName(address),
      expiresAt: now + 100000,
    },
    offer.account,
    now,
  )
  const grant = { address, name: request.agentName, validUntil: now + 50000 }
  assert.equal(verifiedPhoneExpiry(request, [grant], now), grant.validUntil)
  for (const grants of [
    [],
    [{ ...grant, name: 'JulianTerminal' }],
    [{ ...grant, address: offer.account }],
    [{ ...grant, validUntil: now - 1 }],
  ])
    assert.throws(() => verifiedPhoneExpiry(request, grants, now))
  assert.throws(() =>
    parsePhoneRequest({ ...request, account: address }, offer.account, now),
  )
})
