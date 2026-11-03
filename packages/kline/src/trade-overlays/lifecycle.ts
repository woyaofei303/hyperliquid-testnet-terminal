import type { Chart } from 'klinecharts'
import type { RefObject } from 'react'
import { useCallback, useEffect, useReducer, useRef } from 'react'
import { getChartEngine } from '../shared/engine'
import type { UseChartOverlayReturn } from '../shared/useKlineChartOverlay'
import { cancelTpslDrag } from './helpers/drag'
import { getTpslGroupId } from './idFactory'
import {
  areaTemplate,
  closeButtonTemplate,
  estimateLineTemplate,
  horizontalLineTemplate,
  limitLabelTemplate,
  mainLineHitboxTemplate,
  positionLabelTemplate,
  priceLabelTemplate,
  profitLabelTemplate,
  tpslButtonTemplate,
  verticalConnectorTemplate,
} from './templates/index'

// 索引用于检查图形是否完整；删除按 groupId，覆盖模板临时创建的线与区域。
type OverlayMap = Map<string, Set<string>>
type OverlayMapRef = RefObject<OverlayMap>
export type OverlayLifecycleState = {
  overlayMapRef: OverlayMapRef
  overlayRevision: number
  resetOverlayState: () => void
}

const registerTemplates = (overlayApi: UseChartOverlayReturn) => {
  const templates = [
    horizontalLineTemplate,
    areaTemplate,
    limitLabelTemplate,
    priceLabelTemplate,
    profitLabelTemplate,
    positionLabelTemplate,
    mainLineHitboxTemplate,
    closeButtonTemplate,
    tpslButtonTemplate,
    estimateLineTemplate,
    verticalConnectorTemplate,
  ]
  const registered = getChartEngine().getSupportedOverlays()
  templates.forEach((template) => {
    if (registered.includes(template.name)) return
    overlayApi.registerOverlayTemplate(
      template as Parameters<
        UseChartOverlayReturn['registerOverlayTemplate']
      >[0],
    )
  })
}

/** 管理模板注册和图形索引；revision 让清空 Map 后的数据同步能再次运行。 */
export const useOverlayLifecycle = ({
  chartRef,
  overlayApi,
  initialized,
}: {
  chartRef: RefObject<Chart | null>
  overlayApi: UseChartOverlayReturn
  initialized: boolean
}): OverlayLifecycleState => {
  const overlayMapRef = useRef<OverlayMap>(new Map())
  const chartInstanceRef = useRef<Chart | null>(null)
  const registeredRef = useRef(false)
  const isMountedRef = useRef(false)
  const [overlayRevision, forceOverlayRevision] = useReducer(
    (count: number) => count + 1,
    0,
  )

  const resetOverlayState = useCallback(() => {
    const chart = chartInstanceRef.current ?? chartRef.current
    if (chart) {
      cancelTpslDrag(chart)
      // 使用原实例清理：此时 chartRef 可能已换成新图表，或 initialized 已变为 false。
      overlayMapRef.current.forEach((_, baseId) => {
        chart.removeOverlay({ groupId: getTpslGroupId(baseId) })
      })
    }
    overlayMapRef.current.clear()
    if (isMountedRef.current) forceOverlayRevision()
  }, [chartRef])

  useEffect(() => {
    if (!initialized) {
      resetOverlayState()
      chartInstanceRef.current = null
      return
    }

    const nextChartInstance = chartRef.current ?? null
    if (
      chartInstanceRef.current &&
      chartInstanceRef.current !== nextChartInstance
    ) {
      resetOverlayState()
    }
    chartInstanceRef.current = nextChartInstance
  }, [chartRef, initialized, resetOverlayState])

  useEffect(() => {
    if (!initialized || registeredRef.current) return
    registerTemplates(overlayApi)
    registeredRef.current = true
  }, [initialized, overlayApi])

  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
      resetOverlayState()
    }
  }, [resetOverlayState])

  return {
    overlayMapRef,
    overlayRevision,
    resetOverlayState,
  }
}
