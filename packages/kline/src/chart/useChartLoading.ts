import type { DataLoader } from 'klinecharts'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

const INIT_LOADING_MIN_DURATION_MS = 320

/** 只管理首次加载遮罩；行情是否过期仍由业务 DataLoader 判断。 */
export function useChartLoading(dataLoader: DataLoader) {
  const loadingHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const initLoadSeqRef = useRef(0)
  const initLoadingStartAtRef = useRef(0)
  const [isDataLoading, setIsDataLoading] = useState(false)

  const clearLoadingHideTimer = useCallback(() => {
    if (loadingHideTimerRef.current) {
      clearTimeout(loadingHideTimerRef.current)
      loadingHideTimerRef.current = null
    }
  }, [])

  const finishInitLoading = useCallback(
    (seq: number) => {
      // 切交易对/周期会产生新 init，旧请求结束不能提前关闭新请求的遮罩。
      if (initLoadSeqRef.current !== seq) return

      const elapsed = Date.now() - initLoadingStartAtRef.current
      const nextDelay = Math.max(0, INIT_LOADING_MIN_DURATION_MS - elapsed)

      clearLoadingHideTimer()
      loadingHideTimerRef.current = setTimeout(() => {
        if (initLoadSeqRef.current !== seq) return
        setIsDataLoading(false)
        loadingHideTimerRef.current = null
      }, nextDelay)
    },
    [clearLoadingHideTimer],
  )

  // 序号只保护加载遮罩；过期行情的隔离仍由 dataLoader 处理，翻页和订阅保持原契约。
  const proxiedDataLoader = useMemo<DataLoader>(() => {
    return {
      getBars(params) {
        if (params.type !== 'init') {
          return dataLoader.getBars(params)
        }

        clearLoadingHideTimer()
        const seq = initLoadSeqRef.current + 1
        initLoadSeqRef.current = seq
        initLoadingStartAtRef.current = Date.now()
        setIsDataLoading(true)

        let didFinish = false
        const finish = () => {
          if (didFinish) return
          didFinish = true
          finishInitLoading(seq)
        }

        try {
          const result = dataLoader.getBars({
            ...params,
            callback(data, more) {
              try {
                params.callback(data, more)
              } finally {
                finish()
              }
            },
          })

          if (result && typeof (result as Promise<void>).catch === 'function') {
            void Promise.resolve(result).catch(() => {
              finish()
            })
          }

          return result
        } catch (error) {
          finish()
          throw error
        }
      },
      subscribeBar: dataLoader.subscribeBar?.bind(dataLoader),
      unsubscribeBar: dataLoader.unsubscribeBar?.bind(dataLoader),
    }
  }, [clearLoadingHideTimer, dataLoader, finishInitLoading])

  const resetLoading = useCallback(() => {
    initLoadSeqRef.current += 1
    clearLoadingHideTimer()
    setIsDataLoading(false)
  }, [clearLoadingHideTimer])

  useEffect(
    () => () => {
      initLoadSeqRef.current += 1
      clearLoadingHideTimer()
    },
    [clearLoadingHideTimer],
  )

  return { isDataLoading, proxiedDataLoader, resetLoading }
}
