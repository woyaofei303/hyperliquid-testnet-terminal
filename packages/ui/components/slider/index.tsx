'use client'

import { classNames } from '@fameex/utils'
import type {
  SliderProps as BaseSliderProps,
  SliderStepMark,
} from '@heroui/react'
import { Slider as BaseSlider } from '@heroui/react'
import { type RefObject, useMemo } from 'react'
import { slider as sliderVariants } from './style'

const { baseStyle, markStyle, fillerStyle, trackStyle, thumbStyle } =
  sliderVariants()

/** 将 mark 值按 min~max 的百分比换算成与轨道对齐的 left/translate（首尾贴边，中间居中） */
const getMarkOffset = (percent: number) => {
  const translateCls =
    percent === 0
      ? 'translate-x-0'
      : percent === 1
        ? '-translate-x-full'
        : '-translate-x-1/2'
  const left =
    percent !== 0 && percent !== 0.5 && percent !== 1
      ? percent < 0.5
        ? `calc(${percent * 100}% + 3px)`
        : `calc(${percent * 100}% - 3px)`
      : `${percent * 100}%`
  return { left, translateCls }
}

const triangleArrowTop =
  // reset diamond -> triangle
  'before:rotate-0 before:rounded-none before:bg-transparent before:w-0 before:h-0 ' +
  // triangle
  'before:border-solid before:border-x-[6px] before:border-x-transparent ' +
  'before:border-t-[6px] before:border-t-bg-3 before:border-b-0 ' +
  // place
  'data-[placement=top]:before:-bottom-[5px] data-[placement=top]:before:left-1/2 data-[placement=top]:before:-translate-x-1/2'

export interface SliderProps extends Omit<BaseSliderProps, 'onChange'> {
  /**
   * 使用 marks 属性标注分段式滑块，使用 value 指定滑块位置
   */
  marks?: SliderStepMark[]
  /**
   * 滑块步长，取值必须大于 0，并且可被 (max - min) 整除
   * @default 1
   */
  step?: number
  /**
   * 最小值
   * @default 0
   */
  minValue: number
  /**
   * 最大值
   * @default 100
   */
  maxValue: number
  /**
   * 当前元素的 aria-label 属性
   * @default process
   */
  label: string
  /**
   * 滑块值发生变化时的回调函数
   */
  onChange?: (value: number | number[]) => void
  /**
   * 是否显示 tooltip
   * @default true
   * @TODO
   * @hurley
   */
  showTooltip?: boolean
  /**
   * 滑块值
   */
  value?: number | number[]
  showCustomSteps?: boolean
  /**
   * 滑块尺寸
   * @default md
   * @TODO
   * @hurley
   */
  size?: 'sm' | 'md' | 'lg'
  /**
   * className
   */
  className?: string
  ref?: RefObject<HTMLDivElement>
  tooltipContentFormat?: (value: number) => string
}

export const Slider = ({
  marks,
  minValue,
  maxValue,
  label,
  value,
  size = 'sm',
  className,
  onChange,
  showCustomSteps = true,
  ref,
  tooltipContentFormat,
  ...rest
}: SliderProps) => {
  const renderSteps = useMemo(() => {
    let steps = [minValue, maxValue]
    if (marks?.length) {
      steps = [...new Set([...steps, ...marks.map((mark) => mark.value)])]
    }

    // 排序，避免 union 后顺序乱导致点击/渲染不直观
    steps = [...steps].sort((a, b) => a - b)

    const [startOffset, endOffset] = [
      Array.isArray(value) && value.length > 1 ? value[0] : minValue,
      Array.isArray(value) ? value[value.length - 1] : (value ?? minValue),
    ]
    return (
      // 关键：容器左右缩进 6px，让计算的 0~100% 对齐到轨道有效区域
      <div className="absolute inset-x-[0px] top-0.5 z-[1] flex">
        {steps.map((step) => {
          const percent = (step - minValue) / (maxValue - minValue)
          const { left, translateCls } = getMarkOffset(percent)

          return (
            <button
              type="button"
              aria-label={`${label} ${step}%`}
              disabled={rest.isDisabled}
              data-in-range={step <= endOffset && step >= startOffset}
              key={step}
              style={{ left }}
              className={classNames(
                'bg-3 data-[in-range=true]:border-text-2 border-cc-2 border-large absolute top-[2px] h-2 w-2 cursor-pointer rounded-full',
                'data-[in-range=true]:top-[2px] data-[in-range=true]:h-2 data-[in-range=true]:w-2',
                size === 'lg' &&
                  'data-[in-range=true]:border-text-1 top-[0px] h-3 w-3 data-[in-range=true]:top-[0px] data-[in-range=true]:h-3 data-[in-range=true]:w-3',
                translateCls,
              )}
              onClick={() => onChange?.(step)}
            />
          )
        })}
      </div>
    )
  }, [marks, minValue, maxValue, value, onChange, size, label, rest.isDisabled])

  return (
    <div
      className={classNames('relative w-full', baseStyle({ size }), className)}
      ref={ref}
    >
      <BaseSlider
        aria-label={label}
        maxValue={maxValue}
        minValue={minValue}
        value={value}
        onChange={onChange}
        classNames={{
          mark: `${markStyle({ size })} text-1`,
          filler: fillerStyle({ size }),
          track: trackStyle({ size }),
          thumb: thumbStyle({ size }),
        }}
        marks={marks}
        tooltipProps={{
          content: tooltipContentFormat?.(value as number),
          classNames: {
            base: `drop-shadow before:shadow-none ${triangleArrowTop}`,
            content:
              'border border-cc-1 bg-bg-3 text-body-s text-text-1 shadow-lg',
          },
        }}
        {...rest}
      />
      {showCustomSteps && renderSteps}
      <div className="absolute top-5 z-0 w-full">
        {marks?.length &&
          marks.map((mark) => {
            if (!mark?.label) return ''
            const percent = (mark.value - minValue) / (maxValue - minValue)
            const { left, translateCls } = getMarkOffset(percent)
            return (
              <span
                key={mark?.value}
                style={{ left }}
                className={classNames(
                  'absolute pointer-events-auto',
                  size === 'lg' ? 'text-body-s text-3' : 'text-body-xxs text-1',
                  translateCls,
                )}
              >
                {mark?.label}
              </span>
            )
          })}
      </div>
    </div>
  )
}

Slider.displayName = 'Slider'
