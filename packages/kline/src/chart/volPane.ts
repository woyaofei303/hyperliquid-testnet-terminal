import { getColorByCssVar } from '@fameex/utils'
import type { Chart } from 'klinecharts'

export const VOL_INDICATOR_NAME = 'VOL'
export const VOL_PANE_HEIGHT_RATIO = 0.25
export const VOL_PANE_MIN_HEIGHT = 30

export function getVolPaneTargetHeight(
  totalChartHeight: number,
): number | null {
  if (!Number.isFinite(totalChartHeight) || totalChartHeight <= 0) {
    return null
  }

  return Math.max(
    Math.round(totalChartHeight * VOL_PANE_HEIGHT_RATIO),
    VOL_PANE_MIN_HEIGHT,
  )
}

export function syncVolIndicatorPaneHeight(chart: Chart): string | null {
  const [volIndicator] = chart.getIndicators({ name: VOL_INDICATOR_NAME })
  if (!volIndicator?.paneId) return null

  const totalChartHeight = chart.getSize()?.height ?? 0
  const targetHeight = getVolPaneTargetHeight(totalChartHeight)
  if (targetHeight == null) return volIndicator.paneId

  const currentHeight = chart.getSize(volIndicator.paneId, 'root')?.height ?? 0

  if (Math.abs(currentHeight - targetHeight) < 1) {
    chart.setPaneOptions({
      id: volIndicator.paneId,
      minHeight: targetHeight,
    })
    return volIndicator.paneId
  }

  chart.setPaneOptions({
    id: volIndicator.paneId,
    minHeight: targetHeight,
    height: targetHeight,
  })

  return volIndicator.paneId
}

export function getVolumeStyles() {
  return {
    bars: [
      {
        upColor: getColorByCssVar('--fx-volume-up', 0.6),
        downColor: getColorByCssVar('--fx-volume-down', 0.6),
        noChangeColor: getColorByCssVar('--fx-volume-up', 0.6),
      },
    ],
  }
}
