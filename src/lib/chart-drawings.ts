// 只保存绘图坐标，不保存回调或交易线；每个市场独立恢复。
export const drawingTools = {
  horizontalStraightLine: '水平直线',
  horizontalRayLine: '水平射线',
  horizontalSegment: '水平线段',
  verticalStraightLine: '垂直直线',
  verticalRayLine: '垂直射线',
  verticalSegment: '垂直线段',
  straightLine: '趋势直线',
  rayLine: '趋势射线',
  segment: '趋势线段',
  priceLine: '价格线',
  priceChannelLine: '价格通道',
  parallelStraightLine: '平行线',
  fibonacciLine: '斐波那契回撤',
  xabcd: 'XABCD 形态',
} as const
export type DrawingTool = keyof typeof drawingTools
export type SavedDrawing = {
  name: DrawingTool
  points: { timestamp: number; value: number }[]
  lock: boolean
}
export function readDrawings(raw: string | null): SavedDrawing[] {
  if (!raw) return []
  const data: unknown = JSON.parse(raw)
  if (!Array.isArray(data) || data.length > 200) throw new Error('绘图数据无效')
  return data.map((item) => {
    if (
      !item ||
      !Object.hasOwn(drawingTools, item.name) ||
      !Array.isArray(item.points) ||
      item.points.length < 1 ||
      item.points.length > 6 ||
      item.points.some(
        (point: SavedDrawing['points'][number]) =>
          !point ||
          !Number.isFinite(point.timestamp) ||
          point.timestamp <= 0 ||
          !Number.isFinite(point.value),
      )
    )
      throw new Error('绘图数据无效')
    return {
      name: item.name,
      points: item.points.map(
        ({ timestamp, value }: SavedDrawing['points'][number]) => ({
          timestamp,
          value,
        }),
      ),
      lock: item.lock === true,
    }
  })
}
export const drawingStorageKey = (coin: string) =>
  `hl-chart-drawings-v1:${encodeURIComponent(coin)}`
