'use client'

import { classNames } from '@fameex/utils'
import type { SelectProps as BaseSelectProps } from '@heroui/react'
import {
  Select as BaseSelect,
  SelectItem as BaseSelectItem,
} from '@heroui/react'
import { useMemo } from 'react'
import { select as selectVariants } from './style'

const {
  baseStyle,
  labelStyle,
  triggerStyle,
  valueStyle,
  selectorStyle,
  spinnerStyle,
  listboxStyle,
  listboxWrapperStyle,
  popoverContentStyle,
  itemStyle,
  innerWrapperStyle, // 新增 innerWrapper slot
} = selectVariants()

export { selectVariants }

export type SelectItem = {
  key: string
  label: string
  startContent?: React.ReactNode
  endContent?: React.ReactNode
}

export type SelectProps = Omit<BaseSelectProps<SelectItem>, 'children'> & {
  items: SelectItem[]
  variant?: 'flat' | 'bordered'
  trigger?: string
  /** 任意选项按下时回调（用于再次点击已选项时关闭下拉） */
  onItemPress?: () => void
}

export const Select = ({
  items,
  className,
  classNames: customClasses,
  name,
  onChange,
  variant = 'flat',
  trigger,
  onItemPress,
  ref,
  ...props
}: SelectProps) => {
  const renderItems = useMemo(() => {
    return items.map((item) => (
      <BaseSelectItem
        key={item.key}
        // https://www.heroui.com/docs/components/select#using-value-attribute-in-option
        // value={item.key}
        startContent={item.startContent}
        endContent={item.endContent}
        className={itemStyle()}
        onPress={onItemPress}
      >
        {item.label}
      </BaseSelectItem>
    ))
  }, [items, onItemPress])

  return (
    <BaseSelect
      ref={ref}
      popoverProps={{
        // 保持 portal 下拉在父弹窗的可访问范围内。
        ...{ 'data-react-aria-top-layer': 'true' },
        classNames: {
          content: 'p-0 rounded-[8px] overflow-hidden',
        },
      }}
      {...props}
      className={classNames(baseStyle(), className)}
      classNames={{
        label: labelStyle(),
        trigger: `${triggerStyle({ variant })} ${trigger}`,
        value: valueStyle(),
        selectorIcon: selectorStyle(),
        spinner: spinnerStyle(),
        listbox: listboxStyle(),
        listboxWrapper: listboxWrapperStyle(),
        popoverContent: popoverContentStyle(),
        innerWrapper: innerWrapperStyle(), // 新增 innerWrapper slot
        ...customClasses,
      }}
      // cannot get name from e.target when use onChange
      // may cause bug when use html form
      name={name}
      onChange={
        onChange
          ? (e) => onChange({ ...e, target: { ...e.target, name: name || '' } })
          : undefined
      }
    >
      {renderItems}
    </BaseSelect>
  )
}

Select.displayName = 'Select'
