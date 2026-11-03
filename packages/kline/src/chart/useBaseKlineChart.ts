import type {
  CandleTooltipLegendsCustomCallback,
  Chart,
  DataLoader,
  Options,
  Overlay,
  OverlayCreate,
  OverlayFilter,
  Period,
  SymbolInfo,
} from 'klinecharts'
import type React from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getChartEngine, loadChartEngine } from '../shared/engine'
import { KLINE_MAIN_PANE_ID } from './constants'
import { formatBaseKlineDate } from './dateFormatter'
import {
  buildCandleLegendTemplate,
  buildTooltipCollapseFeature,
  createChartStyles,
  MAIN_PANE_INDICATOR_TOOLTIP_OFFSET_TOP,
} from './presentation'
import { useChartLoading } from './useChartLoading'

export {
  buildCandleLegendTemplate,
  CANDLE_TOOLTIP_COLLAPSE_PADDING_LEFT,
  MAIN_PANE_INDICATOR_TOOLTIP_OFFSET_TOP,
} from './presentation'

import {
  type UseChartOverlayReturn,
  useChartOverlay,
} from '../shared/useKlineChartOverlay'
import { useKlineChartStore } from './useKlineChartStore'
import {
  getVolumeStyles,
  syncVolIndicatorPaneHeight,
  VOL_INDICATOR_NAME,
  VOL_PANE_MIN_HEIGHT,
} from './volPane'

function isVisibleSize(el: HTMLElement) {
  return el.clientWidth > 0 && el.clientHeight > 0
}

const SCROLL_TO_REALTIME_ANIMATION_MS = 360

export type CandleDensityOptions = {
  /** 固定每根K线的 spacing */
  barSpace?: number
  /** 右侧留白 */
  offsetRightDistance?: number
}

export type UseBaseKlineChartParams = {
  /** 首次可见时创建实例；之后隐藏只暂停可见区域检查，不销毁图表或退订行情。 */
  visible: boolean
  /** 业务层提供历史与实时行情；这里只代理 init 请求的加载状态。 */
  dataLoader: DataLoader
  symbolInfo: SymbolInfo | null
  period: Period | null
  klinePriceType: string
  locale: 'zh-CN' | 'en-US'
  /** 主题变化后重新读取 CSS 变量并更新样式。 */
  theme?: string
  options?: Options
  initialOverlays?: Array<string | OverlayCreate>
  /** 控制默认蜡烛密度 */
  candleDensity?: CandleDensityOptions
}

export type UseBaseKlineChartResult = {
  wrapperRef: React.RefObject<HTMLDivElement | null>
  containerRef: React.RefObject<HTMLDivElement | null>
  chartRef: React.RefObject<Chart | null>
  chartInstance: Chart | null
  /** 实例已创建并安装 dataLoader，不表示首批行情已返回。 */
  isReady: boolean
  isDataLoading: boolean
  /** 是否在实时区域 */
  isAtRealTime: boolean
  initChart: () => Chart | null
  overlayApi: UseChartOverlayReturn
  resize: () => void
  /** 回到实时位置，支持传入动画时长（毫秒） */
  scrollToRealTime: (animationDuration?: number) => void
  setSymbol: (symbol: SymbolInfo) => void
  setPeriod: (period: Period) => void
  resetData: () => void
  createOverlay: (
    value: string | OverlayCreate | Array<string | OverlayCreate>,
  ) => string | string[] | null
  getOverlays: (filter?: OverlayFilter) => Overlay[]
  removeOverlay: (filter?: OverlayFilter) => boolean
  overrideOverlayGroup: (
    groupId: string,
    override: Parameters<Chart['overrideOverlay']>[0],
  ) => boolean
  toggleGroupVisibility: (groupId: string, visible?: boolean) => boolean
  removeOverlayGroup: (groupId: string) => boolean
}

/** 负责实例、外观和覆盖物入口；行情请求与交易动作由调用方提供。 */
export function useBaseKlineChart({
  visible,
  dataLoader,
  symbolInfo,
  period,
  klinePriceType,
  locale,
  theme,
  options,
  initialOverlays = [],
  candleDensity,
}: UseBaseKlineChartParams): UseBaseKlineChartResult {
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const chartRef = useRef<Chart | null>(null)
  const initRequestRef = useRef(0)
  const { isDataLoading, proxiedDataLoader, resetLoading } =
    useChartLoading(dataLoader)
  const didInitOverlaysRef = useRef(false)
  const resizeObserverRef = useRef<ResizeObserver | null>(null)

  /** 避免 candleDensity 变化导致 initChart 引用变化 */
  const candleDensityRef = useRef<CandleDensityOptions | undefined>(
    candleDensity,
  )

  /** 是否在实时区域 */
  const [isAtRealTime, setIsAtRealTime] = useState(true)
  /** tooltip 折叠状态（ref 避免 handler 内 stale closure） */
  const isTooltipCollapsedRef = useRef(false)

  const {
    isReady,
    setChartInstance,
    setReady,
    setSymbol: setSymbolState,
    setPeriod: setPeriodState,
    addOverlayId,
  } = useKlineChartStore()

  const prevDensityValuesRef = useRef<{
    barSpace?: number
    offsetRightDistance?: number
  }>({})

  /** 同步最新 density 配置 */
  useEffect(() => {
    candleDensityRef.current = candleDensity
  }, [candleDensity])

  /** Legend template reads CSS vars at call time so colors stay current after theme switch */
  const legendTemplate = useCallback<CandleTooltipLegendsCustomCallback>(
    (data, styles) => {
      const chart = chartRef.current
      return buildCandleLegendTemplate(data, styles, {
        pricePrecision: chart?.getSymbol()?.pricePrecision,
        formatNumber: chart?.getThousandsSeparator().format,
        defaultValue: styles.tooltip.legend.defaultValue,
        locale: chart?.getLocale() ?? locale,
      })
    },
    [locale],
  )

  const formatter = useMemo<NonNullable<Options['formatter']>>(() => {
    return {
      ...options?.formatter,
      formatDate(params) {
        const shouldUseSecondCrosshairDate =
          params.type === 'crosshair' &&
          period?.type === 'second' &&
          period.span === 1

        if (shouldUseSecondCrosshairDate) {
          return formatBaseKlineDate(params, period)
        }

        return (
          options?.formatter?.formatDate?.(params) ??
          formatBaseKlineDate(params, period)
        )
      },
    }
  }, [options?.formatter, period])

  const initOptions: Options = useMemo(() => {
    const baseStyles = createChartStyles(theme, legendTemplate)

    const mergedStyles =
      options?.styles && typeof options.styles !== 'string'
        ? { ...baseStyles, ...options.styles }
        : baseStyles

    return {
      locale,
      styles: mergedStyles,
      ...options,
      formatter,
    }
    // locale updates are handled by chart.setLocale below to avoid full chart re-init
    // eslint-disable-next-line react-hooks-exhaustive-deps
  }, [options, legendTemplate, formatter, theme])

  const applyVolStyle = useCallback((chart: Chart) => {
    chart.overrideIndicator({
      name: VOL_INDICATOR_NAME,
      styles: getVolumeStyles(),
    })
  }, [])

  const ensureVolPaneHeight = useCallback(() => {
    const chart = chartRef.current
    const host = containerRef.current
    if (!chart || !host) return
    if (!isVisibleSize(host)) return

    syncVolIndicatorPaneHeight(chart)
  }, [])

  const applyCandleDensity = useCallback(() => {
    const chart = chartRef.current
    const host = containerRef.current
    if (!chart || !host) return
    if (!isVisibleSize(host)) return

    const width = host.clientWidth
    if (!width) return

    const density = candleDensityRef.current ?? {}

    const nextBarSpace =
      typeof density.barSpace === 'number' &&
      Number.isFinite(density.barSpace) &&
      density.barSpace > 0
        ? density.barSpace
        : 6

    const nextOffsetRightDistance =
      typeof density.offsetRightDistance === 'number' &&
      Number.isFinite(density.offsetRightDistance) &&
      density.offsetRightDistance >= 0
        ? density.offsetRightDistance
        : 60

    if (
      typeof nextBarSpace === 'number' &&
      Number.isFinite(nextBarSpace) &&
      nextBarSpace > 0
    ) {
      chart.setBarSpace?.(nextBarSpace)
    }

    if (
      typeof nextOffsetRightDistance === 'number' &&
      Number.isFinite(nextOffsetRightDistance) &&
      nextOffsetRightDistance >= 0
    ) {
      chart.setOffsetRightDistance?.(nextOffsetRightDistance)
    }
  }, [])

  /** 检查是否在实时区域 */
  const checkIsAtRealTime = useCallback(() => {
    const chart = chartRef.current

    if (!chart?.getVisibleRange) return

    const range = chart.getVisibleRange()
    if (!range) return

    let latestIndex: number | null = null

    // 优先从图表实例取数据长度
    if (typeof chart.getDataList === 'function') {
      const list = chart.getDataList()
      if (Array.isArray(list) && list.length > 0) {
        latestIndex = list.length - 1
      }
    }

    // 兜底：如果数据还没准备好，默认视为在实时区域，避免按钮乱闪
    if (latestIndex == null) {
      setIsAtRealTime(true)
      return
    }

    // 给 2 根 bar 的容差，避免边界抖动
    const nextIsAtRealTime = range.to >= latestIndex - 2

    setIsAtRealTime((prev) =>
      prev === nextIsAtRealTime ? prev : nextIsAtRealTime,
    )
  }, [])

  const destroyChart = useCallback(() => {
    initRequestRef.current += 1
    resetLoading()
    resizeObserverRef.current?.disconnect()
    resizeObserverRef.current = null
    const chart = chartRef.current
    if (chart) {
      getChartEngine().dispose(chart)
      chartRef.current = null
    }
    didInitOverlaysRef.current = false
    isTooltipCollapsedRef.current = false
    setChartInstance(null)
    setReady(false)
  }, [resetLoading, setChartInstance, setReady])

  const initializeChart = useCallback(async (): Promise<Chart | null> => {
    if (chartRef.current) return chartRef.current
    const host = containerRef.current
    if (!host) return null

    const request = ++initRequestRef.current
    const engine = await loadChartEngine()
    // 加载模块期间组件可能已经卸载或再次发起初始化，旧任务不能创建游离实例。
    if (request !== initRequestRef.current || containerRef.current !== host)
      return null
    const chart = engine.init(host, initOptions)
    if (!chart) return null

    chartRef.current = chart
    // v10 的 layout 只定义布局默认值，指标与窗格在实例创建后显式初始化。
    chart.createIndicator({ name: 'MA', paneId: KLINE_MAIN_PANE_ID }, true)
    chart.createIndicator({
      name: VOL_INDICATOR_NAME,
      paneId: 'volume_pane',
      calcParams: [],
    })
    chart.setPaneOptions({
      id: 'volume_pane',
      order: 10,
      minHeight: VOL_PANE_MIN_HEIGHT,
    })
    chart.setDataLoader(proxiedDataLoader)
    setChartInstance(chart)
    setReady(true)

    applyVolStyle(chart)

    /** 初始化完成后应用一次 density 并检查实时状态 */
    requestAnimationFrame(() => {
      if (chartRef.current !== chart) return
      applyVolStyle(chart)
      if (!isVisibleSize(host)) return
      applyCandleDensity()
      ensureVolPaneHeight()
      checkIsAtRealTime()
    })

    let observedHeight = host.clientHeight
    const ro = new ResizeObserver(() => {
      const el = containerRef.current
      const current = chartRef.current
      if (!el || !current) return
      if (!isVisibleSize(el)) return

      // 宽度变化由引擎重排，保留用户缩放与滚动；只有高度变化才调整 VOL。
      if (el.clientHeight !== observedHeight) {
        observedHeight = el.clientHeight
        ensureVolPaneHeight()
      }
      checkIsAtRealTime()
    })
    ro.observe(host)
    resizeObserverRef.current = ro

    return chart
  }, [
    proxiedDataLoader,
    initOptions,
    setChartInstance,
    setReady,
    applyCandleDensity,
    ensureVolPaneHeight,
    checkIsAtRealTime,
    applyVolStyle,
  ])

  // 保持同步入口：首次调用启动异步加载，调用方通过 isReady 获知实例可用。
  const initChart = useCallback(() => {
    void initializeChart().catch((error) =>
      console.error('Failed to initialize kline chart', error),
    )
    return chartRef.current
  }, [initializeChart])

  useEffect(() => {
    return () => {
      destroyChart()
    }
  }, [destroyChart])

  useEffect(() => {
    // 切换图表类型时调用方可能只隐藏组件，首次显示前不创建 Canvas 实例。
    if (!visible) {
      initRequestRef.current += 1
      return
    }
    initChart()
  }, [visible, initChart])

  // Subscribe to tooltip collapse feature click
  useEffect(() => {
    const chart = chartRef.current
    if (!chart || !isReady) return

    const handler = () => {
      const next = !isTooltipCollapsedRef.current
      isTooltipCollapsedRef.current = next
      chart.setStyles({
        candle: {
          tooltip: {
            title: { show: false },
            legend: {
              // empty array hides all OHLCV rows; restore full template when expanding
              template: next ? [] : legendTemplate,
            },
            features: [buildTooltipCollapseFeature(next)],
          },
        },
        indicator: {
          tooltip: {
            offsetTop: MAIN_PANE_INDICATOR_TOOLTIP_OFFSET_TOP,
          },
        },
      })
    }

    chart.subscribeAction('onCandleTooltipFeatureClick', handler)
    return () => {
      chart.unsubscribeAction('onCandleTooltipFeatureClick', handler)
    }
  }, [isReady, legendTemplate])

  // Re-apply CSS-variable-dependent styles on theme switch
  useEffect(() => {
    const chart = chartRef.current
    if (!chart || !theme) return

    requestAnimationFrame(() => {
      chart.setStyles(
        createChartStyles(theme, legendTemplate, isTooltipCollapsedRef.current),
      )
      applyVolStyle(chart)
    })
  }, [theme, applyVolStyle, legendTemplate])

  useEffect(() => {
    if (!isReady) return
    const chart = chartRef.current
    if (!chart || !symbolInfo) return
    chart.setSymbol(symbolInfo)
    // ticker 交给引擎；store 的显示上下文另带价格口径，不能当作订阅频道名使用。
    setSymbolState(`${symbolInfo.ticker}:${klinePriceType}`)
  }, [symbolInfo, setSymbolState, isReady, klinePriceType])

  useEffect(() => {
    if (!isReady) return
    const chart = chartRef.current
    if (!chart) return
    chart.setFormatter(formatter)
  }, [formatter, isReady])

  useEffect(() => {
    if (!isReady) return
    const chart = chartRef.current
    if (!chart || !period) return
    chart.setPeriod(period)
    setPeriodState(period)
  }, [period, setPeriodState, isReady])

  useEffect(() => {
    if (!visible || !isReady) return
    const chart = chartRef.current
    const host = containerRef.current
    if (!chart || !host || !isVisibleSize(host)) return
    // 隐藏时引擎宽度为 0；先完成 resize 布局，再恢复留白，避免被零宽度裁掉。
    chart.resize()
    const frame = requestAnimationFrame(() => {
      if (chartRef.current !== chart || !isVisibleSize(host)) return

      applyCandleDensity()
      for (const { id, paneId, name } of chart.getYAxes({}))
        chart.overrideYAxis({ id, paneId, name })
      ensureVolPaneHeight()
      checkIsAtRealTime()
    })
    return () => cancelAnimationFrame(frame)
  }, [
    visible,
    isReady,
    applyCandleDensity,
    ensureVolPaneHeight,
    checkIsAtRealTime,
  ])

  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return
    chart.setLocale(locale)
    requestAnimationFrame(() => {
      /** locale 变化后补一次 density 并检查实时状态 */
      applyCandleDensity()
      ensureVolPaneHeight()
      checkIsAtRealTime()
    })
  }, [locale, applyCandleDensity, ensureVolPaneHeight, checkIsAtRealTime])

  /** density 配置变化时，强制重新应用（值比较，避免内联对象引用变化误触发） */
  useEffect(() => {
    const prev = prevDensityValuesRef.current
    const next = candleDensity ?? {}
    if (
      prev.barSpace === next.barSpace &&
      prev.offsetRightDistance === next.offsetRightDistance
    ) {
      return
    }
    prevDensityValuesRef.current = {
      barSpace: next.barSpace,
      offsetRightDistance: next.offsetRightDistance,
    }
    requestAnimationFrame(() => {
      applyCandleDensity()
      ensureVolPaneHeight()
      checkIsAtRealTime()
    })
  }, [
    candleDensity,
    applyCandleDensity,
    ensureVolPaneHeight,
    checkIsAtRealTime,
  ])

  /** 轻量轮询，实时更新“是否离开实时区域” */
  useEffect(() => {
    if (!visible) return

    let rafId = 0
    let frame = 0

    const loop = () => {
      frame += 1

      // 每 6 帧检查一次，降低开销（大约 10fps）
      if (frame % 6 === 0) {
        checkIsAtRealTime()
      }

      rafId = requestAnimationFrame(loop)
    }

    rafId = requestAnimationFrame(loop)

    return () => {
      cancelAnimationFrame(rafId)
    }
  }, [visible, checkIsAtRealTime])

  const overlayApi = useChartOverlay({ chartRef, initialized: isReady })

  // initialOverlays 是每个实例的一次性种子；后续交易线更新由 useTpslOverlay 管理。
  useEffect(() => {
    if (!isReady) return
    if (didInitOverlaysRef.current || initialOverlays.length === 0) return
    didInitOverlaysRef.current = true
    const result = overlayApi.createOverlay(initialOverlays)
    if (Array.isArray(result)) {
      result.forEach((id) => {
        addOverlayId(id)
      })
    } else {
      addOverlayId(result)
    }
  }, [isReady, addOverlayId, initialOverlays, overlayApi])

  const resize = useCallback(() => {
    chartRef.current?.resize()

    /** 手动 resize 时也同步 density 和实时状态 */
    applyCandleDensity()
    ensureVolPaneHeight()
    checkIsAtRealTime()
  }, [applyCandleDensity, ensureVolPaneHeight, checkIsAtRealTime])

  /** 回到实时，默认带一个平滑横向滚动动画 */
  const scrollToRealTime = useCallback(
    (animationDuration = SCROLL_TO_REALTIME_ANIMATION_MS) => {
      const chart = chartRef.current as
        | (Chart & {
            scrollToRealTime?: (animationDuration?: number) => void
          })
        | null

      chart?.scrollToRealTime?.(animationDuration)

      requestAnimationFrame(() => {
        checkIsAtRealTime()
      })
    },
    [checkIsAtRealTime],
  )

  const setSymbol = useCallback(
    (next: SymbolInfo) => {
      chartRef.current?.setSymbol(next)
      setSymbolState(next.ticker)
    },
    [setSymbolState],
  )

  const setPeriod = useCallback(
    (next: Period) => {
      chartRef.current?.setPeriod(next)
      setPeriodState(next)
    },
    [setPeriodState],
  )

  const resetData = useCallback(() => {
    chartRef.current?.resetData()
  }, [])

  const createOverlay = useCallback(
    (value: string | OverlayCreate | Array<string | OverlayCreate>) => {
      const result = overlayApi.createOverlay(value)
      if (Array.isArray(result)) {
        result.forEach((id) => {
          addOverlayId(id)
        })
        return result.filter((id): id is string => Boolean(id))
      }
      addOverlayId(result)
      return result
    },
    [addOverlayId, overlayApi],
  )

  const getOverlays = useCallback(
    (filter?: OverlayFilter) => overlayApi.getOverlays(filter),
    [overlayApi],
  )

  const removeOverlay = useCallback(
    (filter?: OverlayFilter) => overlayApi.removeOverlay(filter),
    [overlayApi],
  )

  return {
    wrapperRef,
    containerRef,
    chartRef,
    chartInstance: chartRef.current,
    isReady,
    isDataLoading,
    isAtRealTime,
    initChart,
    overlayApi,
    resize,
    scrollToRealTime,
    setSymbol,
    setPeriod,
    resetData,
    createOverlay,
    getOverlays,
    removeOverlay,
    overrideOverlayGroup: overlayApi.overrideOverlayGroup,
    toggleGroupVisibility: overlayApi.toggleGroupVisibility,
    removeOverlayGroup: overlayApi.removeOverlayGroup,
  }
}
