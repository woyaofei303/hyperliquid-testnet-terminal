'use client'

import { classNames } from '@fameex/utils'
import type { InputProps as BaseInputProps } from '@heroui/react'
import { useInput } from '@heroui/react'
import { CloseFilledIcon } from '@heroui/shared-icons'
import type {
  ChangeEventHandler,
  FocusEventHandler,
  PropsWithRef,
  ReactNode,
  Ref,
} from 'react'
import { useMemo } from 'react'
import { input as inputVariants } from './style'

const {
  inputStyle,
  labelStyle,
  mainWrapperStyle,
  baseStyle,
  innerWrapperStyle,
  descriptionStyle,
  errorMessageStyle,
  helperWrapperStyle,
  inputWrapperStyle,
  clearButtonStyle,
  endContentWrapperStyle,
} = inputVariants()

export type InputProps = {
  ref?: Ref<HTMLInputElement | HTMLTextAreaElement>
  /**
   * The label of the input
   */
  label?: ReactNode
  /**
   * The placeholder of the input
   */
  placeholder?: string
  /**
   * The value of the input
   */
  value?: string
  /**
   * The name of the input
   */
  name?: string
  /**
   * The value of the input
   */
  onChange?: (value: string) => void
  /**
   * The change event handler of the input
   */
  onChangeHandler?: ChangeEventHandler<HTMLInputElement>
  onBlur?: FocusEventHandler<HTMLInputElement>
  onFocus?: FocusEventHandler<HTMLInputElement>
  /**
   * The click event handler of the input
   */
  onClick?: () => void
  onClear?: () => void
  /**
   * The validation of the input
   * @example isInvalid={true} then the input will be red and visible error message
   */
  isInvalid?: boolean
  /**
   * The start content of the input
   */
  startContent?: React.ReactNode
  /**
   * The end content of the input
   */
  endContent?: React.ReactNode
  /**
   * The size of the input
   * @default md
   */
  size?: 'md' | 'lg' | 'sm'
  /**
   * The error message of the input, if the input is invalid will be visible
   */
  errorMessage?: string
  /**
   * The description of the input, if the input is invalid will be invisible
   */
  description?: string
  /**
   * The helper text of the input
   */
  isDisabled?: boolean
  /**
   * The type of the input
   * @default text
   */
  type?: 'email' | 'text' | 'password' | 'number' | 'search' | 'tel'

  /**
   * The input has start content
   */
  hasStartContent?: boolean
  /**
   * Value minimum length
   */
  minLength?: number
  /**
   * Value maximum length
   */
  maxLength?: number
  /**
   * The variant of the input
   */
  variant?: 'bordered' | 'faded'
  /**
   * The class name of the base container
   */
  className?: string
  /**
   * The class name of input
   */
  inputClassName?: string
  /**
   * The class name of input
   */
  inputWrapperClassName?: string
  /**
   * The class name of the error message
   */
  errorClassName?: string
  /**
   * The input is read only
   * @default false
   */
  readOnly?: boolean

  isClearable?: boolean
} & Partial<
  Pick<
    BaseInputProps,
    | 'onKeyDown'
    | 'autoComplete'
    | 'id'
    | 'inputMode'
    | 'min'
    | 'max'
    | 'step'
    | 'aria-label'
  >
>

export const Input = ({
  onBlur,
  onFocus,
  ref,
  ...props
}: PropsWithRef<InputProps>) => {
  const {
    size = 'sm',
    isDisabled,
    isClearable,
    onChange,
    onChangeHandler,
    variant = 'faded',
    className,
    inputClassName,
    errorClassName,
    inputWrapperClassName,
  } = props

  const {
    Component,
    label,
    description,
    // isClearable,
    startContent,
    endContent,
    // labelPlacement,
    hasHelper,
    // shouldLabelBeOutside,
    errorMessage,
    isInvalid,
    getBaseProps,
    getLabelProps,
    getInputProps,
    getInnerWrapperProps,
    getInputWrapperProps,
    getMainWrapperProps,
    getHelperWrapperProps,
    getDescriptionProps,
    getErrorMessageProps,
    getClearButtonProps,
  } = useInput({
    ...props,
    labelPlacement: 'outside',
    placeholder: props.placeholder || ' ',
    radius: 'sm',
    // isClearable: isClearable,
    type: props.type || 'text',
    isDisabled: props.isDisabled || false,
    onValueChange: onChange,
    onChange: onChangeHandler,
    size: size,
    label: props.label as React.ReactNode,
    ref: ref as Ref<HTMLInputElement | HTMLTextAreaElement> | undefined,
  })

  const end = useMemo(() => {
    if (isClearable) {
      return (
        <span
          {...getClearButtonProps()}
          className={clearButtonStyle({ isClearable })}
        >
          <CloseFilledIcon />
        </span>
      )
    }
  }, [isClearable, getClearButtonProps])

  const helperWrapper = useMemo(() => {
    if (!hasHelper) return null

    return (
      <div {...getHelperWrapperProps()} className={helperWrapperStyle()}>
        {errorMessage && isInvalid ? (
          <div
            {...getErrorMessageProps()}
            className={classNames(errorMessageStyle(), errorClassName)}
          >
            {errorMessage}
          </div>
        ) : description ? (
          <div {...getDescriptionProps()} className={descriptionStyle()}>
            {description}
          </div>
        ) : null}
      </div>
    )
  }, [
    hasHelper,
    getHelperWrapperProps,
    errorMessage,
    isInvalid,
    getErrorMessageProps,
    errorClassName,
    description,
    getDescriptionProps,
  ])

  const innerWrapper = useMemo(() => {
    if (startContent || end || endContent) {
      return (
        <div
          {...getInnerWrapperProps()}
          className={innerWrapperStyle({ variant, isDisabled, isInvalid })}
        >
          {startContent}
          <input
            {...getInputProps()}
            onFocus={onFocus}
            onBlur={onBlur}
            className={classNames(
              inputStyle({ variant, isClearable, isDisabled, isInvalid }),
              inputClassName,
            )}
          />

          {end}
          {endContent && (
            <div className={endContentWrapperStyle()}>{endContent}</div>
          )}
        </div>
      )
    }

    return (
      <div
        {...getInnerWrapperProps()}
        className={innerWrapperStyle({ variant, isDisabled, isInvalid })}
      >
        <input
          {...getInputProps()}
          onFocus={onFocus}
          onBlur={onBlur}
          className={classNames(
            inputStyle({ variant, isClearable, isDisabled, isInvalid }),
            inputClassName,
          )}
        />
      </div>
    )
  }, [
    startContent,
    end,
    endContent,
    getInnerWrapperProps,
    variant,
    isDisabled,
    isInvalid,
    getInputProps,
    onFocus,
    onBlur,
    isClearable,
    inputClassName,
  ])

  const mainWrapper = useMemo(() => {
    return (
      <div {...getMainWrapperProps()} className={mainWrapperStyle()}>
        {label ? (
          <label
            {...getLabelProps()}
            htmlFor={getInputProps().id}
            className={labelStyle()}
          >
            {label}
          </label>
        ) : null}
        <div
          {...getInputWrapperProps()}
          className={classNames(
            inputWrapperStyle({ variant, size, isDisabled, isInvalid }),
            inputWrapperClassName,
          )}
        >
          {innerWrapper}
        </div>
        {helperWrapper}
      </div>
    )
  }, [
    getMainWrapperProps,
    getLabelProps,
    label,
    getInputWrapperProps,
    variant,
    size,
    isDisabled,
    isInvalid,
    inputWrapperClassName,
    innerWrapper,
    helperWrapper,
  ])

  return (
    <Component
      {...getBaseProps()}
      className={classNames(baseStyle({ isDisabled }), className)}
    >
      {mainWrapper}
    </Component>
  )
}
Input.displayName = 'Input'
