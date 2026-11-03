'use client'

import { useSyncExternalStore } from 'react'

// 沿用 FameEX storage 的 get/set/subscribe/useValue，同页通知与跨页 storage 事件共用一个快照。
export function createStoredBoolean(key: string, defaultValue: boolean) {
  const listeners = new Set<() => void>()
  const get = () => {
    try {
      const raw = window.localStorage.getItem(key)
      return raw === 'true' ? true : raw === 'false' ? false : defaultValue
    } catch {
      return defaultValue
    }
  }
  const notify = () => {
    for (const listener of listeners) listener()
  }
  const subscribe = (listener: () => void) => {
    listeners.add(listener)
    const onStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === key) listener()
    }
    window.addEventListener('storage', onStorage)
    return () => {
      listeners.delete(listener)
      window.removeEventListener('storage', onStorage)
    }
  }
  return {
    key,
    get,
    set(value: boolean) {
      if (get() === value) return
      try {
        window.localStorage.setItem(key, String(value))
      } catch {
        return
      }
      notify()
    },
    subscribe,
    useValue() {
      return useSyncExternalStore(subscribe, get, () => defaultValue)
    },
  }
}
