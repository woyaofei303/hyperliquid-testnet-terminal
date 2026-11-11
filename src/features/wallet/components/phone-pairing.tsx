import { Button, Checkbox } from '@fameex/ui'
import { QRCodeSVG } from 'qrcode.react'
import { useState } from 'react'
import type { WalletSession } from '@/shared/lib/hyperliquid'
import { usePhonePairing } from '../hooks/use-phone-pairing'
import { pairingCode, pairingQR } from '../lib/phone-pairing'
import { PhoneDevices } from './phone-devices'

export function PhonePairing({
  wallet,
  onBusy,
}: {
  wallet: WalletSession
  onBusy: (busy: boolean) => void
}) {
  const flow = usePhonePairing(wallet, onBusy)
  const [matched, setMatched] = useState(false)
  return (
    <section
      aria-label="授权手机交易"
      className="space-y-3 rounded-lg border border-edge p-3"
    >
      <h3 className="font-medium">手机交易 · 测试网</h3>
      {flow.status !== 'done' && (
        <p className="text-xs leading-5 text-muted">
          使用 App 扫码，授权后可在手机下单和撤单，有效期 7 天。
        </p>
      )}
      {!flow.configured && (
        <p className="text-xs">手机配对服务暂不可用，请稍后重试。</p>
      )}
      {flow.status !== 'done' && (
        <Button
          className="w-full"
          isDisabled={
            !flow.configured || flow.busy || flow.status === 'submitted'
          }
          onPress={() => {
            setMatched(false)
            void flow.create()
          }}
        >
          生成手机授权二维码
        </Button>
      )}
      {flow.pairing && !flow.request && (
        <div className="space-y-2">
          <div className="mx-auto w-fit rounded bg-white p-3">
            <QRCodeSVG
              value={pairingQR(flow.pairing.offer)}
              size={260}
              level="M"
              title="用 Hyperliquid 手机 App 扫描此授权二维码"
            />
          </div>
          <p className="text-xs">
            请用 App「扫描电脑授权二维码」扫描，五分钟内有效，请勿转发。
          </p>
        </div>
      )}
      {flow.status !== 'done' && flow.pairing && flow.request && (
        <div className="space-y-2 text-xs">
          <p className="text-base font-semibold">
            两端核对码：{pairingCode(flow.pairing.offer, flow.request)}
          </p>
          <p className="break-all">账户：{flow.request.account}</p>
          <p>到期：{new Date(flow.request.expiresAt).toLocaleString()}</p>
          <p>代理可使用该账户资金交易，交易可能产生损失；不授予提款权限。</p>
          <details className="text-muted">
            <summary className="cursor-pointer rounded focus-visible:outline-2">
              设备详情
            </summary>
            <p className="mt-2">{flow.request.agentName}</p>
            <p className="break-all">授权地址：{flow.request.agentAddress}</p>
          </details>
          <Checkbox
            isSelected={matched}
            onValueChange={setMatched}
            isDisabled={flow.busy || flow.status !== 'waiting'}
          >
            已在手机确认相同账户和六位码
          </Checkbox>
          <Button
            className="w-full"
            isDisabled={!matched || flow.busy || flow.status !== 'waiting'}
            onPress={() => void flow.approve()}
          >
            在主钱包确认授权
          </Button>
          {flow.status === 'submitted' && (
            <Button
              className="w-full"
              isDisabled={flow.busy}
              onPress={() => void flow.verify()}
            >
              查询授权结果（不重复签名）
            </Button>
          )}
        </div>
      )}
      {flow.status === 'done' && (
        <div className="space-y-3">
          <output className="block text-sm text-accent">
            手机已授权，有效期内无需重复扫码。
          </output>
          {flow.request && (
            <p className="text-xs text-muted">
              到期：{new Date(flow.request.expiresAt).toLocaleString()}
            </p>
          )}
          <Button
            variant="light"
            isDisabled={flow.busy}
            onPress={() => {
              setMatched(false)
              void flow.create()
            }}
          >
            连接其他手机
          </Button>
        </div>
      )}
      {flow.error && (
        <p role="alert" className="text-xs text-loss">
          {flow.error}
        </p>
      )}
      <PhoneDevices
        key={flow.status === 'done' ? flow.request?.agentAddress : 'devices'}
        wallet={wallet}
      />
    </section>
  )
}
