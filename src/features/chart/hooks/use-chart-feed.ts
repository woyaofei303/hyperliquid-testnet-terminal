'use client'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { createChartFeed } from '@/features/chart/lib/chart-feed'
import type { ChartInterval } from '@/features/chart/lib/chart-periods'
import type { Candle } from '@/features/market/lib/market-data'
import { info } from '@/shared/lib/hyperliquid'

export function useChartFeed({
  coin,
  interval,
  szDecimals,
  label,
  priceDecimals,
  candles,
  candleRecovery,
}: {
  coin: string
  interval: ChartInterval
  szDecimals: number
  label?: string
  priceDecimals?: number
  candles: Candle[]
  candleRecovery?: { version: number; fromTime: number }
}) {
  const [count, setCount] = useState(0)
  const [error, setError] = useState('')
  const [loaded, setLoaded] = useState(false)
  const onLoaded = useCallback((count: number) => {
    setCount(count)
    setLoaded(true)
  }, [])
  const context = useMemo(
    () => ({
      coin,
      interval,
      szDecimals,
      label,
      priceDecimals,
      history: (startTime: number, endTime: number) =>
        info.candleSnapshot({ coin, interval, startTime, endTime }),
      onLoaded,
      onError: setError,
    }),
    [coin, interval, szDecimals, label, priceDecimals, onLoaded],
  )
  const [source] = useState(() => createChartFeed(context))
  const previousRecovery = useRef(candleRecovery)
  useLayoutEffect(() => {
    if (source.select(context)) {
      setLoaded(false)
      setCount(0)
      setError('')
      previousRecovery.current = candleRecovery
    }
    if (candleRecovery !== previousRecovery.current && candleRecovery?.version)
      source.markGap(candleRecovery.fromTime)
    previousRecovery.current = candleRecovery
  }, [source, context, candleRecovery])
  useEffect(() => {
    source.update(candles)
  }, [source, candles])
  useEffect(() => () => source.dispose(), [source])
  return { source, count, error, loaded }
}
