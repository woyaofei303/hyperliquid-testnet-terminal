'use client'

import { useEffect, useRef, useState } from 'react'

export function useBookRows() {
  const container = useRef<HTMLDivElement>(null)
  const [count, setCount] = useState(5)
  useEffect(() => {
    const element = container.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => {
      setCount(Math.max(1, Math.floor(entry.contentRect.height / 24)))
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  return { container, count }
}
