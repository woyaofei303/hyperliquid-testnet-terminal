import { type PerformanceModule, performanceMetrics } from './performance.ts'

// 同一任务最多挂起一帧；过载时只延后显示提交，订阅和数据接收始终继续。
export function createFrameBatch(
  id: PerformanceModule,
  commit: () => void,
  clock = {
    request: (callback: FrameRequestCallback) =>
      typeof requestAnimationFrame === 'function'
        ? requestAnimationFrame(callback)
        : Number(setTimeout(() => callback(performance.now()), 0)),
    cancel: (handle: number) =>
      typeof cancelAnimationFrame === 'function'
        ? cancelAnimationFrame(handle)
        : clearTimeout(handle),
  },
) {
  let frame: number | null = null
  let last = -Infinity
  let active = true
  const flush = (time: number) => {
    frame = null
    if (!active) return
    const delay = [0, 1000 / 30, 100][performanceMetrics.level]
    if (time - last < delay) {
      frame = clock.request(flush)
      return
    }
    last = time
    performanceMetrics.measure(id, commit)
    performanceMetrics.queue(id, 0)
  }
  return {
    schedule() {
      if (active && frame === null) frame = clock.request(flush)
    },
    cancel() {
      active = false
      if (frame !== null) clock.cancel(frame)
      frame = null
      performanceMetrics.queue(id, 0)
    },
  }
}
