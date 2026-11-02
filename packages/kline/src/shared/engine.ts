type ChartEngine = typeof import('klinecharts')

let engine: ChartEngine | undefined
let loading: Promise<ChartEngine> | undefined

/** v10.1 在模块求值时读取 window；只在浏览器挂载图表后加载，并共享同一份注册表。 */
export function loadChartEngine(): Promise<ChartEngine> {
  loading ??= import('klinecharts')
    .then((module) => {
      engine = module
      return module
    })
    .catch((error) => {
      loading = undefined
      throw error
    })
  return loading
}

export function getChartEngine(): ChartEngine {
  if (!engine)
    throw new Error(
      'Chart engine must be loaded before registering chart extensions',
    )
  return engine
}
