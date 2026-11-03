import { getColorByCssVar } from '@fameex/utils'
import type { Chart, OverlayCreate } from 'klinecharts'
import { useKlineChartStore } from '../../chart/useKlineChartStore'

const getThemeCrosshairBgColor = () =>
  getColorByCssVar('--fx-text-10') || '#2D2F39'
const getThemeCrosshairFgColor = () =>
  getColorByCssVar('--fx-text-11') || '#FFFFFF'

import { TPSL_TEMPLATE_NAMES } from '../idFactory'
import { clamp } from '../utils'
import { S } from './overlayConstants'

type ChartNavigation = Pick<
  Chart,
  'isZoomEnabled' | 'isScrollEnabled' | 'setZoomEnabled' | 'setScrollEnabled'
>
const navigationBeforeDrag = new WeakMap<
  ChartNavigation,
  { zoom: boolean; scroll: boolean }
>()

export function suspendChartNavigation(chart: ChartNavigation) {
  // 连续拖拽事件不能用已经禁用的状态覆盖最初快照。
  if (!navigationBeforeDrag.has(chart)) {
    navigationBeforeDrag.set(chart, {
      zoom: chart.isZoomEnabled(),
      scroll: chart.isScrollEnabled(),
    })
  }
  chart.setZoomEnabled(false)
  chart.setScrollEnabled(false)
}

export function restoreChartNavigation(chart: ChartNavigation) {
  const previous = navigationBeforeDrag.get(chart)
  if (!previous) return
  chart.setZoomEnabled(previous.zoom)
  chart.setScrollEnabled(previous.scroll)
  navigationBeforeDrag.delete(chart)
}

export const clampOverlayY = (y: number, height: number) =>
  clamp(y, S.height / 2, height - S.height / 2)

/** 删除图形或卸载不能依赖 mouseup 完成清理。 */
export function cancelTpslDrag(chart: Chart) {
  if (!navigationBeforeDrag.has(chart)) return
  restoreChartNavigation(chart)
  setDragPresentation(chart, 'candle_pane', false)
}

export function setDragPresentation(
  chart: Chart,
  paneId: string,
  dragging: boolean,
  cursor = 'crosshair',
) {
  useKlineChartStore.getState().setIsTpslDragging(dragging)
  chart.setStyles({
    crosshair: {
      horizontal: {
        text: dragging
          ? {
              show: true,
              backgroundColor: getThemeCrosshairBgColor(),
              color: getThemeCrosshairFgColor(),
            }
          : { show: false },
      },
    },
  })
  const container = chart.getDom(paneId, 'root')
  if (container) container.style.cursor = dragging ? 'grabbing' : cursor
}

export function upsertTpslArea(
  chart: Pick<Chart, 'getOverlays' | 'overrideOverlay' | 'createOverlay'>,
  area: Pick<
    OverlayCreate,
    'id' | 'paneId' | 'groupId' | 'zLevel' | 'points'
  > & {
    extendData: { isDragging: boolean; isLoss: boolean }
  },
) {
  if (chart.getOverlays({ id: area.id }).length > 0) {
    chart.overrideOverlay({
      id: area.id,
      points: area.points,
      extendData: area.extendData,
    })
  } else {
    chart.createOverlay({ ...area, name: TPSL_TEMPLATE_NAMES.area })
  }
}
