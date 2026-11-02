'use client'

import { cn } from '@fameex/utils'
import {
  Popover,
  PopoverContent,
  type PopoverProps,
  PopoverTrigger,
} from '@heroui/react'
import { useCallback } from 'react'
import { useSmartPopoverState } from './useSmartPopoverState'

export interface SmartPopoverProps
  extends Omit<
    PopoverProps,
    'isOpen' | 'onOpenChange' | 'children' | 'content'
  > {
  children: React.ReactNode | ((props: { isOpen: boolean }) => React.ReactNode)
  content:
    | React.ReactNode
    | (({ closePopover }: { closePopover: () => void }) => React.ReactNode)
  placement?: PopoverProps['placement']
  className?: string
  contentClassName?: string
  disabled?: boolean
  onContentClick?: () => void
  closeOnContentClick?: boolean
  delay?: number
  trigger?: 'click' | 'hover'
  triggerLabel?: string
  triggerClassName?: string
}

export const SmartPopover = ({
  children,
  content,
  placement = 'bottom',
  className,
  contentClassName,
  disabled = false,
  onContentClick,
  closeOnContentClick = true,
  delay = 250,
  trigger = 'click',
  triggerClassName,
  triggerLabel,
  classNames,
  showArrow = false,
  ...props
}: SmartPopoverProps) => {
  const {
    isOpen,
    handleMouseEnterTrigger,
    handleMouseLeaveTrigger,
    handleMouseEnterContent,
    handleMouseLeaveContent,
    closePopover,
    openPopover,
  } = useSmartPopoverState(delay)

  const handleContentClickInternal = useCallback(() => {
    if (onContentClick) {
      onContentClick()
    }
    if (closeOnContentClick) {
      closePopover()
    }
  }, [onContentClick, closeOnContentClick, closePopover])

  if (disabled) {
    return <>{children}</>
  }

  return (
    <Popover
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (open) openPopover()
        else closePopover()
      }}
      placement={placement}
      showArrow={showArrow}
      className={className}
      {...props}
      classNames={{
        ...classNames,
        trigger: cn(
          'aria-expanded:scale-100 aria-expanded:opacity-100',
          classNames?.trigger,
        ),
      }}
    >
      <PopoverTrigger>
        <button
          type="button"
          aria-label={triggerLabel}
          className={triggerClassName || 'flex cursor-pointer'}
          {...(trigger === 'hover'
            ? {
                onMouseEnter: handleMouseEnterTrigger,
                onMouseLeave: handleMouseLeaveTrigger,
              }
            : { onClick: isOpen ? closePopover : openPopover })}
        >
          {typeof children === 'function' ? children({ isOpen }) : children}
        </button>
      </PopoverTrigger>
      <PopoverContent
        className={contentClassName}
        onMouseEnter={trigger === 'hover' ? handleMouseEnterContent : undefined}
        onMouseLeave={trigger === 'hover' ? handleMouseLeaveContent : undefined}
        onClick={handleContentClickInternal}
      >
        {typeof content === 'function' ? content({ closePopover }) : content}
      </PopoverContent>
    </Popover>
  )
}
