'use client'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
} from 'react'
import { createChartFeed } from '@/lib/chart-feed'
import type { ChartInterval } from '@/lib/chart-periods'
import { info } from '@/lib/hyperliquid'
import type { Candle } from '@/lib/market-data'

export function useChartFeed({
  coin,
  interval,
  szDecimals,
  label,
  priceDecimals,
  candles,
}: {
  coin: string
  interval: ChartInterval
  szDecimals: number
  label?: string
  priceDecimals?: number
  candles: Candle[]
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
  useLayoutEffect(() => {
    if (source.select(context)) {
      setLoaded(false)
      setCount(0)
      setError('')
    }
  }, [source, context])
  useEffect(() => {
    source.update(candles)
  }, [source, candles])
  useEffect(() => () => source.dispose(), [source])
  return { source, count, error, loaded }
}
