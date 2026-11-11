'use client'
import {
  getVolPaneTargetHeight,
  getVolumeStyles,
  syncVolIndicatorPaneHeight,
  type UseBaseKlineChartResult,
} from '@fameex/kline'
import type { CandleType, Chart } from 'klinecharts'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChartEngine } from '@/features/chart/components/chart-toolbar'
import { drawingStorageKey } from '@/features/chart/lib/chart-drawings'
import type { ChartInterval } from '@/features/chart/lib/chart-periods'
import type { IChartingLibraryWidget } from '../../../../public/lib/charting_library/charting_library'

export type ChartShape = 'candle_solid' | 'candle_stroke' | 'ohlc' | 'area'
export function useChartControls(
  engine: ChartEngine,
  onIntervalChange: (value: ChartInterval) => void,
  coin: string,
) {
  const container = useRef<HTMLDivElement>(null)
  const [kline, setKline] = useState<Chart | null>(null)
  const [tradingView, setTradingView] = useState<IChartingLibraryWidget | null>(
    null,
  )
  const [shape, setShape] = useState<ChartShape>('candle_solid')
  const [timeline, setTimeline] = useState(false)
  const [drawing, setDrawing] = useState(true)
  const [drawingReset, setDrawingReset] = useState(0)
  const [indicatorsOpen, setIndicatorsOpen] = useState(false)
  const [tradeLines, setTradeLines] = useState({
    position: true,
    order: true,
    tpslOrder: true,
  })
  const [fullscreen, setFullscreen] = useState(false)
  const [error, setError] = useState('')
  const [resetting, setResetting] = useState(false)
  const onKlineReady = useCallback((result: UseBaseKlineChartResult) => {
    result.chartRef.current?.setTimezone(
      Intl.DateTimeFormat().resolvedOptions().timeZone,
    )
    setKline(result.chartRef.current)
  }, [])
  useEffect(() => {
    kline?.setStyles({ candle: { type: shape as CandleType } })
    const chart = tradingView?.activeChart()
    const type = (
      { candle_solid: 1, candle_stroke: 9, ohlc: 0, area: 3 } as const
    )[shape]
    if (chart && chart.chartType() !== type) chart.setChartType(type)
  }, [kline, tradingView, shape])
  useEffect(() => {
    const changed = () =>
      setFullscreen(document.fullscreenElement === document.documentElement)
    document.addEventListener('fullscreenchange', changed)
    return () => {
      document.removeEventListener('fullscreenchange', changed)
      if (document.fullscreenElement === document.documentElement)
        void document.exitFullscreen().catch(() => undefined)
    }
  }, [])
  useEffect(() => {
    if (!fullscreen) return
    const siblings: [HTMLElement, boolean][] = []
    // 全屏保留 body 弹层，只禁用图表所在应用分支之外的背景控件。
    for (
      let branch: HTMLElement | null = container.current;
      branch?.parentElement && branch.parentElement !== document.body;
      branch = branch.parentElement
    ) {
      for (const sibling of branch.parentElement.children) {
        if (sibling instanceof HTMLElement && sibling !== branch) {
          siblings.push([sibling, sibling.inert])
          sibling.inert = true
        }
      }
    }
    return () => {
      for (const [sibling, inert] of siblings) sibling.inert = inert
    }
  }, [fullscreen])
  function selectPeriod(value: ChartInterval | 'time') {
    setTimeline(value === 'time')
    setShape(value === 'time' ? 'area' : 'candle_solid')
    onIntervalChange(value === 'time' ? '1m' : value)
  }
  async function reset() {
    if (resetting) return
    setError('')
    setIndicatorsOpen(false)
    if (engine === 'tradingview') {
      const chart = tradingView?.activeChart()
      if (!chart) return
      setResetting(true)
      try {
        chart.removeAllShapes()
        chart.removeAllStudies()
        await chart.createStudy('Volume', false, false)
        const panes = chart.getPanes()
        const height = getVolPaneTargetHeight(
          panes.reduce((sum, pane) => sum + pane.getHeight(), 0),
        )
        if (height && panes.length === 2) panes[1].setHeight(height)
        chart.executeActionById('chartReset')
      } catch (error) {
        setError(String(error))
      } finally {
        setResetting(false)
      }
    } else if (kline) {
      kline.removeOverlay({ groupId: 'drawing_tools' })
      for (const { id } of kline.getIndicators()) kline.removeIndicator({ id })
      kline.createIndicator({ name: 'MA', paneId: 'candle_pane' }, true)
      kline.createIndicator({
        name: 'VOL',
        paneId: 'volume_pane',
        calcParams: [],
        styles: getVolumeStyles(),
      })
      kline.setPaneOptions({ id: 'volume_pane', order: 10 })
      syncVolIndicatorPaneHeight(kline)
      try {
        localStorage.removeItem(drawingStorageKey(coin))
      } catch {
        setError('无法清除本地绘图，请检查浏览器存储权限')
      }
      setDrawingReset((value) => value + 1)
      kline.setBarSpace(6)
      kline.setOffsetRightDistance(60)
      for (const { id, paneId, name } of kline.getYAxes({}))
        kline.overrideYAxis({ id, paneId, name })
      kline.scrollToRealTime(200)
    }
  }
  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen()
      // body 中的菜单、弹窗和提示必须与图表处于同一个浏览器全屏层。
      else await document.documentElement.requestFullscreen()
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
    kline,
    tradingView,
    drawing,
    setDrawing,
    drawingReset,
    indicatorsOpen,
    setIndicatorsOpen,
    tradeLines,
    setTradeLines,
    reset,
    fullscreen,
    toggleFullscreen,
    error,
    ready: !resetting && (engine === 'kline' ? !!kline : !!tradingView),
    openIndicators: () =>
      tradingView?.activeChart().executeActionById('insertIndicator'),
  }
}
