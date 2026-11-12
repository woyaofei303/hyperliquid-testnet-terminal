import { useCallback, useEffect, useRef, useState } from 'react'
import {
  errorText,
  isUserRejection,
  type WalletSession,
} from '@/shared/lib/fameex-testnet'
import {
  approvePhoneAgent,
  type PhoneAgent,
  PhoneApprovalBlockedError,
  phoneAgentToReplace,
  revokePhoneAgent,
  verifyPhoneAgent,
} from '../lib/phone-authorization'
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
  const [notice, setNotice] = useState('')
  const [devicesVersion, setDevicesVersion] = useState(0)
  const retired = useRef(new Set<string>())
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
        if (result.request) {
          const next = parsePhoneRequest(
            decryptPairing(pairing.offer, 'request', result.request),
            wallet.address,
          )
          if (retired.current.has(next.agentAddress.toLowerCase()))
            throw new Error(
              '该手机密钥已进入撤销流程，请在 App 删除旧密钥，再生成二维码重新扫码。',
            )
          setRequest(next)
        } else timer = setTimeout(poll, 2000)
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
        setError(isUserRejection(e) ? '已取消钱包确认。' : errorText(e))
      } finally {
        locked.current = false
        setBusy(false)
        onBusy(false)
      }
    },
    [onBusy],
  )
  const retire = async (device: PhoneAgent) => {
    setNotice(`请在主钱包确认撤销 ${device.name}，该手机随后将无法交易。`)
    const wasRetired = retired.current.has(device.address.toLowerCase())
    // 结果不明时也不重新授权旧密钥，避免恢复已清除的防重放状态。
    retired.current.add(device.address.toLowerCase())
    try {
      await revokePhoneAgent(wallet, device)
      setNotice(
        `已撤销 ${device.name}。该手机重新连接时，请先在 App 删除旧密钥。`,
      )
    } catch (e) {
      if (isUserRejection(e) && !wasRetired)
        retired.current.delete(device.address.toLowerCase())
      setNotice('')
      throw e
    } finally {
      setDevicesVersion((value) => value + 1)
    }
  }
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
      const oldest = await phoneAgentToReplace(wallet)
      if (attempt !== version.current) return
      if (oldest) {
        await retire(oldest)
        if (await phoneAgentToReplace(wallet))
          throw new Error('授权名额仍未释放，请刷新设备列表后重试。')
      }
      if (attempt !== version.current) return
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
      if (retired.current.has(request.agentAddress.toLowerCase()))
        throw new Error(
          '请在 App 删除旧密钥后重新扫码，不要重新授权已撤销的密钥。',
        )
      if (Date.now() >= pairing.offer.expiresAt)
        throw new Error('二维码已过期，请重新生成；不要签署旧请求')
      preserve.current = true
      setStatus('submitted')
      try {
        await approvePhoneAgent(wallet, request)
      } catch (e) {
        if (isUserRejection(e) || e instanceof PhoneApprovalBlockedError) {
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
    notice,
    devicesVersion,
    create,
    approve,
    revoke: (device: PhoneAgent) =>
      run(async () => {
        if (status === 'submitted') return
        await retire(device)
        if (
          request?.agentAddress.toLowerCase() === device.address.toLowerCase()
        ) {
          setPairing(null)
          setRequest(null)
          setStatus('idle')
        }
      }),
    verify: () =>
      run(async () => {
        try {
          await publish()
        } catch (e) {
          if (e instanceof PhoneApprovalBlockedError) {
            preserve.current = false
            setStatus('waiting')
          }
          throw e
        }
      }),
  }
}
