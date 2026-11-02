'use client'

import { classNames } from '@fameex/utils'
import type { ButtonProps as OriginButtonProps } from '@heroui/react'
import { Button as ButtonPrimitive, extendVariants } from '@heroui/react'
import { Spinner } from '../spinner'

const Base = extendVariants(ButtonPrimitive, {
  variants: {
    color: {
      primary: '',
      secondary: '',
      default: '',
      danger: '',
      success: '',
    },
    isDisabled: {
      true: 'cursor-not-allowed opacity-100 pointer-events-auto',
    },
    isLoading: {
      true: 'opacity-100 pointer-events-auto',
    },
    size: {
      lg: 'h-10 !text-subtitle font-semibold',
      md: 'text-body-regular h-8 font-semibold',
      sm: 'text-body-regular h-7 font-normal',
    },
    variant: {
      solid: '',
      bordered: 'border-1 bg-transparent',
      light: 'bg-transparent',
    },
    isIconOnly: {
      true: 'min-w-0',
    },
    radius: {
      none: 'rounded-none',
      sm: 'rounded',
      md: 'rounded-m',
      lg: 'rounded-lg',
      full: 'rounded-[99px]',
    },
  },

  defaultVariants: {
    radius: 'md',
    color: 'primary',
    height: 'lg',
    variant: 'solid',
    isIconOnly: false,
  },
  compoundVariants: [
    //  solid disabled
    {
      variant: 'solid',
      color: 'primary',
      class: 'bg-brand-1 !text-6 hover:bg-hover-brand-1 font-bold',
    },
    {
      variant: 'solid',
      color: 'secondary',
      class: 'bg-b !text-7 hover:bg-hover-b2',
    },
    {
      variant: 'solid',
      color: 'default',
      class: 'bg-cc-2 !text-1 hover:bg-hover-n',
    },
    {
      variant: 'solid',
      color: 'success',
      class: 'bg-sem-g !text-6 hover:bg-hover-g',
    },
    {
      variant: 'solid',
      color: 'danger',
      class: 'bg-sem-r !text-white hover:bg-hover-r',
    },
    {
      variant: 'solid',
      isDisabled: true,
      class: '!text-4 bg-cc-2 opacity-100 hover:bg-cc-2',
    },
    {
      variant: 'solid',
      isLoading: true,
      class: 'opacity-100 pointer-events-auto',
    },
    //   bordered disabled
    {
      variant: 'bordered',
      color: 'primary',
      class: 'border-brand-1 text-brand-1 hover:bg-hover-brand-1/[0.12]',
    },
    {
      variant: 'bordered',
      color: 'default',
      class: 'border-text-4 !text-2 hover:bg-hover-n',
    },
    {
      variant: 'bordered',
      color: 'success',
      class: 'border-sem-g text-sem-g hover:bg-hover-n',
    },
    {
      variant: 'bordered',
      color: 'danger',
      class: 'border-sem-r text-sem-r hover:bg-hover-n',
    },
    {
      variant: 'bordered',
      color: 'primary',
      isDisabled: true,
      class: 'border-text-4 !text-4',
    },
    //   light disabled
    {
      variant: 'light',
      color: 'primary',
      class: 'text-brand-1 hover:bg-hover-b2',
    },
    {
      variant: 'light',
      color: 'default',
      class: '!text-2 hover:bg-hover-n',
    },
    {
      variant: 'light',
      color: 'success',
      class: 'text-sem-g hover:bg-hover-n',
    },
    {
      variant: 'light',
      color: 'danger',
      class: 'text-sem-r hover:bg-hover-n',
    },
    {
      variant: 'light',
      isDisabled: true,
      class: '!text-4',
    },
  ],
})

export const Button = ({
  type = 'button',
  color = 'primary',
  variant = 'solid',
  ref,
  className,
  ...rest
}: OriginButtonProps) => {
  return (
    <Base
      spinner={<Spinner />}
      ref={ref}
      type={type}
      variant={variant}
      color={color}
      // 原生 dialog 转移焦点时组件标记可能误报，以浏览器的键盘焦点判断为准。
      className={classNames('[&:not(:focus-visible)]:outline-none', className)}
      {...rest}
    />
  )
}

Button.displayName = 'Button'
