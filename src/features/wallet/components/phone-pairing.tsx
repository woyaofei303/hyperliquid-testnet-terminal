import { Button } from '@fameex/ui'
import { QRCodeSVG } from 'qrcode.react'
import type { WalletSession } from '@/shared/lib/fameex-testnet'
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
  return (
    <section aria-label="授权手机交易" className="space-y-4">
      {!flow.configured && (
        <p className="text-xs">手机配对服务暂不可用，请稍后重试。</p>
      )}
      {flow.pairing && flow.status !== 'done' && (
        <div className="mx-auto w-fit max-w-full rounded-lg bg-white p-3">
          <QRCodeSVG
            value={pairingQR(flow.pairing.offer)}
            size={260}
            className="h-auto max-w-full"
            level="M"
            title="用 fameex-testnet 手机 App 扫描此授权二维码"
          />
        </div>
      )}
      {flow.status !== 'done' && (
        <>
          {flow.pairing && flow.request ? (
            <div className="space-y-2 text-center">
              <p className="text-lg font-semibold">
                两端核对码：{pairingCode(flow.pairing.offer, flow.request)}
              </p>
              <p className="text-xs leading-5 text-muted">
                确认手机上账户与六位码一致后再授权。7
                天有效，可动用账户资金交易，不含提款权限。
              </p>
            </div>
          ) : (
            <p className="text-center text-xs leading-5 text-muted">
              {flow.pairing
                ? '请用 App 扫码，二维码五分钟有效。'
                : '名额满时，会先请求撤销最早的手机授权。'}
            </p>
          )}
          {flow.status === 'submitted' ? (
            <Button
              className="w-full"
              isDisabled={flow.busy}
              onPress={() => void flow.verify()}
            >
              查询授权结果（不重复签名）
            </Button>
          ) : flow.request ? (
            <Button
              className="w-full"
              isDisabled={flow.busy}
              onPress={() => void flow.approve()}
            >
              在主钱包确认授权
            </Button>
          ) : !flow.pairing || flow.error ? (
            <Button
              className="w-full"
              isDisabled={!flow.configured || flow.busy}
              onPress={() => void flow.create()}
            >
              生成手机授权二维码
            </Button>
          ) : (
            <Button className="w-full" isDisabled>
              等待 App 扫码
            </Button>
          )}
        </>
      )}
      {flow.status === 'done' && (
        <div className="space-y-3 text-center">
          <output className="block text-sm text-accent">
            手机已授权，有效期内无需重复扫码。
          </output>
          <Button
            variant="light"
            isDisabled={flow.busy}
            onPress={() => void flow.create()}
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
      {flow.notice && (
        <output className="block text-xs text-muted">{flow.notice}</output>
      )}
      {flow.error && flow.request && flow.status === 'waiting' && (
        <Button
          variant="light"
          isDisabled={flow.busy}
          onPress={() => void flow.create()}
        >
          生成手机授权二维码
        </Button>
      )}
      <PhoneDevices
        key={`${flow.devicesVersion}-${flow.status === 'done' ? flow.request?.agentAddress : 'devices'}`}
        wallet={wallet}
        disabled={flow.busy || flow.status === 'submitted'}
        onRevoke={flow.revoke}
      />
    </section>
  )
}
