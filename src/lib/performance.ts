export const performanceModules = {
  book: '订单簿数据',
  account: '仓位 / 账户数据',
  candles: 'K 线数据',
  trades: '最新成交数据',
  context: '标记价 / 市场数据',
  chartFeed: '图表数据转换',
  kline: '基础版同步更新',
  tradingview: 'TradingView 同步更新',
  chartReact: '图表 React',
  bookReact: '盘口 React',
  orderReact: '下单 React',
  recordsReact: '记录 React',
} as const
export type PerformanceModule = keyof typeof performanceModules
export type PerformanceLevel = 0 | 1 | 2
export interface PressureState {
  level: PerformanceLevel
  bad: number
  healthy: number
  reason: string
}
export function adjustPressure(
  previous: PressureState,
  reason: string,
  critical = false,
): PressureState {
  if (reason) {
    const bad = previous.bad + 1
    return {
      level: critical
        ? 2
        : bad >= 3
          ? (Math.min(2, previous.level + 1) as PerformanceLevel)
          : previous.level,
      bad: bad >= 3 ? 0 : bad,
      healthy: 0,
      reason,
    }
  }
  const healthy = previous.healthy + 1
  return {
    level:
      healthy >= 10
        ? (Math.max(0, previous.level - 1) as PerformanceLevel)
        : previous.level,
    bad: 0,
    healthy: healthy >= 10 ? 0 : healthy,
    reason: previous.level && healthy < 10 ? previous.reason : '',
  }
}
export function createPerformanceMetrics() {
  const modules = Object.fromEntries(
    Object.keys(performanceModules).map((key) => [
      key,
      {
        input: 0,
        updates: 0,
        totalInput: 0,
        totalUpdates: 0,
        pending: 0,
        retained: 0,
        coalesced: 0,
        dropped: 0,
        lastInput: 0,
        age: 0,
        costs: [] as number[],
      },
    ]),
  ) as Record<
    PerformanceModule,
    {
      input: number
      updates: number
      totalInput: number
      totalUpdates: number
      pending: number
      retained: number
      coalesced: number
      dropped: number
      lastInput: number
      age: number
      costs: number[]
    }
  >
  let pressure: PressureState = { level: 0, bad: 0, healthy: 0, reason: '' }
  let previousHeap = 0
  const read = (seconds = 1) =>
    Object.entries(modules).map(([id, value]) => {
      const costs = [...value.costs].sort((a, b) => a - b)
      return {
        id,
        name: performanceModules[id as PerformanceModule],
        inputRate: value.input / seconds,
        updateRate: value.updates / seconds,
        totalInput: value.totalInput,
        totalUpdates: value.totalUpdates,
        pending: value.pending,
        retained: value.retained,
        coalesced: value.coalesced,
        dropped: value.dropped,
        lastInput: value.lastInput,
        age: value.lastInput
          ? value.age + Math.max(0, Date.now() - value.lastInput)
          : 0,
        p95: costs[Math.max(0, Math.ceil(costs.length * 0.95) - 1)] ?? 0,
        max: costs.at(-1) ?? 0,
      }
    })
  return {
    input(id: PerformanceModule, count = 1, sourceTime?: number) {
      const m = modules[id]
      m.input += count
      m.totalInput += count
      m.lastInput = Date.now()
      if (sourceTime) m.age = Math.max(0, Date.now() - sourceTime)
    },
    queue(id: PerformanceModule, pending: number, coalesced = 0, dropped = 0) {
      const m = modules[id]
      m.pending = pending
      m.coalesced += coalesced
      m.dropped += dropped
    },
    retain(id: PerformanceModule, count: number) {
      modules[id].retained = count
    },
    record(id: PerformanceModule, duration: number) {
      const m = modules[id]
      m.updates++
      m.totalUpdates++
      m.costs.push(duration)
      if (m.costs.length > 120) m.costs.shift()
    },
    measure<T>(id: PerformanceModule, callback: () => T): T {
      const start = performance.now()
      try {
        return callback()
      } finally {
        this.record(id, performance.now() - start)
      }
    },
    get level() {
      return pressure.level
    },
    read,
    sample({
      seconds,
      frames,
      slowFrames,
      longTasks,
      heapUsed,
      heapLimit,
      hidden,
    }: {
      seconds: number
      frames: number
      slowFrames: number
      longTasks: number
      heapUsed: number | null
      heapLimit: number | null
      hidden: boolean
    }) {
      const rows = read(seconds)
      const busy = rows.some(
        (row) => row.inputRate > 200 || row.p95 > 8 || row.pending > 100,
      )
      const worst = [...rows].sort((a, b) => b.p95 - a.p95)[0]
      const growth = heapUsed && previousHeap ? heapUsed - previousHeap : 0
      const ratio = heapUsed && heapLimit ? heapUsed / heapLimit : 0
      const memory = ratio > 0.9 || (ratio > 0.7 && growth > 32 * 1024 * 1024)
      const reason = memory
        ? 'JS 堆内存压力'
        : busy && (longTasks >= 3 || (frames > 5 && slowFrames / frames > 0.25))
          ? `持续掉帧；耗时最高：${worst.name}`
          : worst.p95 > 16 && worst.updateRate > 10
            ? `${worst.name} 同步更新耗时偏高`
            : ''
      if (!hidden) pressure = adjustPressure(pressure, reason, ratio > 0.9)
      previousHeap = heapUsed ?? 0
      const snapshot = {
        at: Date.now(),
        fps: hidden ? null : frames / seconds,
        longTasks,
        heapUsed,
        heapLimit,
        heapGrowth: growth,
        hidden,
        ...pressure,
        modules: rows,
      }
      for (const m of Object.values(modules)) {
        m.input = 0
        m.updates = 0
        m.costs = []
      }
      return snapshot
    },
  }
}
export const performanceMetrics = createPerformanceMetrics()
export type PerformanceSnapshot = ReturnType<typeof performanceMetrics.sample>
const emptySnapshot: PerformanceSnapshot = {
  at: 0,
  fps: null,
  longTasks: 0,
  heapUsed: null,
  heapLimit: null,
  heapGrowth: 0,
  hidden: false,
  level: 0,
  bad: 0,
  healthy: 0,
  reason: '',
  modules: [],
}
let snapshot = emptySnapshot
const listeners = new Set<() => void>()
export const performanceStore = {
  subscribe(listener: () => void) {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  },
  getSnapshot: () => snapshot,
  getServerSnapshot: () => emptySnapshot,
}
export function startPerformanceMonitor() {
  let frame = 0
  let previousFrame = 0
  let frames = 0
  let slowFrames = 0
  let longTasks = 0
  let lastSample = performance.now()
  const loop = (time: number) => {
    if (!document.hidden) {
      frames++
      if (previousFrame && time - previousFrame > 34) slowFrames++
    }
    previousFrame = time
    frame = requestAnimationFrame(loop)
  }
  frame = requestAnimationFrame(loop)
  let observer: PerformanceObserver | undefined
  if (
    typeof PerformanceObserver !== 'undefined' &&
    PerformanceObserver.supportedEntryTypes.includes('longtask')
  ) {
    observer = new PerformanceObserver((list) => {
      if (!document.hidden) longTasks += list.getEntries().length
    })
    observer.observe({ type: 'longtask' })
  }
  const resetFrames = () => {
    previousFrame = 0
    frames = 0
    slowFrames = 0
    longTasks = 0
    lastSample = performance.now()
  }
  document.addEventListener('visibilitychange', resetFrames)
  const timer = setInterval(() => {
    const now = performance.now()
    const memory = (
      performance as Performance & {
        memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number }
      }
    ).memory
    snapshot = performanceMetrics.sample({
      seconds: Math.max(0.001, (now - lastSample) / 1000),
      frames,
      slowFrames,
      longTasks,
      heapUsed: memory?.usedJSHeapSize ?? null,
      heapLimit: memory?.jsHeapSizeLimit ?? null,
      hidden: document.hidden,
    })
    resetFrames()
    for (const notify of listeners) notify()
  }, 1000)
  return () => {
    cancelAnimationFrame(frame)
    clearInterval(timer)
    observer?.disconnect()
    document.removeEventListener('visibilitychange', resetFrames)
  }
}
export function recordReactRender(
  id: string,
  _phase: string,
  duration: number,
) {
  if (id in performanceModules)
    performanceMetrics.record(id as PerformanceModule, duration)
}
