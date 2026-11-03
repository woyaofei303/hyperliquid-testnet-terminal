import type { Chart } from 'klinecharts'
import type { RefObject } from 'react'
import type { UseChartOverlayReturn } from '../shared/useKlineChartOverlay'
import type { TPSLLineType, TpslOverlayData } from './types'

export interface UseTpslOverlayOptions {
  chartRef: RefObject<Chart | null>
  overlayApi: UseChartOverlayReturn
  initialized: boolean
  data: TpslOverlayData[]
  translate?: (key: string) => string
  lineTypeVisibility?: Partial<Record<TPSLLineType, boolean>>
  isMobile?: boolean
}

export type OverlayPatch = Parameters<
  UseChartOverlayReturn['overrideOverlay']
>[0]

export type {
  TpslEstimateDragCallbacks as EstimateDragCallbacks,
  TpslOrderOverlayData,
  TpslOverlayBase,
  TpslOverlayData,
  TpslPositionOverlayData,
} from './types'
