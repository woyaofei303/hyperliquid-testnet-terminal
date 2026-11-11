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
      <h3 className="font-medium">授权手机交易 · 仅测试网</h3>
      <p className="text-xs leading-5 text-muted">
        手机扫码后生成自己的代理密钥。确认一次后可下单和撤单，有效期 7
        天。资产仍在当前账户，主钱包私钥不会传给手机。
      </p>
      {!flow.configured && (
        <p className="text-xs">手机配对服务暂不可用，请稍后重试。</p>
      )}
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
            五分钟内有效。请用本项目手机 App 扫码，二维码不要转发。
          </p>
        </div>
      )}
      {flow.pairing && flow.request && (
        <div className="space-y-2 text-xs">
          <p className="text-base font-semibold">
            两端核对码：{pairingCode(flow.pairing.offer, flow.request)}
          </p>
          <p className="break-all">账户：{flow.request.account}</p>
          <p>{flow.request.agentName}</p>
          <p className="break-all">手机代理：{flow.request.agentAddress}</p>
          <p>到期：{new Date(flow.request.expiresAt).toLocaleString()}</p>
          <p>代理可使用该账户资金交易，交易可能产生损失；不授予提款权限。</p>
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
          {flow.status === 'done' && (
            <output className="block text-accent">
              交易所授权已核验，请在手机完成身份验证。此页面现在可以关闭。
            </output>
          )}
        </div>
      )}
      {flow.error && (
        <p role="alert" className="text-xs text-loss">
          {flow.error}
        </p>
      )}
      <PhoneDevices wallet={wallet} />
    </section>
  )
}
