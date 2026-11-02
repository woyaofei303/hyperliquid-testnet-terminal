'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

export function useSmartPopoverState(delay = 250) {
  const [isOpen, setIsOpen] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    },
    [],
  )
  const isHoveringRef = useRef({ trigger: false, content: false })

  const open = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    setIsOpen(true)
  }, [])

  const close = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    setIsOpen(false)
  }, [])

  const handleMouseEnterTrigger = useCallback(() => {
    isHoveringRef.current.trigger = true
    open()
  }, [open])

  const handleMouseLeaveTrigger = useCallback(() => {
    isHoveringRef.current.trigger = false
    timerRef.current = setTimeout(() => {
      if (!isHoveringRef.current.content) close()
    }, delay)
  }, [close, delay])

  const handleMouseEnterContent = useCallback(() => {
    isHoveringRef.current.content = true
    open()
  }, [open])

  const handleMouseLeaveContent = useCallback(() => {
    isHoveringRef.current.content = false
    timerRef.current = setTimeout(() => {
      if (!isHoveringRef.current.trigger) close()
    }, delay)
  }, [close, delay])

  return {
    isOpen,
    handleMouseEnterTrigger,
    handleMouseLeaveTrigger,
    handleMouseEnterContent,
    handleMouseLeaveContent,
    closePopover: close,
    openPopover: open,
  }
}
