import { useCallback, useEffect, useReducer, useRef } from 'react'

/** 图形持有稳定代理，事件发生时才读取最新业务回调。 */
export function useOverlayInteractions(initialized: boolean) {
  const [closeHoverRevision, forceCloseHoverRevision] = useReducer(
    (count: number) => count + 1,
    0,
  )
  const [lineHoverRevision, forceLineHoverRevision] = useReducer(
    (count: number) => count + 1,
    0,
  )
  const closeHoverStateRef = useRef(new Map<string, boolean>())
  const closeHoverHandlersRef = useRef(
    new Map<string, (hovered: boolean) => void>(),
  )
  // 图形保留稳定的代理函数，点击时再取最新业务回调，避免捕获旧订单数据。
  const closeCallbackStoreRef = useRef(
    new Map<string, (() => void) | undefined>(),
  )
  const closeProxyHandlersRef = useRef(new Map<string, () => void>())
  const lineHoverStateRef = useRef(new Map<string, boolean>())
  const lineHoverHandlersRef = useRef(
    new Map<string, (hovered: boolean) => void>(),
  )

  const ensureCloseHoverHandler = useCallback((baseId: string) => {
    const existing = closeHoverHandlersRef.current.get(baseId)
    if (existing) return existing
    const handler = (hovered: boolean) => {
      const prev = closeHoverStateRef.current.get(baseId)
      if (prev === hovered) return
      closeHoverStateRef.current.set(baseId, hovered)
      forceCloseHoverRevision()
    }
    closeHoverHandlersRef.current.set(baseId, handler)
    return handler
  }, [])

  const ensureCloseProxyHandler = useCallback((baseId: string) => {
    const existing = closeProxyHandlersRef.current.get(baseId)
    if (existing) return existing
    const handler = () => {
      closeCallbackStoreRef.current.get(baseId)?.()
    }
    closeProxyHandlersRef.current.set(baseId, handler)
    return handler
  }, [])

  const getCloseButtonHandlers = useCallback(
    (baseId: string) => ({
      onClose: ensureCloseProxyHandler(baseId),
      onHoverChange: ensureCloseHoverHandler(baseId),
    }),
    [ensureCloseHoverHandler, ensureCloseProxyHandler],
  )

  const setCloseButtonCallback = useCallback(
    (baseId: string, cb?: () => void) => {
      closeCallbackStoreRef.current.set(baseId, cb)
    },
    [],
  )

  const ensureLineHoverHandler = useCallback((baseId: string) => {
    const existing = lineHoverHandlersRef.current.get(baseId)
    if (existing) return existing
    const handler = (hovered: boolean) => {
      const prev = lineHoverStateRef.current.get(baseId)
      if (prev === hovered) return
      lineHoverStateRef.current.set(baseId, hovered)
      forceLineHoverRevision()
    }
    lineHoverHandlersRef.current.set(baseId, handler)
    return handler
  }, [])

  const cleanupOverlayState = useCallback((baseId: string) => {
    closeHoverStateRef.current.delete(baseId)
    closeHoverHandlersRef.current.delete(baseId)
    closeCallbackStoreRef.current.delete(baseId)
    closeProxyHandlersRef.current.delete(baseId)
    lineHoverStateRef.current.delete(baseId)
    lineHoverHandlersRef.current.delete(baseId)
  }, [])

  useEffect(() => {
    if (!initialized) {
      closeHoverStateRef.current.clear()
      closeHoverHandlersRef.current.clear()
      closeCallbackStoreRef.current.clear()
      closeProxyHandlersRef.current.clear()
      lineHoverStateRef.current.clear()
      lineHoverHandlersRef.current.clear()
    }
  }, [initialized])

  return {
    closeHoverRevision,
    lineHoverRevision,
    closeHoverStateRef,
    lineHoverStateRef,
    getCloseButtonHandlers,
    setCloseButtonCallback,
    ensureLineHoverHandler,
    cleanupOverlayState,
  }
}
