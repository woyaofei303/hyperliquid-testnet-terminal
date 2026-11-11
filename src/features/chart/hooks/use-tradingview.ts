'use client'

import { getVolPaneTargetHeight } from '@fameex/kline'
import { getColorByCssVar } from '@fameex/utils'
import { useEffect, useRef, useState } from 'react'
import type { createChartFeed } from '@/features/chart/lib/chart-feed'
import {
  type ChartInterval,
  chartResolutions,
} from '@/features/chart/lib/chart-periods'
import { useLocale } from '@/i18n'
import type {
  IChartingLibraryWidget,
  ResolutionString,
  Timezone,
} from '../../../../public/lib/charting_library/charting_library'

export function useTradingView({
  source,
  coin,
  interval,
  visible,
  onReady,
}: {
  source: ReturnType<typeof createChartFeed>
  coin: string
  interval: ChartInterval
  visible: boolean
  onReady: (widget: IChartingLibraryWidget) => void
}) {
  const locale = useLocale()
  const container = useRef<HTMLDivElement>(null)
  const widgetRef = useRef<IChartingLibraryWidget | null>(null)
  const desired = useRef({ coin, interval })
  desired.current = { coin, interval }
  const sync = useRef(() => {})
  const resize = useRef(() => {})
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    let observer: ResizeObserver | undefined
    let frame = 0
    let ready = false
    const applyVolumeRatio = () => {
      const widget = widgetRef.current
      if (!active || !ready || !widget || !container.current?.clientHeight)
        return
      const panes = widget.activeChart().getPanes()
      if (panes.length === 2) {
        const total = panes.reduce((sum, p) => sum + p.getHeight(), 0)
        const target = getVolPaneTargetHeight(total)
        if (target && Math.abs(panes[1].getHeight() - target) > 1)
          panes[1].setHeight(target)
      }
    }
    resize.current = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(applyVolumeRatio)
    }
    sync.current = () => {
      const widget = widgetRef.current
      if (!ready || !active || !widget) return
      const { coin, interval } = desired.current
      const chart = widget.activeChart()
      const resolution = chartResolutions[interval] as ResolutionString
      if (chart.symbol() === coin && chart.resolution() === resolution) {
        resize.current()
        return
      }
      widget.setSymbol(coin, resolution, () => {
        resize.current()
      })
    }
    void import('../../../../public/lib/charting_library')
      .then(({ widget }) => {
        if (!active || !container.current) return
        const { coin, interval } = desired.current
        const instance = new widget({
          container: container.current,
          library_path: '/lib/charting_library/',
          datafeed: source.tradingView,
          symbol: coin,
          interval: chartResolutions[interval] as ResolutionString,
          locale: locale === 'en-US' ? 'en' : 'zh',
          timezone: Intl.DateTimeFormat().resolvedOptions()
            .timeZone as Timezone,
          theme: 'dark',
          autosize: true,
          disabled_features: [
            'volume_force_overlay',
            'header_symbol_search',
            'symbol_search_hot_key',
            'header_compare',
            'header_saveload',
            'header_resolutions',
            'timeframes_toolbar',
            'use_localstorage_for_settings',
            'header_widget',
          ],
          enabled_features: ['hide_left_toolbar_by_default'],
          overrides: {
            volumePaneSize: 'medium',
            'paneProperties.backgroundType': 'solid',
            'paneProperties.background': getColorByCssVar('--fx-bg-2'),
            'paneProperties.vertGridProperties.color':
              getColorByCssVar('--fx-bg-3'),
            'paneProperties.horzGridProperties.color':
              getColorByCssVar('--fx-bg-3'),
            'mainSeriesProperties.candleStyle.upColor':
              getColorByCssVar('--fx-sem-g'),
            'mainSeriesProperties.candleStyle.downColor':
              getColorByCssVar('--fx-sem-r'),
            'mainSeriesProperties.candleStyle.wickUpColor':
              getColorByCssVar('--fx-sem-g'),
            'mainSeriesProperties.candleStyle.wickDownColor':
              getColorByCssVar('--fx-sem-r'),
            'mainSeriesProperties.candleStyle.borderUpColor':
              getColorByCssVar('--fx-sem-g'),
            'mainSeriesProperties.candleStyle.borderDownColor':
              getColorByCssVar('--fx-sem-r'),
          },
          studies_overrides: {
            'volume.volume.color.0': getColorByCssVar('--fx-volume-down', 0.6),
            'volume.volume.color.1': getColorByCssVar('--fx-volume-up', 0.6),
            'volume.volume.transparency': 0,
          },
        })
        widgetRef.current = instance
        instance.onChartReady(() => {
          if (!active) return
          ready = true
          onReady(instance)
          sync.current()
          resize.current()
          instance
            .activeChart()
            .onDataLoaded()
            .subscribe(null, () => resize.current())
          observer = new ResizeObserver(() => resize.current())
          if (container.current) observer.observe(container.current)
        })
      })
      .catch((e) => {
        if (active) setError(String(e))
      })
    return () => {
      active = false
      ready = false
      observer?.disconnect()
      cancelAnimationFrame(frame)
      widgetRef.current?.remove()
      widgetRef.current = null
    }
  }, [source, onReady, locale])
  useEffect(() => {
    desired.current = { coin, interval }
    sync.current()
  }, [coin, interval])
  useEffect(() => {
    if (visible) resize.current()
  }, [visible])
  return { container, error }
}
