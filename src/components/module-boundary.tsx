'use client'

import { catchError } from 'next/error'
import { ErrorFallback } from './error-fallback'

export const ModuleBoundary = catchError(
  ({ name, className }: { name: string; className?: string }, { reset }) => (
    <ErrorFallback name={name} onRetry={reset} className={className} />
  ),
)
