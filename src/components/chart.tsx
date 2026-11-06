'use client'

import { BaseKlineChart } from '@fameex/kline'
import type { Chart as KlineChart } from 'klinecharts'
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useChartControls } from '@/hooks/use-chart-controls'
import { useChartFeed } from '@/hooks/use-chart-feed'
import { useTradingView } from '@/hooks/use-tradingview'
import { t, useLocale } from '@/i18n'
import type { createChartFeed } from '@/lib/chart-feed'
import {
  type ChartInterval,
  chartPeriods,
  intervalMs,
} from '@/lib/chart-periods'
import type { Candle } from '@/lib/market-data'
import type { IChartingLibraryWidget } from '../../public/lib/charting_library/charting_library'
import { ChartDrawingTools } from './trading/chart-drawing-tools'
import { ChartIndicators } from './trading/chart-indicators'
import { type ChartEngine, ChartToolbar } from './trading/chart-toolbar'
import { ChartTradeLines } from './trading/chart-trade-lines'

type Props = {
  coin: string
  label?: string
  priceDecimals?: number
  interval: ChartInterval
  candleReconnectVersion: number
  onIntervalChange: (value: ChartInterval) => void
  szDecimals: number
  candles: Candle[]
}

type ChartView = {
  fromTime?: number
  toTime?: number
  followsLatest: boolean
  widthSeconds?: number
  barSpace?: number
  offsetRight?: number
}

type RecoveryStatus = 'idle' | 'syncing' | 'error' | 'incomplete'

function captureKlineView(chart: KlineChart): ChartView {
  const data = chart.getDataList()
  const range = chart.getVisibleRange()
  const fromIndex = Math.max(0, Math.floor(range.realFrom))
  const toIndex = Math.min(data.length - 1, Math.ceil(range.realTo))
  return {
    fromTime: data[fromIndex]?.timestamp,
    toTime: data[toIndex]?.timestamp,
    followsLatest: range.to >= data.length - 3,
    barSpace: chart.getBarSpace().bar,
    offsetRight: chart.getOffsetRightDistance(),
  }
}

function nextFrame() {
  return new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
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
  const controls = useChartControls(engine, props.onIntervalChange, props.coin)
  const [tvMounted, setTvMounted] = useState(false)
  const [preservedEngine, setPreservedEngine] = useState<ChartEngine | null>(
    null,
  )
  const { source, count, error, loaded } = useChartFeed(props)
  const [recoveryStatus, setRecoveryStatus] = useState<RecoveryStatus>('idle')
  const [recoveryError, setRecoveryError] = useState('')
  const engineRef = useRef(engine)
  const recoveryRef = useRef<(target?: ChartEngine) => Promise<void>>(
    async () => {},
  )
  const recoveryFlightRef = useRef<Promise<void> | null>(null)
  const recoveryFlightTokenRef = useRef(0)
  const pendingEngineRef = useRef<ChartEngine | null>(null)
  const needsHistoryRef = useRef(false)
  const recoveryCompleteRef = useRef(true)
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const retryAttemptRef = useRef(0)
  const lastReconnectVersionRef = useRef(props.candleReconnectVersion)
  const selectionKey = `${props.coin}:${props.interval}`
  const selectionKeyRef = useRef(selectionKey)
  const resetSelectionKeyRef = useRef(selectionKey)
  selectionKeyRef.current = selectionKey
  engineRef.current = engine
  useEffect(() => source.setVisibleEngine(engine), [source, engine])

  const runRecovery = useCallback(
    async (target = engineRef.current) => {
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current)
        retryTimerRef.current = null
      }
      if (recoveryFlightRef.current) return recoveryFlightRef.current
      if (
        document.visibilityState !== 'visible' ||
        (typeof navigator !== 'undefined' && !navigator.onLine)
      ) {
        pendingEngineRef.current = target
        if (
          document.visibilityState === 'visible' &&
          typeof navigator !== 'undefined' &&
          !navigator.onLine
        ) {
          setRecoveryError('网络不可用，等待恢复后重试')
          setRecoveryStatus('error')
        }
        return
      }
      const kline = target === 'kline' ? controls.kline : null
      const widget = target === 'tradingview' ? controls.tradingView : null
      if (!kline && !widget) {
        pendingEngineRef.current = target
        return
      }

      const view: ChartView | null = kline
        ? captureKlineView(kline)
        : (() => {
            const range = widget?.activeChart().getVisibleRange()
            if (!range || range.from <= 0 || range.to <= range.from) return null
            return {
              fromTime: range.from * 1000,
              toTime: range.to * 1000,
              widthSeconds: range.to - range.from,
              followsLatest:
                range.to * 1000 >= Date.now() - intervalMs(props.interval) * 3,
            }
          })()
      pendingEngineRef.current = target
      setRecoveryStatus('syncing')
      setRecoveryError('')

      const task = (async () => {
        const flightToken = ++recoveryFlightTokenRef.current
        const runSelectionKey = selectionKeyRef.current
        const isCurrent = () =>
          selectionKeyRef.current === runSelectionKey &&
          recoveryFlightTokenRef.current === flightToken
        try {
          // 重连才校准共享历史；切换引擎只加载它遗漏的数据，避免两边反复互相标脏。
          if (needsHistoryRef.current) {
            const result = await source.recover(view?.fromTime)
            if (!isCurrent()) return
            needsHistoryRef.current = false
            recoveryCompleteRef.current = result.complete
          }
          if (source.isEngineDirty(target)) {
            await source.refreshEngine(target, () => {
              if (target === 'kline') kline?.resetData()
              else widget?.activeChart().resetData()
            })
          }
          if (!isCurrent()) return
          await nextFrame()
          if (!isCurrent()) return
          if (kline && view) {
            if (view.barSpace) kline.setBarSpace(view.barSpace)
            if (view.offsetRight !== undefined)
              kline.setOffsetRightDistance(view.offsetRight)
            if (view.followsLatest) kline.scrollToRealTime()
            else if (view.toTime) kline.scrollToTimestamp(view.toTime)
          } else if (widget && view?.fromTime && view.toTime) {
            const chart = widget.activeChart()
            if (view.followsLatest) {
              const width = view.widthSeconds ?? 3600
              await chart.setVisibleRange({ from: Date.now() / 1000 - width })
            } else {
              await chart.setVisibleRange({
                from: view.fromTime / 1000,
                to: view.toTime / 1000,
              })
            }
          }
          if (!isCurrent()) return
          if (pendingEngineRef.current === target && !needsHistoryRef.current) {
            pendingEngineRef.current = null
            setPreservedEngine(null)
          }
          retryAttemptRef.current = 0
          if (recoveryFlightTokenRef.current === flightToken)
            recoveryFlightRef.current = null
          setRecoveryStatus(recoveryCompleteRef.current ? 'idle' : 'incomplete')
        } catch (e) {
          if (!isCurrent()) return
          if (recoveryFlightTokenRef.current === flightToken)
            recoveryFlightRef.current = null
          const message = e instanceof Error ? e.message : String(e)
          setRecoveryError(message)
          setRecoveryStatus('error')
          source.setVisibleEngine(engineRef.current)
          pendingEngineRef.current ??= target
          const delay = Math.min(1000 * 2 ** retryAttemptRef.current++, 30000)
          if (retryTimerRef.current) clearTimeout(retryTimerRef.current)
          retryTimerRef.current = setTimeout(() => {
            retryTimerRef.current = null
            if (
              document.visibilityState === 'visible' &&
              (typeof navigator === 'undefined' || navigator.onLine)
            )
              void recoveryRef.current(
                pendingEngineRef.current ?? engineRef.current,
              )
          }, delay)
        } finally {
          if (isCurrent()) {
            recoveryFlightRef.current = null
            const next = pendingEngineRef.current
            if (
              next &&
              (next !== target ||
                (needsHistoryRef.current && !retryTimerRef.current))
            )
              void recoveryRef.current(next)
          }
        }
      })()
      recoveryFlightRef.current = task
      return task
    },
    [controls.kline, controls.tradingView, props.interval, source],
  )
  recoveryRef.current = runRecovery

  const triggerRecovery = useCallback(() => {
    needsHistoryRef.current = true
    pendingEngineRef.current ??= engineRef.current
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current)
      retryTimerRef.current = null
    }
    void recoveryRef.current(pendingEngineRef.current ?? engineRef.current)
  }, [])

  useEffect(() => {
    if (error && !recoveryFlightRef.current) triggerRecovery()
  }, [error, triggerRecovery])

  useEffect(() => {
    let wasHidden = document.visibilityState === 'hidden'
    const pageShown = (event: PageTransitionEvent) => {
      if (event.persisted) triggerRecovery()
    }
    const visibilityChanged = () => {
      const hidden = document.visibilityState === 'hidden'
      if (wasHidden && !hidden) triggerRecovery()
      wasHidden = hidden
    }
    window.addEventListener('online', triggerRecovery)
    window.addEventListener('pageshow', pageShown)
    document.addEventListener('visibilitychange', visibilityChanged)
    return () => {
      window.removeEventListener('online', triggerRecovery)
      window.removeEventListener('pageshow', pageShown)
      document.removeEventListener('visibilitychange', visibilityChanged)
    }
  }, [triggerRecovery])

  useEffect(() => {
    if (lastReconnectVersionRef.current === props.candleReconnectVersion) return
    lastReconnectVersionRef.current = props.candleReconnectVersion
    triggerRecovery()
  }, [props.candleReconnectVersion, triggerRecovery])

  useEffect(() => {
    const target = pendingEngineRef.current
    if (target && (target === 'kline' ? controls.kline : controls.tradingView))
      void recoveryRef.current(target)
  }, [controls.kline, controls.tradingView])

  useLayoutEffect(() => {
    if (resetSelectionKeyRef.current === selectionKey) return
    resetSelectionKeyRef.current = selectionKey
    recoveryFlightTokenRef.current++
    recoveryFlightRef.current = null
    pendingEngineRef.current = null
    needsHistoryRef.current = false
    recoveryCompleteRef.current = true
    setPreservedEngine(null)
    retryAttemptRef.current = 0
    if (retryTimerRef.current) clearTimeout(retryTimerRef.current)
    retryTimerRef.current = null
    setRecoveryStatus('idle')
    setRecoveryError('')
  }, [selectionKey])

  useEffect(
    () => () => {
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current)
      recoveryFlightTokenRef.current++
      recoveryFlightRef.current = null
    },
    [],
  )

  const changeEngine = useCallback(
    (value: ChartEngine) => {
      if (value === 'tradingview') setTvMounted(true)
      if (recoveryFlightRef.current || source.isEngineDirty(value)) {
        pendingEngineRef.current = value
        setPreservedEngine(
          (previous) =>
            previous ??
            (engineRef.current === value ? null : engineRef.current),
        )
        setRecoveryError('')
        setRecoveryStatus('syncing')
        setEngine(value)
        void recoveryRef.current(value)
      } else {
        setPreservedEngine(null)
        setEngine(value)
      }
    },
    [source],
  )

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
      className={`flex min-h-0 flex-1 flex-col bg-panel ${controls.fullscreen ? 'fixed inset-0 z-50 h-dvh w-dvw' : ''}`}
    >
      <ChartToolbar
        interval={props.interval}
        controls={controls}
        engine={engine}
        onEngineChange={changeEngine}
      />
      <div className="relative min-h-[400px] flex-1 md:min-h-[460px] lg:min-h-0">
        <section
          hidden={engine !== 'kline' && preservedEngine !== 'kline'}
          aria-hidden={engine !== 'kline' && preservedEngine !== 'kline'}
          inert={engine !== 'kline'}
          className={`absolute inset-0 ${preservedEngine === 'kline' ? 'z-20' : 'z-10'}`}
          aria-label={
            t('基础版 K 线图，已加载 ') + count + t(' 根蜡烛，时间使用本地时区')
          }
        >
          <BaseKlineChart
            onChartReady={controls.onKlineReady}
            leftSlot={
              <ChartDrawingTools
                key={controls.drawingReset}
                chart={controls.kline}
                coin={props.coin}
                visible={engine === 'kline' || preservedEngine === 'kline'}
                expanded={controls.drawing}
                onExpandedChange={controls.setDrawing}
              />
            }
            visible={engine === 'kline' || preservedEngine === 'kline'}
            dataLoader={source.kline}
            symbolInfo={symbol}
            period={chartPeriods[props.interval]}
            klinePriceType="trade"
            locale={locale}
            theme="dark"
            className="absolute inset-0 flex"
          >
            {(result) => (
              <ChartTradeLines
                chart={result}
                visibility={controls.tradeLines}
                visible={engine === 'kline' || preservedEngine === 'kline'}
              />
            )}
          </BaseKlineChart>
        </section>
        {tvMounted && (
          <section
            hidden={
              engine !== 'tradingview' && preservedEngine !== 'tradingview'
            }
            aria-hidden={
              engine !== 'tradingview' || preservedEngine === 'kline'
            }
            className={`absolute inset-0 ${preservedEngine === 'tradingview' ? 'z-20' : engine === 'tradingview' ? 'z-10' : 'z-0 pointer-events-none'}`}
            inert={engine !== 'tradingview' || preservedEngine === 'kline'}
            aria-label={
              t('TradingView K 线图，已加载 ') +
              count +
              t(' 根蜡烛，时间使用本地时区')
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
        {recoveryStatus !== 'idle' && (
          <div
            role={recoveryStatus === 'error' ? 'alert' : 'status'}
            className="absolute left-2 top-2 z-40 flex items-center gap-2 rounded border border-edge bg-panel/95 px-2 py-1 text-xs text-ink shadow"
          >
            <span>
              {recoveryStatus === 'syncing'
                ? t('K 线历史同步中')
                : recoveryStatus === 'incomplete'
                  ? t('部分历史超出交易所留存范围，无法校准')
                  : `${t('K 线历史同步失败：')}${t(recoveryError)}`}
            </span>
            {recoveryStatus === 'error' && (
              <button
                type="button"
                className="rounded px-1.5 py-0.5 text-accent hover:bg-cc-2"
                onClick={() => {
                  retryAttemptRef.current = 0
                  triggerRecovery()
                }}
              >
                {t('重试同步')}
              </button>
            )}
          </div>
        )}
      </div>
      {engine === 'kline' && controls.indicatorsOpen && controls.kline && (
        <ChartIndicators
          chart={controls.kline}
          onClose={() => controls.setIndicatorsOpen(false)}
        />
      )}
      {controls.error && (
        <p role="alert" className="p-2 text-xs text-loss">
          {t(controls.error)}
        </p>
      )}
    </div>
  )
})
