import { Button, Checkbox, Input, Modal } from '@fameex/ui'
import { useState } from 'react'
import type { ProtectionKind } from '@/features/chart/lib/chart-trading'
import { baseName, quoteName } from '@/features/market/lib/market-catalog'
import type { TerminalModel } from '@/features/terminal/hooks/use-terminal'
import { Money } from '@/features/trading/lib/orders'
import { t, useLocale } from '@/i18n'
import type { OpenOrder } from '@/shared/lib/fameex-testnet'
import { HelpLabel } from '../../../shared/components/help-label'
import { OrderAmount } from './order-amount'
import { type Position, PositionSummary } from './position-close'
import { ProtectionFields } from './protection-fields'

export function PositionProtection({
  position,
  model,
  onClose,
  initial,
}: {
  initial?: { kind: ProtectionKind; value: string; order?: OpenOrder }
  position: Position
  model: TerminalModel
  onClose: () => void
}) {
  useLocale()
  const [expected] = useState(position)
  const [protectionValid, setProtectionValid] = useState(true)
  const [tp, setTp] = useState(initial?.kind === 'tp' ? initial.value : ''),
    [sl, setSl] = useState(initial?.kind === 'sl' ? initial.value : '')
  const [tpLimit, setTpLimit] = useState(
      initial?.kind === 'tp' ? (initial.order?.limitPx ?? '') : '',
    ),
    [slLimit, setSlLimit] = useState(
      initial?.kind === 'sl' ? (initial.order?.limitPx ?? '') : '',
    )
  const [custom, setCustom] = useState(
      !!initial?.order && Number(initial.order.origSz) !== 0,
    ),
    [limit, setLimit] = useState(!!initial?.order?.orderType.includes('Limit'))
  const [unit, setUnit] = useState<'base' | 'usdc'>('base')
  const [amount, setAmount] = useState(
    initial?.order && Number(initial.order.origSz) !== 0
      ? initial.order.sz
      : new Money(position.szi).abs().toFixed(),
  )
  const [pending, setPending] = useState(false)
  const market = model.markets.find((m) => m.name === position.coin)
  if (!market) return null
  const mark = new Money(position.positionValue).div(
    new Money(position.szi).abs(),
  )
  let size = ''
  try {
    size = custom
      ? (unit === 'base'
          ? new Money(amount)
          : new Money(amount)
              .div(mark)
              .toDecimalPlaces(market.szDecimals, Money.ROUND_DOWN)
        ).toFixed()
      : new Money(position.szi).abs().toFixed()
  } catch {
    /* 等待输入完整。 */
  }
  const signedSize = Number(position.szi) < 0 ? `-${size}` : size
  const changed = position.szi !== expected.szi
  const valid =
    !changed &&
    protectionValid &&
    (tp || sl) &&
    Number(size) > 0 &&
    Number(size) <= Math.abs(Number(position.szi)) &&
    (!limit || ((!tp || Number(tpLimit) > 0) && (!sl || Number(slLimit) > 0)))
  async function submit() {
    setPending(true)
    try {
      if (
        await model.submitProtection(
          expected,
          tp,
          sl,
          {
            ...(custom ? { size } : {}),
            ...(limit
              ? { takeProfitLimit: tpLimit, stopLossLimit: slLimit }
              : {}),
          },
          initial?.order,
        )
      )
        onClose()
    } finally {
      setPending(false)
    }
  }
  return (
    <Modal
      closeLabel={t('关闭')}
      title={t(initial?.order ? '修改止盈 / 止损' : '仓位的止盈/止损')}
      onClose={onClose}
      busy={pending}
      className="max-w-[520px] [&_header]:text-center"
      footer={
        <Button
          className="w-full"
          isDisabled={!valid || pending || model.busy}
          onPress={() => void submit()}
        >
          {t('确认')}
        </Button>
      }
    >
      <PositionSummary position={position} />
      <ProtectionFields
        only={initial?.kind}
        onValidityChange={setProtectionValid}
        market={market}
        entry={position.entryPx}
        size={signedSize}
        leverage={position.leverage.value}
        takeProfit={tp}
        stopLoss={sl}
        onTakeProfit={setTp}
        onStopLoss={setSl}
      />
      {!initial?.order && (
        <div className="flex gap-6">
          <Checkbox isSelected={custom} onValueChange={setCustom}>
            <HelpLabel label="配置金额" />
          </Checkbox>
          <Checkbox isSelected={limit} onValueChange={setLimit}>
            <HelpLabel label="限价保护" />
          </Checkbox>
        </div>
      )}
      {custom && !initial?.order && (
        <OrderAmount
          base={baseName(market)}
          quote={quoteName(market)}
          precision={market.szDecimals}
          unit={unit}
          amount={amount}
          percent={Math.min(
            100,
            Math.max(
              0,
              (Number(size) / Math.abs(Number(position.szi))) * 100 || 0,
            ),
          )}
          disabled={pending}
          onAmount={setAmount}
          onUnit={(value) => {
            setUnit(value)
            setAmount('')
          }}
          onPercent={(value) =>
            setAmount(
              new Money(position.szi)
                .abs()
                .times(value)
                .div(100)
                .times(unit === 'usdc' ? mark : 1)
                .toDecimalPlaces(
                  unit === 'base' ? market.szDecimals : 2,
                  Money.ROUND_DOWN,
                )
                .toFixed(),
            )
          }
        />
      )}
      {limit && (
        <div className="grid grid-cols-2 gap-2">
          {initial?.kind !== 'sl' && (
            <Input
              label={t('止盈限价')}
              value={tpLimit}
              onChange={setTpLimit}
              inputMode="decimal"
            />
          )}
          {initial?.kind !== 'tp' && (
            <Input
              label={t('止损限价')}
              value={slLimit}
              onChange={setSlLimit}
              inputMode="decimal"
            />
          )}
        </div>
      )}
      <p className="text-xs leading-5 text-muted">
        {t(
          custom
            ? '仅保护指定数量，不会随新增仓位扩大。'
            : '默认保护触发时的全部仓位，仓位全部平仓后自动取消。',
        )}
      </p>
      <p className="text-xs leading-5 text-muted">
        {t(
          limit
            ? '触发后提交限价单，不能保证成交。'
            : '按标记价触发只减仓市价单，价格保护为 10%，不保证全部成交。',
        )}
      </p>
      {changed && (
        <p role="alert" className="text-xs text-loss">
          {t('仓位数量或方向已变化，请关闭后重新确认。')}
        </p>
      )}
    </Modal>
  )
}
