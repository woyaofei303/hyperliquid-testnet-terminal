'use client'
import { Tooltip as BaseTooltip, type TooltipProps } from '@heroui/react'

// FameEX HerouiTooltip：延迟显示、浅色正文、深色浮层，浮层不截获鼠标。
export function Tooltip(props: TooltipProps) {
  return (
    <BaseTooltip
      delay={250}
      closeDelay={0}
      offset={7}
      placement="top"
      showArrow={false}
      classNames={{
        base: 'z-[1200] pointer-events-none',
        content:
          'max-w-xs whitespace-pre-wrap rounded-md border border-edge bg-surface px-3 py-2 text-xs leading-5 text-ink shadow-xl',
      }}
      {...props}
    />
  )
}
