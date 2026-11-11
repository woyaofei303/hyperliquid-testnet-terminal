import { useCallback, useEffect, useRef, useState } from 'react'
import {
  errorText,
  isUserRejection,
  type WalletSession,
} from '@/shared/lib/hyperliquid'
import { approvePhoneAgent, verifyPhoneAgent } from '../lib/phone-authorization'
import {
  decryptPairing,
  encryptPairing,
  type PairingOffer,
  type PhoneRequest,
  pairingFetch,
  pairingQR,
  parsePairingQR,
  parsePhoneRequest,
  randomHex,
  relayURL,
} from '../lib/phone-pairing'

const relay = process.env.NEXT_PUBLIC_PHONE_PAIRING_URL ?? ''
type Pairing = { offer: PairingOffer; webToken: string }
export function usePhonePairing(
  wallet: WalletSession,
  onBusy: (busy: boolean) => void,
) {
  const [pairing, setPairing] = useState<Pairing | null>(null)
  const [request, setRequest] = useState<PhoneRequest | null>(null)
  const [error, setError] = useState('')
  const [status, setStatus] = useState<
    'idle' | 'waiting' | 'submitted' | 'done'
  >('idle')
  const [busy, setBusy] = useState(false)
  const active = useRef<Pairing | null>(null)
  const version = useRef(0)
  const locked = useRef(false)
  const preserve = useRef(false)
  const approvalEnvelope = useRef<string | null>(null)
  useEffect(
    () => () => {
      version.current++
      const current = active.current
      if (current && !preserve.current)
        void pairingFetch(
          current.offer.relay,
          `/pairings/${current.offer.id}`,
          current.webToken,
          undefined,
          'DELETE',
        ).catch(() => {})
    },
    [],
  )
  useEffect(() => {
    if (!pairing || request) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      try {
        if (Date.now() >= pairing.offer.expiresAt)
          throw new Error('二维码已过期，请重新生成')
        const result = await pairingFetch(
          pairing.offer.relay,
          `/pairings/${pairing.offer.id}`,
          pairing.webToken,
        )
        if (cancelled) return
        if (result.request)
          setRequest(
            parsePhoneRequest(
              decryptPairing(pairing.offer, 'request', result.request),
              wallet.address,
            ),
          )
        else timer = setTimeout(poll, 2000)
      } catch (e) {
        if (!cancelled) setError(errorText(e))
      }
    }
    void poll()
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [pairing, request, wallet.address])
  const run = useCallback(
    async (operation: () => Promise<void>) => {
      if (locked.current) return
      locked.current = true
      setBusy(true)
      onBusy(true)
      setError('')
      try {
        await operation()
      } catch (e) {
        setError(errorText(e))
      } finally {
        locked.current = false
        setBusy(false)
        onBusy(false)
      }
    },
    [onBusy],
  )
  const create = () =>
    run(async () => {
      const attempt = ++version.current
      if (active.current && !preserve.current)
        await pairingFetch(
          active.current.offer.relay,
          `/pairings/${active.current.offer.id}`,
          active.current.webToken,
          undefined,
          'DELETE',
        ).catch(() => {})
      active.current = null
      preserve.current = false
      approvalEnvelope.current = null
      setPairing(null)
      setRequest(null)
      setStatus('idle')
      const endpoint = relayURL(relay)
      if (
        process.env.NODE_ENV === 'production' &&
        !endpoint.startsWith('https://')
      )
        throw new Error('正式环境的配对服务必须使用 HTTPS')
      const result = await pairingFetch(
        endpoint,
        '/pairings',
        undefined,
        {},
        'POST',
      )
      const offer: PairingOffer = {
        version: 1,
        relay: endpoint,
        id: result.id,
        token: result.phoneToken,
        key: randomHex(32),
        account: wallet.address,
        expiresAt: result.expiresAt,
      }
      parsePairingQR(pairingQR(offer), endpoint)
      if (
        typeof result.webToken !== 'string' ||
        !/^[a-f0-9]{64}$/.test(result.webToken)
      )
        throw new Error('配对服务返回格式无效')
      const next = { offer, webToken: result.webToken }
      if (attempt !== version.current) {
        await pairingFetch(
          endpoint,
          `/pairings/${offer.id}`,
          next.webToken,
          undefined,
          'DELETE',
        )
        return
      }
      active.current = next
      setPairing(next)
      setStatus('waiting')
    })
  const publish = async () => {
    if (!pairing || !request) return
    await verifyPhoneAgent(wallet, request)
    approvalEnvelope.current ??= encryptPairing(
      pairing.offer,
      'approval',
      request,
    )
    await pairingFetch(
      pairing.offer.relay,
      `/pairings/${pairing.offer.id}/approval`,
      pairing.webToken,
      { envelope: approvalEnvelope.current },
    )
    setStatus('done')
  }
  const approve = () =>
    run(async () => {
      if (!pairing || !request || status !== 'waiting') return
      if (Date.now() >= pairing.offer.expiresAt)
        throw new Error('二维码已过期，请重新生成；不要签署旧请求')
      preserve.current = true
      setStatus('submitted')
      try {
        await approvePhoneAgent(wallet, request)
      } catch (e) {
        if (isUserRejection(e)) {
          preserve.current = false
          setStatus('waiting')
        } else
          throw new Error(
            `${errorText(e)}；授权结果待核验，请点「查询授权结果」，不会自动重复签名。`,
          )
        throw e
      }
      await publish()
    })
  return {
    configured: !!relay,
    pairing,
    request,
    status,
    busy,
    error,
    create,
    approve,
    verify: () => run(publish),
  }
}
