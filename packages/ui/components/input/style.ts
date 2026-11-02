import { tv } from '@heroui/react'

type SlotFn = (slotProps?: Record<string, unknown>) => string

type InputSlots = {
  baseStyle: SlotFn
  inputStyle: SlotFn
  labelStyle: SlotFn
  mainWrapperStyle: SlotFn
  inputWrapperStyle: SlotFn
  endContentWrapperStyle: SlotFn
  helperWrapperStyle: SlotFn
  innerWrapperStyle: SlotFn
  descriptionStyle: SlotFn
  errorMessageStyle: SlotFn
  clearButtonStyle: SlotFn
}

type InputStylesFactory = (props?: Record<string, unknown>) => InputSlots

export const input: InputStylesFactory = tv({
  slots: {
    baseStyle: 'group flex flex-col',
    inputStyle: [
      'min-w-20',
      'flex-1 bg-transparent !outline-none focus-visible:outline-none',
      'placeholder:text-4 caret-brand-1',
      'group-data-[has-value=true]:text-1',
      // 去掉 Chrome / Safari 自动填充的默认黄/蓝底，并与主题文字色一致
      '[&:-webkit-autofill]:[-webkit-text-fill-color:rgb(var(--fx-text-1)_/_1)]',
      '[&:-webkit-autofill]:[caret-color:rgb(var(--fx-text-7)_/_1)]',
    ],
    labelStyle: ['!text-2 text-body-s'],
    mainWrapperStyle: ['flex flex-col gap-y-1'],
    inputWrapperStyle: [
      'tap-highlight-transparent rounded-m relative box-border inline-flex w-full flex-row items-center px-3 py-2.5',
      // 'before:absolute before:inset-0 before:rounded before:transition-colors',
      'border border-transparent', // 添加透明边框
      'group-data-[focus-within=true]:!bg-cc-3',
    ],
    endContentWrapperStyle: ['z-10'],
    helperWrapperStyle:
      'relative hidden flex-col group-data-[has-helper=true]:flex',
    innerWrapperStyle:
      'box-border inline-flex h-full w-full items-center gap-x-3',
    descriptionStyle: '!text-p500 text-body-s mt-1',
    errorMessageStyle: '!text-sem-r text-body-s text-right',
    clearButtonStyle: [
      'z-10',
      'w-[15px]',
      'h-[15px]',
      // 'absolute',
      'text-4',
      // 'right-4.5',
      // 'p-2',
      'rtl:right-auto',
      'rtl:left-3',
      'appearance-none',
      'outline-none',
      'select-none',
      'opacity-0',
      'pointer-events-none',
      // 'hover:!opacity-100',
      // '!cursor-pointer',
      'active:!opacity-70',
      'rounded-full',
    ],
  },
  variants: {
    variant: {
      faded: {
        inputWrapperStyle: [
          'group/fx-faded',
          'bg-cc-3 data-[hover=true]:bg-cc-2',
          'border border-transparent',
          'group-data-[focus-within=true]:bg-2',
          'group-data-[focus-within=true]:border-brand-1',
        ],
        inputStyle: [
          // 与 faded 输入区底色一致；hover 时外层为 bg-cc-2，自动填充 mask 需同步
          '[&:-webkit-autofill]:[-webkit-box-shadow:inset_0_0_0_1000px_rgb(var(--fx-cc-3)_/_1)]',
          '[&:-webkit-autofill:hover]:[-webkit-box-shadow:inset_0_0_0_1000px_rgb(var(--fx-cc-3)_/_1)]',
          '[&:-webkit-autofill:focus]:[-webkit-box-shadow:inset_0_0_0_1000px_rgb(var(--fx-cc-3)_/_1)]',
          '[&:-webkit-autofill:active]:[-webkit-box-shadow:inset_0_0_0_1000px_rgb(var(--fx-cc-3)_/_1)]',
          'group-hover/fx-faded:[&:-webkit-autofill]:[-webkit-box-shadow:inset_0_0_0_1000px_rgb(var(--fx-cc-2)_/_1)]',
          'group-hover/fx-faded:[&:-webkit-autofill:hover]:[-webkit-box-shadow:inset_0_0_0_1000px_rgb(var(--fx-cc-2)_/_1)]',
          'group-hover/fx-faded:[&:-webkit-autofill:focus]:[-webkit-box-shadow:inset_0_0_0_1000px_rgb(var(--fx-cc-2)_/_1)]',
          'group-hover/fx-faded:[&:-webkit-autofill:active]:[-webkit-box-shadow:inset_0_0_0_1000px_rgb(var(--fx-cc-2)_/_1)]',
        ],
      },
      bordered: {
        inputWrapperStyle: [
          'border-cc-2 border', // 默认边框颜色
          'data-[hover=true]:border-brand-1', // hover 时改变伪元素边框颜色
          'group-data-[focus-within=true]:border-brand-1', // 激活时改变伪元素边框颜色
          'bg-transparent data-[hover=true]:bg-transparent group-data-[focus-within=true]:bg-transparent',
        ],
        inputStyle: [
          // 透明 wrapper 下透出页面主背景 bg-2（明暗主题随 CSS 变量切换）
          '[&:-webkit-autofill]:[-webkit-box-shadow:inset_0_0_0_1000px_rgb(var(--fx-bg-2)_/_1)]',
          '[&:-webkit-autofill:hover]:[-webkit-box-shadow:inset_0_0_0_1000px_rgb(var(--fx-bg-2)_/_1)]',
          '[&:-webkit-autofill:focus]:[-webkit-box-shadow:inset_0_0_0_1000px_rgb(var(--fx-bg-2)_/_1)]',
          '[&:-webkit-autofill:active]:[-webkit-box-shadow:inset_0_0_0_1000px_rgb(var(--fx-bg-2)_/_1)]',
        ],
      },
    },
    size: {
      sm: {
        inputWrapperStyle: 'h-10',
        inputStyle: 'text-body-regular',
      },
      md: {
        inputWrapperStyle: 'h-12',
        inputStyle: 'text-body-regular',
      },
      lg: {
        inputWrapperStyle: 'h-14',
        inputStyle: 'text-body-regular',
      },
    },
    fullWidth: {
      true: 'w-full',
    },
    isInvalid: {
      true: {
        inputWrapperStyle: 'border-sem-r hover:border-sem-r', // 使用 before 伪元素添加红色边框
        inputStyle: 'caret-sem-r', // Set caret color to red when invalid
      },
    },
    isDisabled: {
      true: {
        baseStyle: '',
        inputWrapperStyle: 'bg-cc-2 text-4 pointer-events-none',
        // labelStyle: 'pointer-events-none',
        inputStyle:
          'text-4 group-data-[has-value=true]:text-4 pointer-events-none',
      },
    },
    isClearable: {
      true: {
        clearButtonStyle: [
          'peer-data-[filled=true]:block peer-data-[filled=true]:opacity-70',
          'group-data-[has-value=true]:pointer-events-auto group-data-[has-value=true]:cursor-pointer group-data-[has-value=true]:opacity-100',
        ],
      },
    },
  },
  defaultVariants: {
    variant: 'bordered',
    size: 'sm',
    fullWidth: true,
    isDisabled: false,
  },
  compoundVariants: [
    {
      isInvalid: true,
      variant: 'bordered',
      class: {
        inputWrapperStyle:
          'border-sem-r group-data-[focus-within=true]:border-sem-r',
      },
    },
    {
      isInvalid: true,
      variant: 'faded',
      class: {
        inputWrapperStyle:
          'border-sem-r group-data-[focus-within=true]:border-sem-r',
      },
    },
    {
      isDisabled: true,
      variant: 'bordered',
      class: {
        inputWrapperStyle:
          'border-cc-1 group-data-[focus-within=true]:border-cc-1',
      },
    },
  ],
}) as unknown as InputStylesFactory

export type InputVariants = {
  variant?: 'bordered' | 'faded'
  size?: 'sm' | 'md' | 'lg'
  fullWidth?: boolean
  isInvalid?: boolean
  isDisabled?: boolean
  isClearable?: boolean
}
