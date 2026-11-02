import { getColorByCssVar, withAlpha } from '@fameex/utils'
import type {
  DataLoader,
  Options,
  OverlayCreate,
  Period,
  SymbolInfo,
} from 'klinecharts'
import { memo, useEffect, useRef, useState } from 'react'
import {
  type UseBaseKlineChartResult,
  useBaseKlineChart,
} from './useBaseKlineChart'

export type CandleDensityOptions = {
  /** 固定每根K线的 spacing，优先使用 */
  barSpace?: number
  /** 右侧留白 */
  offsetRightDistance?: number
}

export type BaseKlineChartProps = {
  visible: boolean
  dataLoader: DataLoader
  symbolInfo: SymbolInfo | null
  period: Period | null
  klinePriceType: string
  locale: 'zh-CN' | 'en-US'
  theme?: string
  options?: Options
  initialOverlays?: Array<string | OverlayCreate>
  leftSlot?: React.ReactNode
  className?: string
  containerClassName?: string
  candleDensity?: CandleDensityOptions
  /** 插入：是否显示“回到实时”按钮 */
  showBackToRealTime?: boolean
  /** Optional callback to use the chart result for additional hooks like trade overlay */
  onChartReady?: (result: UseBaseKlineChartResult) => void
  /** Optional render prop for additional chart effects */
  children?: (result: UseBaseKlineChartResult) => React.ReactNode
}

const LOADING_MASK_FADE_MS = 180

function LoadingMask({ visible }: { visible: boolean }) {
  const baseBg = getColorByCssVar('--fx-bg-2') || '#17181D'
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [shouldRender, setShouldRender] = useState(visible)
  const [shown, setShown] = useState(false)

  useEffect(() => {
    return () => {
      if (hideTimerRef.current) {
        clearTimeout(hideTimerRef.current)
      }
    }
  }, [])

  useEffect(() => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current)
      hideTimerRef.current = null
    }

    if (visible) {
      setShouldRender(true)
      const rafId = requestAnimationFrame(() => {
        setShown(true)
      })
      return () => {
        cancelAnimationFrame(rafId)
      }
    }

    setShown(false)
    hideTimerRef.current = setTimeout(() => {
      setShouldRender(false)
      hideTimerRef.current = null
    }, LOADING_MASK_FADE_MS)
  }, [visible])

  if (!shouldRender) return null

  return (
    <div
      className="pointer-events-auto absolute inset-0 z-30"
      style={{
        backgroundColor: withAlpha(baseBg, 0.5),
        opacity: shown ? 1 : 0,
        transition: `opacity ${LOADING_MASK_FADE_MS}ms ease`,
      }}
    />
  )
}

export function BaseKlineChart({
  visible,
  dataLoader,
  symbolInfo,
  period,
  klinePriceType,
  locale,
  theme,
  options,
  initialOverlays,
  leftSlot,
  className = 'relative flex h-full w-full',
  containerClassName = 'h-full w-full min-w-0 flex-1',
  candleDensity,
  showBackToRealTime = true,
  onChartReady,
  children,
}: BaseKlineChartProps) {
  const chartResult = useBaseKlineChart({
    visible,
    dataLoader,
    symbolInfo,
    period,
    klinePriceType,
    locale,
    theme,
    options,
    initialOverlays,
    candleDensity,
  })

  useEffect(() => {
    if (chartResult.isReady && onChartReady) {
      onChartReady(chartResult)
    }
  }, [chartResult, onChartReady])

  return (
    <div ref={chartResult.wrapperRef} className={className}>
      {leftSlot}
      <div ref={chartResult.containerRef} className={containerClassName} />
      {showBackToRealTime && !chartResult.isAtRealTime && (
        <button
          type="button"
          aria-label="回到实时"
          style={{ right: '80px', bottom: '40px' }}
          onClick={() => chartResult.scrollToRealTime()}
          className="bg-cc-2 text-text-1 hover:bg-hover-n absolute z-20 rounded-md border border-none p-1 text-xs shadow-md transition"
        >
          <svg
            aria-hidden="true"
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 18 18"
            width="18"
            height="18"
          >
            <path
              fill="currentColor"
              d="M7.45 3.5 12.48 9l-5.03 5.49 1.1 1.01L14.52 9 8.55 2.49 7.45 3.5Z"
            />
            <path
              fill="currentColor"
              d="m3.93 5.99 2.58 3-2.58 3.02 1.14.98 3.42-4-3.42-3.98L3.93 6Z"
            />
          </svg>
        </button>
      )}

      <LoadingMask visible={visible && chartResult.isDataLoading} />

      {children?.(chartResult)}
    </div>
  )
}

export default memo(BaseKlineChart)

export type { UseBaseKlineChartResult }
