import { customConfig } from '@fameex/utils'
import { tv } from '@heroui/react'

export const slider = tv(
  {
    slots: {
      baseStyle: 'group flex flex-col',
      markStyle: 'text-1 z-[1] !mt-[3px] !opacity-0 last:-translate-x-[100%]',
      fillerStyle: 'bg-text-2',
      trackStyle:
        'bg-cc-2 border-s-text-2 top-[1px] h-0.5 rounded data-[thumb-hidden=false]:border-x-[6px]',
      thumbStyle:
        'border-text-2 z-10 h-[12px] w-[12px] rounded-full border-[2px] bg-white before:h-[12px] before:w-[12px] after:hidden data-[focus-visible=true]:outline-0',
    },
    variants: {
      size: {
        sm: {
          thumbStyle: 'h-[12px] w-[12px]',
        },
        md: {
          thumbStyle: 'h-[14px] w-[14px]',
        },
        lg: {
          thumbStyle: 'border-text-1 h-[14px] w-[14px] border-[3px]',
          trackStyle: 'bg-cc-1 border-text-1 top-[0px] h-1',
          fillerStyle: 'bg-text-1',
        },
      },
    },
    defaultVariants: {
      size: 'sm',
    },
  },
  {
    twMergeConfig: customConfig,
  },
)
