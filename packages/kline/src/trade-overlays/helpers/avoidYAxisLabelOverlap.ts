import type { Chart } from 'klinecharts'

type PartialYAxis = {
  convertToNicePixel?: (value: number) => number
  convertToPixel?: (value: number) => number
}

interface AvoidYAxisLabelOverlapParams {
  chart: Chart
  yAxis: PartialYAxis | null | undefined
  labelY: number
  labelValue: number
  labelHeight: number
  boundingHeight: number
}

const OVERLAP_GAP = -2

const clampValue = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(value, max))

const getCurrentPrice = (chart: Chart): number | null => {
  const dataList = chart.getDataList()
  const last = dataList[dataList.length - 1]
  return typeof last?.close === 'number' ? last.close : null
}

const getCurrentPriceLabelHeight = (chart: Chart): number | null => {
  const styles = chart.getStyles()
  const priceMark = styles.candle.priceMark
  const text = priceMark.last.text

  if (!priceMark.show || !priceMark.last.show || !text.show) {
    return null
  }

  return text.size + text.paddingTop + text.paddingBottom
}

const getCurrentPriceLabelY = (
  yAxis: PartialYAxis | null | undefined,
  currentPrice: number,
): number | null => {
  if (!yAxis) return null
  if (typeof yAxis.convertToNicePixel === 'function') {
    return yAxis.convertToNicePixel(currentPrice)
  }
  if (typeof yAxis.convertToPixel === 'function') {
    return yAxis.convertToPixel(currentPrice)
  }
  return null
}

export const avoidYAxisLabelOverlapWithCurrentPrice = ({
  chart,
  yAxis,
  labelY,
  labelValue,
  labelHeight,
  boundingHeight,
}: AvoidYAxisLabelOverlapParams): number => {
  const currentPrice = getCurrentPrice(chart)
  if (typeof currentPrice !== 'number') return labelY

  const currentPriceLabelHeight = getCurrentPriceLabelHeight(chart)
  if (typeof currentPriceLabelHeight !== 'number') return labelY

  const currentPriceLabelY = getCurrentPriceLabelY(yAxis, currentPrice)
  if (
    typeof currentPriceLabelY !== 'number' ||
    !Number.isFinite(currentPriceLabelY)
  ) {
    return labelY
  }

  const requiredDistance =
    (labelHeight + currentPriceLabelHeight) / 2 + OVERLAP_GAP
  const distance = Math.abs(labelY - currentPriceLabelY)
  if (distance >= requiredDistance) return labelY

  const moveDistance = requiredDistance - distance
  const minY = labelHeight / 2
  const maxY = boundingHeight - labelHeight / 2
  const preferDirection =
    labelY < currentPriceLabelY
      ? -1
      : labelY > currentPriceLabelY
        ? 1
        : labelValue >= currentPrice
          ? -1
          : 1

  const preferredY = clampValue(
    labelY + preferDirection * moveDistance,
    minY,
    maxY,
  )
  if (Math.abs(preferredY - currentPriceLabelY) >= requiredDistance) {
    return preferredY
  }

  const fallbackY = clampValue(
    labelY - preferDirection * moveDistance,
    minY,
    maxY,
  )
  if (Math.abs(fallbackY - currentPriceLabelY) >= requiredDistance) {
    return fallbackY
  }

  return Math.abs(preferredY - currentPriceLabelY) >=
    Math.abs(fallbackY - currentPriceLabelY)
    ? preferredY
    : fallbackY
}
