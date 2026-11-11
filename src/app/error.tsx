'use client'

import { ErrorFallback } from '@/shared/components/error-fallback'

export default function PageError({
  retry,
}: {
  error: unknown
  retry: () => void
}) {
  return <ErrorFallback name="交易页面" onRetry={retry} className="h-dvh" />
}
