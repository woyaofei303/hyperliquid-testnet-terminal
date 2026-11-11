'use client'

import { HeroUIProvider } from '@heroui/react'
import { useEffect } from 'react'
import { restoreLocale, useLocale } from '@/i18n'
import { startPerformanceMonitor } from '@/shared/lib/performance'
import { Notifications } from '../shared/components/notifications'
export function Providers({ children }: { children: React.ReactNode }) {
  useLocale()

  useEffect(startPerformanceMonitor, [])
  useEffect(restoreLocale, [])
  return (
    <HeroUIProvider disableAnimation skipFramerMotionAnimations={false}>
      {children}
      <Notifications />
    </HeroUIProvider>
  )
}
