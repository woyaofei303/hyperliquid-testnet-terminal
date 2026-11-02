'use client'

import { extendVariants, Tabs as OriginTabs } from '@heroui/react'

export const Tabs = extendVariants(OriginTabs, {
  variants: {
    variant: {
      underlined: {
        tab: 'text-3 text-body-regular h-7 max-w-fit p-0',
        tabList: 'border-divider relative w-full gap-4 rounded-none p-0',
        // 初始渲染阶段让指示条宽度为 0，
        // 之后 HeroUI 会通过 inline style 写入真实宽度
        cursor: 'bg-text-1 w-0',
        tabContent:
          'group-data-[selected=true]:text-1 group-data-[selected=true]:font-semibold font-normal',
      },
      solid: {
        tab: 'text-3 text-body-regular h-7 max-w-fit p-0 group-data-[selected=true]:bg-transparent',
        tabList:
          'bg-transparent border-divider relative w-full gap-4 rounded-none p-0',
        // cursor: 'bg-text-1 w-0',
        cursor: 'bg-transparent shadow-none',
        tabContent:
          'px-2 py-[6px] group-data-[selected=true]:text-1 group-data-[selected=true]:font-semibold font-normal text-subtitle',
      },
    },
  },
  defaultVariants: {
    variant: 'underlined',
    size: 'md',
  },
})
