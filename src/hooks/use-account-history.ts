import { useEffect, useState } from 'react'
import { fundingPages } from '@/lib/account-records'
import { errorText, type Fill, info } from '@/lib/hyperliquid'

type History = {
  orders: Awaited<ReturnType<typeof info.historicalOrders>>
  funding: Awaited<ReturnType<typeof info.userFunding>>
  twapFills: Awaited<ReturnType<typeof info.userTwapSliceFills>>
  fills: Fill[]
}
const empty: History = { orders: [], funding: [], twapFills: [], fills: [] }
export function useAccountHistory(
  address: `0x${string}` | null,
  tab: string,
  startTime: number,
  aggregate: boolean,
) {
  const [state, setState] = useState<{
    owner: string
    tab: string
    data: History
    error: string
    loading: boolean
  }>({ owner: '', tab: '', data: empty, error: '', loading: false })
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    void retry
    if (!address || !['history', 'funding', 'twapFills', 'fills'].includes(tab))
      return
    const user = address
    const controller = new AbortController()
    const signal = controller.signal
    async function load(): Promise<History> {
      if (tab === 'history')
        return {
          ...empty,
          orders: await info.historicalOrders({ user }, signal),
        }
      if (tab === 'twapFills')
        return {
          ...empty,
          twapFills: await info.userTwapSliceFills({ user }, signal),
        }
      if (tab === 'fills')
        return {
          ...empty,
          fills: await info.userFills(
            { user, aggregateByTime: aggregate },
            signal,
          ),
        }
      const endTime = Date.now()
      const funding = await fundingPages(
        (cursor) =>
          info.userFunding({ user, startTime: cursor, endTime }, signal),
        startTime,
      )
      return { ...empty, funding }
    }
    let inFlight = false
    async function refresh() {
      if (inFlight || signal.aborted) return
      inFlight = true
      setState((previous) => ({
        owner: user,
        tab,
        data:
          previous.owner === user && previous.tab === tab
            ? previous.data
            : empty,
        error: '',
        loading: true,
      }))
      try {
        const data = await load()
        if (!signal.aborted)
          setState({ owner: user, tab, data, error: '', loading: false })
      } catch (error) {
        if (!signal.aborted)
          setState({
            owner: user,
            tab,
            data: empty,
            error: errorText(error),
            loading: false,
          })
      } finally {
        inFlight = false
      }
    }
    const visibleRefresh = () => {
      if (!document.hidden) void refresh()
    }
    void refresh()
    const timer = setInterval(visibleRefresh, 30000)
    document.addEventListener('visibilitychange', visibleRefresh)
    window.addEventListener('online', visibleRefresh)
    return () => {
      controller.abort()
      clearInterval(timer)
      document.removeEventListener('visibilitychange', visibleRefresh)
      window.removeEventListener('online', visibleRefresh)
    }
  }, [address, tab, startTime, aggregate, retry])
  return state.owner === address && state.tab === tab
    ? { ...state, retry: () => setRetry((n) => n + 1) }
    : {
        data: empty,
        error: '',
        loading: !!address,
        retry: () => setRetry((n) => n + 1),
      }
}
