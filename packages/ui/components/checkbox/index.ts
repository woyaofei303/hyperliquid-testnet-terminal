'use client'

import { extendVariants, Checkbox as OriginCheckbox } from '@heroui/react'

export const Checkbox = extendVariants(OriginCheckbox, {
  variants: {
    color: {
      primary: {
        wrapper: [
          'relative inline-flex items-center justify-center shrink-0 overflow-hidden',
          'mr-1 w-4 h-4 rounded-sm',

          // 边框
          'before:absolute before:inset-0 before:rounded-sm',
          'before:border before:border-cc-1',

          // 关闭自身和 ::after 的过渡
          '!transition-none',
          'after:!transition-none after:!duration-0 after:!ease-linear',

          // 默认未选中状态：透明背景
          "after:content-[''] after:absolute after:inset-0 after:rounded-sm",
          'after:bg-transparent after:opacity-0',

          // 选中时的视觉：有背景、不透明
          // 利用 data-selected（HeroUI 默认就会挂）来区分状态
          'group-data-[selected=true]:after:bg-primary',
          'group-data-[selected=true]:after:opacity-100',
        ].join(' '),

        // 勾勾图标本身
        icon: 'w-3 h-3 !transition-none',
      },
    },
  },
  defaultVariants: {
    color: 'primary',
    size: 'sm',
  },
})
