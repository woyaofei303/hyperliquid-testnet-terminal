'use client'

import { SubscriptionClient, WebSocketTransport } from '@nktkas/hyperliquid'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  type AccountSnapshot,
  errorText,
  loadAccount,
  WS_URL,
} from '@/shared/lib/fameex-testnet'
import { createFrameBatch } from '@/shared/lib/frame-batch'
import { performanceMetrics } from '@/shared/lib/performance'

export function useAccount(address: `0x${string}` | null, dex = '') {
  const [snapshot, setSnapshot] = useState<AccountSnapshot | null>(null)
  const [error, setError] = useState('')
  const reload = useRef<() => Promise<void>>(async () => {})
  const refresh = useCallback(() => reload.current(), [])
  useEffect(() => {
    if (!address) {
      setSnapshot(null)
      setError('')
      return
    }
    const owner = address
    let active = true
    let inFlight: Promise<void> | null = null
    let refreshAgain = false
    let latestState: AccountSnapshot['state'] | null = null
    const stateFrame = createFrameBatch('account', () => {
      if (!active || !latestState) return
      const state = latestState
      setSnapshot((previous) =>
        previous?.address === owner &&
        previous.dex === dex &&
        state.time >= previous.state.time
          ? { ...previous, state }
          : previous,
      )
    })
    const transport = new WebSocketTransport({ isTestnet: true, url: WS_URL })
    const sub = new SubscriptionClient({ transport })
    function query(): Promise<void> {
      if (inFlight) {
        refreshAgain = true
        return inFlight
      }
      inFlight = (async () => {
        do {
          refreshAgain = false
          try {
            const data = await loadAccount(owner, dex)
            if (active) {
              setSnapshot({
                ...data,
                state:
                  latestState && latestState.time > data.state.time
                    ? latestState
                    : data.state,
              })
              setError('')
            }
          } catch (e) {
            if (active) setError(errorText(e))
          }
        } while (active && refreshAgain)
      })().finally(() => {
        inFlight = null
      })
      return inFlight
    }
    reload.current = query
    void query()
    const onError = (e: unknown) => {
      if (active) setError(errorText(e))
    }
    transport.socket.addEventListener('open', () => {
      void query()
    })
    void sub
      .clearinghouseState(
        { user: address, dex },
        (event) => {
          if (
            !active ||
            event.user.toLowerCase() !== owner.toLowerCase() ||
            event.dex !== dex ||
            event.clearinghouseState.time < (latestState?.time ?? 0)
          )
            return
          latestState = event.clearinghouseState
          performanceMetrics.input('account', 1, latestState.time)
          stateFrame.schedule()
        },
        { onError },
      )
      .catch(onError)
    void sub.orderUpdates({ user: address }, query, { onError }).catch(onError)
    void sub.userFills({ user: address }, query, { onError }).catch(onError)
    const timer = setInterval(query, 15000)
    return () => {
      active = false
      stateFrame.cancel()
      reload.current = async () => {}
      clearInterval(timer)
      transport.close()
    }
  }, [address, dex])
  return {
    snapshot:
      snapshot?.address.toLowerCase() === address?.toLowerCase() &&
      snapshot?.dex === dex
        ? snapshot
        : null,
    error,
    refresh,
  }
}
