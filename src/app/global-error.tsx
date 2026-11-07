'use client'

import './globals.css'
import { ErrorFallback } from '@/components/error-fallback'

export default function GlobalError({
  retry,
}: {
  error: unknown
  retry: () => void
}) {
  return (
    <html lang="zh-CN" className="dark">
      <body>
        <title>页面异常 · Hyperliquid</title>
        <ErrorFallback name="应用" onRetry={retry} className="h-dvh" />
      </body>
    </html>
  )
}
