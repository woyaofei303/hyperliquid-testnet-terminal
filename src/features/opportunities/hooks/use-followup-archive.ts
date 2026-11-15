'use client'

import { useCallback, useEffect, useState } from 'react'
import { ARCHIVE_KEY, readArchive } from '../lib/archive'
import type { Followup } from '../lib/followups'

export function useFollowupArchive() {
  const [followups, setFollowups] = useState<Followup[]>([])
  const [cooldownUntil, setCooldownUntil] = useState(0)
  const [owned, setOwned] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [notice, setNotice] = useState<string | null>('正在读取本机存档…')
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    const abort = new AbortController()
    let release: (() => void) | undefined
    const restore = () => {
      try {
        const data = readArchive(localStorage.getItem(ARCHIVE_KEY), Date.now())
        setFollowups(data.followups)
        setCooldownUntil(data.cooldownUntil)
        setLoaded(true)
        setLoadError(null)
      } catch (error) {
        setLoaded(false)
        setLoadError(
          error instanceof Error
            ? error.message
            : '无法读取本机存档，未覆盖原数据',
        )
      }
    }
    if (!navigator.locks) {
      restore()
      setNotice(
        '浏览器不支持采集锁，当前只读存档；请使用支持 Web Locks 的浏览器',
      )
      return
    }
    restore()
    setNotice('等待读写权限，本页只读存档；另一观察页关闭后会自动接续采集')
    void navigator.locks
      .request(ARCHIVE_KEY, { signal: abort.signal }, async () => {
        if (!alive) return
        restore()
        setOwned(true)
        setNotice(null)
        await new Promise<void>((resolve) => {
          release = resolve
        })
      })
      .catch(() => {
        if (alive) setNotice('无法取得采集锁，采集和自动保存已暂停；请刷新重试')
      })
    return () => {
      alive = false
      abort.abort()
      release?.()
    }
  }, [])

  useEffect(() => {
    if (owned) return
    const receive = (event: StorageEvent) => {
      if (event.storageArea !== localStorage || event.key !== ARCHIVE_KEY)
        return
      try {
        const data = readArchive(event.newValue, Date.now())
        setFollowups(data.followups)
        setCooldownUntil(data.cooldownUntil)
        setLoadError(null)
        setLoaded(true)
      } catch {
        setLoadError('另一页写入的存档无效，已保留当前记录')
      }
    }
    window.addEventListener('storage', receive)
    return () => window.removeEventListener('storage', receive)
  }, [owned])

  const save = useCallback(() => {
    if (!owned || !loaded) return
    try {
      localStorage.setItem(
        ARCHIVE_KEY,
        JSON.stringify({ version: 1, followups, cooldownUntil }),
      )
      setSaveError(null)
    } catch {
      setSaveError('自动保存失败，新数据暂只在本页；请导出证据或重试保存')
    }
  }, [owned, loaded, followups, cooldownUntil])
  useEffect(() => {
    save()
  }, [save])

  const clearArchive = () => {
    if (!owned) return false
    try {
      localStorage.setItem(
        ARCHIVE_KEY,
        JSON.stringify({ version: 1, followups: [], cooldownUntil }),
      )
      setFollowups([])
      setLoadError(null)
      setSaveError(null)
      setLoaded(true)
      return true
    } catch {
      setSaveError('无法清空本机存档，原记录未改变')
      return false
    }
  }
  return {
    followups,
    setFollowups,
    cooldownUntil,
    setCooldownUntil,
    canCollect: owned && loaded,
    owned,
    archiveMessage: loadError ?? saveError ?? notice,
    saveFailed: Boolean(saveError),
    save,
    clearArchive,
  }
}
