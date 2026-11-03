'use client'

import { classNames, cn } from '@fameex/utils'
import type { DropdownProps } from '@heroui/react'
import {
  Dropdown,
  DropdownItem,
  DropdownMenu,
  DropdownTrigger,
} from '@heroui/react'
import { useReducedMotion } from 'framer-motion'
import {
  cloneElement,
  isValidElement,
  type Key,
  type ReactElement,
  useMemo,
} from 'react'
import { ChartIcon } from '../chart-icon'
import type { SelectItem } from './Select'
import { dropdownStyle } from './style'

const {
  baseStyle,
  triggerStyle,
  menuStyle,
  contentStyle,
  itemStyle,
  iconStyle,
} = dropdownStyle()

export const ChevronIcon = () => (
  <ChartIcon
    name="arrow-drop-down"
    className={classNames(
      'text-2 size-3 motion-reduce:transition-none',
      iconStyle(),
    )}
  />
)

export type FlatSelectProps = {
  'aria-label': string
  items: SelectItem[]
  value?: string
  spanClassName?: string
  placeholder?: string
  isDisabled?: boolean
  className?: string
  onChange?: (value: string) => void
  placement?: DropdownProps['placement']
  hideSelectedIcon?: boolean
  chevron?: ReactElement<{ className?: string }>
  ref?: React.Ref<HTMLDivElement>
}

export const FlatSelect = ({
  items,
  value,
  placement,
  spanClassName,
  hideSelectedIcon = true,
  placeholder,
  isDisabled,
  onChange,
  chevron,
  ref,
  className,
  ...props
}: FlatSelectProps) => {
  const reduceMotion = useReducedMotion()
  const selectedItem = useMemo(() => {
    return items.find((item) => item.key === value)
  }, [items, value])

  const handleSelectionChange = (key: Key) => {
    onChange?.(key as string)
  }

  const renderChevron = useMemo(() => {
    if (!chevron) return <ChevronIcon />
    if (isValidElement(chevron)) {
      return cloneElement(chevron, {
        className: classNames(chevron.props.className, iconStyle()),
      })
    }
    return chevron
  }, [chevron])

  return (
    <Dropdown
      {...props}
      ref={ref}
      // 下拉通过 portal 挂载到 body，需留在父弹窗的可访问范围内。
      data-react-aria-top-layer="true"
      isDisabled={isDisabled}
      disableAnimation={Boolean(reduceMotion)}
      shouldCloseOnScroll={false}
      triggerScaleOnOpen={false}
      placement={placement}
      classNames={{
        base: cn(baseStyle(), className),
        content: contentStyle(),
      }}
    >
      <DropdownTrigger className={triggerStyle()}>
        <button
          type="button"
          aria-label={props['aria-label']}
          disabled={isDisabled}
          className="flex shrink-0 items-center gap-1 rounded-sm py-1"
        >
          {selectedItem?.startContent}
          <span className={spanClassName}>
            {selectedItem?.label || placeholder}
          </span>
          {selectedItem?.endContent}
          {renderChevron}
        </button>
      </DropdownTrigger>
      <DropdownMenu
        items={items}
        className={menuStyle()}
        aria-label={`${props['aria-label']}选项`}
        onAction={handleSelectionChange}
        selectedKeys={value ? [value] : []}
        selectionMode="single"
        classNames={{
          base: '!border-[0.5px] border-cc-2 shadow-[0_0_1px_0_rgba(11,12,14,0.20),_0_4px_8px_0_rgba(11,12,14,0.08)]',
        }}
      >
        {items.map((item) => (
          <DropdownItem
            key={item.key}
            textValue={item.label}
            hideSelectedIcon={hideSelectedIcon}
            className={cn(
              itemStyle(),
              'text-3 data-[hover=true]:!text-3',
              value === item.key && 'text-1',
            )}
            startContent={item.startContent}
            endContent={item.endContent}
          >
            {item.label}
          </DropdownItem>
        ))}
      </DropdownMenu>
    </Dropdown>
  )
}

FlatSelect.displayName = 'FlatSelect'
