'use client'
import { HeroUIProvider } from '@heroui/react'
import { useEffect } from 'react'
import { startPerformanceMonitor } from '@/lib/performance'
import { Notifications } from './notifications'
export function Providers({ children }: { children: React.ReactNode }) {
  useEffect(startPerformanceMonitor, [])
  return (
    <HeroUIProvider disableAnimation skipFramerMotionAnimations={false}>
      {children}
      <Notifications />
    </HeroUIProvider>
  )
}
