import type { ComponentType } from 'react'
import { createElement } from 'react'
import cross_cursor from './crossCursor'
import cursor from './cursor'
import fibonacciLine from './fibonacciLine'
import horizontalRayLine from './horizontalRayLine'
import horizontalSegment from './horizontalSegment'
import horizontalStraightLine from './horizontalStraightLine'
import invisible from './invisible'
import lock from './lock'
import parallelStraightLine from './parallelStraightLine'
import priceChannelLine from './priceChannelLine'
import priceLine from './priceLine'
import rayLine from './rayLine'
import remove from './remove'
import segment from './segment'
import straightLine from './straightLine'
import strongMagnet from './strongMagnet'
import takeProfitStopLoss from './takeProfitStopLoss'
import unlock from './unlock'
import verticalRayLine from './verticalRayLine'
import verticalSegment from './verticalSegment'
import verticalStraightLine from './verticalStraightLine'
import visible from './visible'
import weakMagnet from './weakMagnet'
import xabcd from './xabcd'

type SelectDataSourceItem = {
  key: string
  text: string
}

type IconComponent = ComponentType<{ className?: string }>
type Translate = (key: string) => string

export const mapping: Record<string, IconComponent> = {
  horizontalStraightLine,
  horizontalRayLine,
  horizontalSegment,
  verticalStraightLine,
  verticalRayLine,
  verticalSegment,
  straightLine,
  rayLine,
  segment,
  priceLine,
  priceChannelLine,
  parallelStraightLine,
  fibonacciLine,
  takeProfitStopLoss,
  cursor,
  cross_cursor,
  xabcd,
  weak_magnet: weakMagnet,
  strong_magnet: strongMagnet,
  lock,
  unlock,
  visible,
  invisible,
  remove,
}

export function createSingleLineOptions(t: Translate): SelectDataSourceItem[] {
  return [
    { key: 'horizontalStraightLine', text: t('horizontal_straight_line') },
    { key: 'horizontalRayLine', text: t('horizontal_ray_line') },
    { key: 'horizontalSegment', text: t('horizontal_segment') },
    { key: 'verticalStraightLine', text: t('vertical_straight_line') },
    { key: 'verticalRayLine', text: t('vertical_ray_line') },
    { key: 'verticalSegment', text: t('vertical_segment') },
    { key: 'straightLine', text: t('straight_line') },
    { key: 'rayLine', text: t('ray_line') },
    { key: 'segment', text: t('segment') },
    { key: 'priceLine', text: t('price_line') },
  ]
}

export function createMoreLineOptions(t: Translate): SelectDataSourceItem[] {
  return [
    { key: 'priceChannelLine', text: t('price_channel_line') },
    { key: 'parallelStraightLine', text: t('parallel_straight_line') },
  ]
}

export function createFibonacciOptions(t: Translate): SelectDataSourceItem[] {
  return [{ key: 'fibonacciLine', text: t('fibonacci_line') }]
}

export function createTPSLOptions(t: Translate): SelectDataSourceItem[] {
  return [{ key: 'takeProfitStopLoss', text: t('take_profit_stop_loss') }]
}

export function createMagnetOptions(t: Translate): SelectDataSourceItem[] {
  return [
    { key: 'weak_magnet', text: t('weak_magnet') },
    { key: 'strong_magnet', text: t('strong_magnet') },
  ]
}

export function createCursorOptions(t: Translate): SelectDataSourceItem[] {
  return [
    { key: 'cursor', text: t('cursor') },
    { key: 'cross_cursor', text: t('cross_cursor') },
  ]
}

interface IconProps {
  name: string
  className?: string
}

export const Icon = ({ name, className }: IconProps) => {
  const Component = mapping[name]
  if (!Component) return null
  return createElement(Component, {
    className: `size-3.5 shrink-0 ${className ?? ''}`,
  })
}
