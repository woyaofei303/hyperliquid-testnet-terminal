'use client'
import { getVolumeStyles, syncVolIndicatorPaneHeight } from '@fameex/kline'
import { Button, Checkbox, Input, Modal } from '@fameex/ui'
import type { Chart } from 'klinecharts'
import { useState } from 'react'
import { t, useLocale } from '@/i18n'

// FameEX FuturesKline/chart/indicators/constants.ts，同一组 KLineCharts 内置指标。
const main = ['MA', 'EMA', 'SMA', 'BBI', 'BOLL', 'DMA', 'SAR', 'AVP']
const sub = [
  'AO',
  'BIAS',
  'BRAR',
  'CCI',
  'CR',
  'DMI',
  'EMV',
  'MTM',
  'MACD',
  'OBV',
  'PVT',
  'PSY',
  'ROC',
  'RSI',
  'KDJ',
  'TRIX',
  'VOL',
  'VR',
  'WR',
]
export function ChartIndicators({
  chart,
  onClose,
}: {
  chart: Chart
  onClose: () => void
}) {
  useLocale()
  const [tab, setTab] = useState<'main' | 'sub'>('main')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState(() =>
    chart.getIndicators().map((i) => i.name),
  )
  function toggle(name: string, enabled: boolean) {
    if (!enabled) chart.removeIndicator({ name })
    else
      chart.createIndicator(
        {
          name,
          ...(main.includes(name) ? { paneId: 'candle_pane' } : {}),
          ...(name === 'VOL'
            ? {
                paneId: 'volume_pane',
                calcParams: [],
                styles: getVolumeStyles(),
              }
            : {}),
        },
        true,
      )
    syncVolIndicatorPaneHeight(chart)
    setSelected(chart.getIndicators().map((i) => i.name))
  }
  return (
    <Modal
      title={t('指标')}
      closeLabel={t('关闭')}
      onClose={onClose}
      footer={
        <Button
          variant="flat"
          onPress={() => {
            for (const { name } of chart.getIndicators())
              chart.removeIndicator({ name })
            toggle('MA', true)
            toggle('VOL', true)
          }}
        >
          {t('恢复默认指标')}
        </Button>
      }
    >
      <Input
        aria-label={t('搜索指标')}
        placeholder={t('搜索指标')}
        value={search}
        onChange={setSearch}
      />
      <div
        className="flex gap-5 border-b border-edge"
        role="tablist"
        aria-label={t('指标分类')}
      >
        {(['main', 'sub'] as const).map((value) => (
          <button
            type="button"
            role="tab"
            key={value}
            aria-selected={tab === value}
            className="border-b-2 border-transparent pb-2 text-sm aria-selected:border-accent aria-selected:text-accent"
            onClick={() => setTab(value)}
          >
            {t(value === 'main' ? '主图指标' : '副图指标')}
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        aria-label={t(tab === 'main' ? '主图指标' : '副图指标')}
        className="grid max-h-72 grid-cols-2 gap-4 overflow-auto py-1"
      >
        {(search ? [...main, ...sub] : tab === 'main' ? main : sub)
          .filter((name) => name.includes(search.trim().toUpperCase()))
          .map((name) => (
            <Checkbox
              key={name}
              isSelected={selected.includes(name)}
              onValueChange={(enabled) => toggle(name, enabled)}
            >
              {name === 'MA'
                ? t('均线 MA')
                : name === 'VOL'
                  ? t('成交量 VOL')
                  : name}
            </Checkbox>
          ))}
        {search &&
          ![...main, ...sub].some((name) =>
            name.includes(search.trim().toUpperCase()),
          ) && <p className="text-xs text-muted">{t('没有匹配的指标')}</p>}
      </div>
    </Modal>
  )
}
