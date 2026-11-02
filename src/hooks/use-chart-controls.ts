'use client'
import { getVolumeStyles, type UseBaseKlineChartResult } from '@fameex/kline'
import type { CandleType, Chart } from 'klinecharts'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChartEngine } from '@/components/trading/chart-toolbar'
import type { ChartInterval } from '@/lib/chart-periods'
import type { IChartingLibraryWidget } from '../../public/lib/charting_library/charting_library'

export type ChartShape = 'candle_solid' | 'candle_stroke' | 'ohlc' | 'area'
export function useChartControls(
  engine: ChartEngine,
  onIntervalChange: (value: ChartInterval) => void,
) {
  const container = useRef<HTMLDivElement>(null)
  const [kline, setKline] = useState<Chart | null>(null)
  const [tradingView, setTradingView] = useState<IChartingLibraryWidget | null>(
    null,
  )
  const [shape, setShape] = useState<ChartShape>('candle_solid')
  const [timeline, setTimeline] = useState(false)
  const [ma, setMa] = useState(true)
  const [volume, setVolume] = useState(true)
  const [fullscreen, setFullscreen] = useState(false)
  const [error, setError] = useState('')
  const onKlineReady = useCallback(
    (result: UseBaseKlineChartResult) => setKline(result.chartRef.current),
    [],
  )
  useEffect(() => {
    kline?.setStyles({ candle: { type: shape as CandleType } })
    const chart = tradingView?.activeChart()
    const type = (
      { candle_solid: 1, candle_stroke: 9, ohlc: 0, area: 3 } as const
    )[shape]
    if (chart && chart.chartType() !== type) chart.setChartType(type)
  }, [kline, tradingView, shape])
  useEffect(() => {
    if (!kline) return
    for (const [name, enabled, paneId] of [
      ['MA', ma, 'candle_pane'],
      ['VOL', volume, 'volume_pane'],
    ] as const) {
      const exists = kline.getIndicators({ name }).length > 0
      if (!enabled && exists) kline.removeIndicator({ name })
      if (enabled && !exists)
        kline.createIndicator(
          {
            name,
            paneId,
            ...(name === 'VOL'
              ? { calcParams: [], styles: getVolumeStyles() }
              : {}),
          },
          true,
        )
    }
  }, [kline, ma, volume])
  useEffect(() => {
    const changed = () =>
      setFullscreen(document.fullscreenElement === container.current)
    document.addEventListener('fullscreenchange', changed)
    return () => document.removeEventListener('fullscreenchange', changed)
  }, [])
  function selectPeriod(value: ChartInterval | 'time') {
    setTimeline(value === 'time')
    setShape(value === 'time' ? 'area' : 'candle_solid')
    onIntervalChange(value === 'time' ? '1m' : value)
  }
  function reset() {
    if (engine === 'tradingview')
      tradingView?.activeChart().executeActionById('chartReset')
    else if (kline) {
      // FameEX useResetKlineChartView：恢复间距与自动价格范围，不重新请求行情。
      kline.setBarSpace(6)
      for (const { id, paneId, name } of kline.getYAxes({}))
        kline.overrideYAxis({ id, paneId, name })
      kline.scrollToRealTime(200)
    }
  }
  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen()
      else await container.current?.requestFullscreen()
      setError('')
    } catch {
      setError('浏览器未允许全屏，可使用窗口最大化查看图表。')
    }
  }
  return {
    container,
    onKlineReady,
    setTradingView,
    timeline,
    selectPeriod,
    shape,
    selectShape: (value: ChartShape) => {
      setTimeline(false)
      setShape(value)
    },
    ma,
    setMa,
    volume,
    setVolume,
    reset,
    fullscreen,
    toggleFullscreen,
    error,
    ready: engine === 'kline' ? !!kline : !!tradingView,
    openIndicators: () =>
      tradingView?.activeChart().executeActionById('insertIndicator'),
  }
}
