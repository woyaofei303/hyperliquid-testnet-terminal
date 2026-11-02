'use client'
import { useSyncExternalStore } from 'react'
import { en } from './en'
export type Locale = 'zh-CN' | 'en-US'
let locale: Locale = 'zh-CN'
const listeners = new Set<() => void>()
const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
export function setLocale(next: Locale) {
  locale = next
  document.documentElement.lang = next
  try {
    localStorage.setItem('terminal-locale', next)
  } catch {
    /* 禁用存储时仍可切换当前页。 */
  }
  listeners.forEach((listener) => {
    listener()
  })
}
export function restoreLocale() {
  try {
    if (localStorage.getItem('terminal-locale') === 'en-US') setLocale('en-US')
  } catch {
    /* 默认简体中文。 */
  }
}
export function useLocale() {
  return useSyncExternalStore(
    subscribe,
    () => locale,
    () => 'zh-CN' as Locale,
  )
}
export function t(text: string | undefined) {
  if (text == null) return ''
  if (locale !== 'en-US') return text
  if (en[text] !== undefined) return en[text]
  const translated = en[text.trim()]
  return translated !== undefined ? text.replace(text.trim(), translated) : text
}
