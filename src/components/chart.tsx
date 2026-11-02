'use client'

import { BaseKlineChart } from '@fameex/kline'
import { memo, useEffect, useMemo, useState } from 'react'
import { useChartControls } from '@/hooks/use-chart-controls'
import { useChartFeed } from '@/hooks/use-chart-feed'
import { useTradingView } from '@/hooks/use-tradingview'
import { t, useLocale } from '@/i18n'
import type { createChartFeed } from '@/lib/chart-feed'
import { type ChartInterval, chartPeriods } from '@/lib/chart-periods'
import type { Candle } from '@/lib/market-data'
import type { IChartingLibraryWidget } from '../../public/lib/charting_library/charting_library'
import { type ChartEngine, ChartToolbar } from './trading/chart-toolbar'

const klineOptions = { timezone: 'Etc/UTC' }
type Props = {
  coin: string
  label?: string
  priceDecimals?: number
  interval: ChartInterval
  onIntervalChange: (value: ChartInterval) => void
  szDecimals: number
  candles: Candle[]
}
function TradingView(props: {
  source: ReturnType<typeof createChartFeed>
  coin: string
  interval: ChartInterval
  visible: boolean
  onReady: (widget: IChartingLibraryWidget) => void
}) {
  useLocale()

  const { container, error } = useTradingView(props)
  return (
    <>
      <div ref={container} className="absolute inset-0" />
      {error && (
        <p
          role="alert"
          className="absolute inset-x-0 top-0 bg-panel p-3 text-xs text-loss"
        >
          {t('图表加载失败：')}
          {t(error)}
        </p>
      )}
    </>
  )
}
export const Chart = memo(function Chart(props: Props) {
  const locale = useLocale()

  const [engine, setEngine] = useState<ChartEngine>('kline')
  const controls = useChartControls(engine, props.onIntervalChange)
  const [tvMounted, setTvMounted] = useState(false)
  const { source, count, error, loaded } = useChartFeed(props)
  useEffect(() => source.setVisibleEngine(engine), [source, engine])
  const symbol = useMemo(
    () => ({
      ticker: props.coin,
      pricePrecision: props.priceDecimals ?? Math.max(0, 6 - props.szDecimals),
      volumePrecision: props.szDecimals,
    }),
    [props.coin, props.szDecimals, props.priceDecimals],
  )
  return (
    <div
      ref={controls.container}
      className="flex min-h-0 flex-1 flex-col bg-panel fullscreen:h-dvh fullscreen:w-dvw"
    >
      <ChartToolbar
        interval={props.interval}
        controls={controls}
        engine={engine}
        onEngineChange={(value) => {
          if (value === 'tradingview') setTvMounted(true)
          setEngine(value)
        }}
      />
      <div className="relative min-h-[400px] flex-1 md:min-h-[460px] lg:min-h-0">
        <section
          hidden={engine !== 'kline'}
          className="absolute inset-0"
          aria-label={
            t('基础版 K 线图，已加载 ') + count + t(' 根蜡烛，时间使用 UTC')
          }
        >
          <BaseKlineChart
            onChartReady={controls.onKlineReady}
            visible={engine === 'kline'}
            dataLoader={source.kline}
            symbolInfo={symbol}
            period={chartPeriods[props.interval]}
            klinePriceType="trade"
            locale={locale}
            theme="dark"
            options={klineOptions}
            className="absolute inset-0 flex"
          />
        </section>
        {tvMounted && (
          <section
            hidden={engine !== 'tradingview'}
            className="absolute inset-0"
            aria-label={
              t('TradingView K 线图，已加载 ') +
              count +
              t(' 根蜡烛，时间使用 UTC')
            }
          >
            <TradingView
              source={source}
              onReady={controls.setTradingView}
              coin={props.coin}
              interval={props.interval}
              visible={engine === 'tradingview'}
            />
          </section>
        )}
        {loaded && !count && !error && (
          <p className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-muted">
            {t('此市场暂无历史成交')}
          </p>
        )}
        {error && (
          <p
            role="alert"
            className="absolute inset-x-2 bottom-2 z-40 bg-panel p-2 text-xs text-loss"
          >
            {t('行情加载失败：')}
            {t(error)}
          </p>
        )}
      </div>
      {controls.error && (
        <p role="alert" className="p-2 text-xs text-loss">
          {controls.error}
        </p>
      )}
    </div>
  )
})
