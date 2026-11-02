import { tv } from '@heroui/react'
import type { VariantProps } from 'tailwind-variants'

// Select 组件样式
export const select = tv({
  slots: {
    baseStyle: 'group flex flex-col',
    labelStyle: 'text-1 mb-1 font-semibold',
    triggerStyle: [
      'w-full bg-transparent outline-none focus-visible:outline-none',
      'placeholder:text-4 group-data-[has-value=true]:text-1 caret-brand-1 font-semibold placeholder:font-semibold',
      'tap-highlight-transparent relative inline-flex w-full flex-row items-center !rounded-[8px] px-3 py-2',
      'box-border border border-transparent',
      'transition-colors',
      'h-auto min-h-0 justify-between',
    ],
    valueStyle: 'text-2 text-body-s',
    selectorStyle: 'text-2 static h-3 w-3',
    spinnerStyle: 'text-brand-1',
    listboxStyle: 'bg-3 rounded px-0 py-2',
    listboxWrapperStyle: 'max-h-[300px]',
    popoverContentStyle: 'rounded p-0',
    itemStyle: [
      'rounded-none',
      'text-3 font-semibold',
      'aria-[selected=true]:data-[hover=true]:!bg-hover-n',
      'aria-[selected=false]:data-[hover=true]:!text-3',
      'aria-[selected=false]:data-[hover=true]:!bg-cc-3',
      'data-[hover=true]:!outline-none',
      'hover:!outline-none',
      'data-[selected=true]:!text-1',
      'data-[selected=true]:hover:!text-1',
      'flex w-full cursor-pointer items-center px-3 py-2',
      'focus:!bg-hover-n focus:!text-3 !outline-none',
      'data-[pressed=true]:!bg-press-n',
    ],
    innerWrapperStyle: 'h-auto min-h-0 w-auto',
  },
  variants: {
    variant: {
      flat: {
        triggerStyle: [
          'p-0',
          'data-[hover=true]:bg-transparent',
          'shadow-none',
          'border border-transparent',
        ],
      },
      bordered: {
        triggerStyle: [
          'border-cc-1 rounded-lg border',
          'data-[hover=true]:border-brand-1',
          'data-[focus=true]:border-brand-1',
          'bg-transparent data-[focus=true]:bg-transparent data-[hover=true]:bg-transparent',
        ],
      },
    },
  },
  defaultVariants: {
    variant: 'flat',
  },
})

// Dropdown 样式 (用于 FlatSelect)
export const dropdownStyle = tv({
  slots: {
    baseStyle: 'w-30 inline-flex p-0',
    triggerStyle: [
      'cursor-pointer',
      'tap-highlight-transparent',
      'transition-opacity',
      'data-[disabled=true]:cursor-default',
      'data-[disabled=true]:opacity-50',
      'group',
      'text-2 text-body-s',
      'flex items-center gap-1',
    ],
    menuStyle: ['bg-3', 'rounded', 'py-1', 'px-0'],
    // contentStyle: 'shadow-z200 border-cc-2 min-w-0 rounded border p-0',
    contentStyle: 'min-w-20 p-0 shadow-none',
    itemStyle: [
      'text-1',
      'cursor-pointer',
      'px-3',
      'py-1',
      'rounded-none',
      'transition-colors',
      'data-[hover=true]:bg-hover-n',
      'outline-none',
      'font-semibold',
      'flex',
      'items-center',
      'gap-2',
      'text-3',
      '[&[data-selected=true]]:text-1 [&[data-selected=true]]:focus:text-1',
      '[&.focus:not([data-selected])]:bg-hover-n',
      '[&:focus:not([data-selected])]:bg-hover-n',
      '[&:focus[data-selected]]:bg-transparent',
      '[&[data-selected=true]]:bg-transparent',
      '[&[data-selected=true]]:data-[hover=true]:bg-hover-n',
      '[&:not([data-selected=true])]:data-[hover=true]:bg-hover-n',
      '[&[data-selectable=true]]:focus:bg-hover-n',
    ],
    iconStyle: [
      'text-1',
      'transition-transform duration-200',
      '[.group[aria-expanded="true"]_&]:rotate-180',
    ],
  },
})

export type SelectVariantProps = VariantProps<typeof select>
export type DropdownStyleVariantProps = VariantProps<typeof dropdownStyle>
