import { Button, Input, Modal, Tab, Tabs } from '@fameex/ui'
import { useState } from 'react'
import type { TerminalModel } from '@/hooks/use-terminal'
import { t, useLocale } from '@/i18n'
import type { AccountState } from '@/lib/hyperliquid'
import { Money } from '@/lib/orders'

export function PositionClose({
  position,
  model,
  onClose,
}: {
  position: AccountState['assetPositions'][number]['position']
  model: TerminalModel
  onClose: () => void
}) {
  useLocale()
  const [kind, setKind] = useState<'market' | 'limit'>('market')
  const [size, setSize] = useState(new Money(position.szi).abs().toFixed())
  const [price, setPrice] = useState(
    new Money(position.positionValue)
      .div(new Money(position.szi).abs())
      .toFixed(),
  )
  const [pending, setPending] = useState(false)
  const precision =
    model.markets.find((m) => m.name === position.coin)?.szDecimals ?? 5
  const valid =
    Number(size) > 0 &&
    Number(size) <= Math.abs(Number(position.szi)) &&
    (kind === 'market' || Number(price) > 0)
  async function preview() {
    setPending(true)
    try {
      if (await model.previewClose(position, { size, price, kind })) onClose()
    } finally {
      setPending(false)
    }
  }
  return (
    <Modal
      closeLabel={t('关闭')}
      title={`${t('平仓')} ${position.coin}`}
      onClose={onClose}
      busy={pending}
      footer={
        <Button
          className="w-full"
          isDisabled={!valid || pending || model.busy}
          onPress={() => void preview()}
        >
          {t('预览平仓')}
        </Button>
      }
    >
      <Tabs
        aria-label={t('平仓')}
        selectedKey={kind}
        onSelectionChange={(key) => setKind(key as 'market' | 'limit')}
      >
        <Tab key="market" title={t('市价')} />
        <Tab key="limit" title={t('限价')} />
      </Tabs>
      <div className="flex justify-between text-sm">
        <span className="text-muted">{t('当前仓位')}</span>
        <span>
          {new Money(position.szi).abs().toFixed()} {position.coin} ·{' '}
          {t(Number(position.szi) > 0 ? '多头' : '空头')}
        </span>
      </div>
      {kind === 'limit' && (
        <Input
          label={t('平仓价格')}
          value={price}
          onChange={setPrice}
          inputMode="decimal"
        />
      )}
      <Input
        label={`${position.coin} ${t('减仓数量')}`}
        value={size}
        onChange={setSize}
        inputMode="decimal"
      />
      <div className="grid grid-cols-4 gap-2">
        {[25, 50, 75, 100].map((percent) => (
          <Button
            key={percent}
            size="sm"
            variant="bordered"
            color="default"
            onPress={() =>
              setSize(
                new Money(position.szi)
                  .abs()
                  .times(percent)
                  .div(100)
                  .toDecimalPlaces(precision, Money.ROUND_DOWN)
                  .toFixed(),
              )
            }
          >
            {percent}%
          </Button>
        ))}
      </div>
      <p className="text-xs text-muted">
        {t('只减仓已启用，不允许反向开仓。')}
      </p>
    </Modal>
  )
}
