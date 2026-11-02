import { useCreation, useLatest, useMemoizedFn } from 'ahooks'
import type {
  Chart,
  Overlay,
  OverlayCreate,
  OverlayFilter,
  OverlayTemplate,
} from 'klinecharts'
import { type RefObject, useCallback } from 'react'
import { getChartEngine } from './engine'

export interface UseChartOverlayOptions {
  chartRef: RefObject<Chart | null>
  initialized: boolean
}

export interface OverlayGroupInfo {
  groupId: string
  overlays: Overlay[]
  count: number
}

export interface UseChartOverlayReturn {
  registerOverlayTemplate: <E = unknown>(config: OverlayTemplate<E>) => void
  createOverlay: (
    value: string | OverlayCreate | Array<string | OverlayCreate>,
    options?: { allowDuplicate?: boolean },
  ) => string | null | Array<string | null>
  getOverlays: (filter?: OverlayFilter) => Overlay[]
  getOverlaysByName: (name: string) => Overlay[]
  getOverlayById: (id: string) => Overlay | null
  getOverlaysByGroupId: (groupId: string) => Overlay[]
  getAllGroups: () => OverlayGroupInfo[]
  getOverlaysByPaneId: (paneId: string) => Overlay[]
  removeOverlay: (filter?: OverlayFilter) => boolean
  removeOverlayGroup: (groupId: string) => boolean
  removeOverlaysByName: (name: string) => boolean
  overrideOverlay: (
    override: Parameters<Chart['overrideOverlay']>[0],
  ) => boolean
  overrideOverlayGroup: (
    groupId: string,
    override: Parameters<Chart['overrideOverlay']>[0],
  ) => boolean
  clearAllOverlays: () => boolean
  clearOverlaysByPaneId: (paneId: string) => boolean
  batchCreateOverlays: (
    overlays: Array<string | OverlayCreate>,
  ) => Array<string | null>
  batchRemoveOverlays: (filters: OverlayFilter[]) => boolean[]
  hasOverlay: (filter: OverlayFilter) => boolean
  hasGroup: (groupId: string) => boolean
  getOverlayStats: () => {
    total: number
    byName: Record<string, number>
    byGroup: Record<string, number>
    byPane: Record<string, number>
  }
  toggleOverlayVisibility: (filter: OverlayFilter, visible?: boolean) => boolean
  toggleGroupVisibility: (groupId: string, visible?: boolean) => boolean
}

/** 为图表操作提供稳定引用；异常会记录日志并返回空值/false，调用方需检查创建结果。 */
export const useChartOverlay = ({
  chartRef,
  initialized,
}: UseChartOverlayOptions): UseChartOverlayReturn => {
  const latestChartRef = useLatest(chartRef)
  const registeredTemplates = useCreation(() => new Set<string>(), [])

  const checkExistingOverlay = useMemoizedFn((name: string): string | null => {
    const existingOverlays = getOverlaysByName(name)
    if (existingOverlays.length > 0) {
      const existingOverlay = existingOverlays[0]
      if (existingOverlay?.id) {
        console.warn(
          `Overlay with name "${name}" already exists. Returning existing overlay ID.`,
        )
        return existingOverlay.id
      }
    }
    return null
  })

  const registerOverlayTemplate = useCallback(
    <E>(config: OverlayTemplate<E>) => {
      try {
        if (registeredTemplates.has(config.name)) {
          console.warn(
            `Overlay template "${config.name}" is already registered`,
          )
          return
        }

        getChartEngine().registerOverlay(config)
        registeredTemplates.add(config.name)
      } catch (error) {
        console.error(
          `Failed to register overlay template "${config.name}":`,
          error,
        )
      }
    },
    [registeredTemplates],
  )

  const createOverlay = useMemoizedFn(
    (
      value: string | OverlayCreate | Array<string | OverlayCreate>,
      options: { allowDuplicate?: boolean } = {},
    ): string | null | Array<string | null> => {
      const currentChart = latestChartRef.current?.current

      if (!currentChart || !initialized) {
        console.warn('Chart instance is not available or not initialized')
        return Array.isArray(value) ? [] : null
      }

      // 默认按模板 name 去重；同模板的多条订单线/画线必须显式允许重复，再用 id 区分。
      const { allowDuplicate = false } = options

      try {
        if (Array.isArray(value)) {
          return value.map((item) => {
            let overlayConfig: OverlayCreate
            if (typeof item === 'string') {
              overlayConfig = { name: item }
            } else {
              overlayConfig = item
            }

            if (!allowDuplicate && overlayConfig.name) {
              const existingId = checkExistingOverlay(overlayConfig.name)
              if (existingId) {
                return existingId
              }
            }

            try {
              const result = currentChart.createOverlay(overlayConfig)
              return Array.isArray(result) ? (result[0] ?? null) : result
            } catch (error) {
              console.error(
                `Failed to create overlay "${overlayConfig.name}":`,
                error,
              )
              return null
            }
          })
        }

        let overlayConfig: OverlayCreate
        if (typeof value === 'string') {
          overlayConfig = { name: value }
        } else {
          overlayConfig = value
        }

        if (!allowDuplicate && overlayConfig.name) {
          const existingId = checkExistingOverlay(overlayConfig.name)
          if (existingId) {
            return existingId
          }
        }

        const result = currentChart.createOverlay(overlayConfig)
        return result
      } catch (error) {
        console.error('Failed to create overlay:', error)
        return Array.isArray(value) ? [] : null
      }
    },
  )

  const getOverlays = useMemoizedFn((filter?: OverlayFilter): Overlay[] => {
    const currentChart = latestChartRef.current?.current

    if (!currentChart || !initialized) {
      return []
    }

    try {
      return currentChart.getOverlays(filter)
    } catch (error) {
      console.error('Failed to get overlays:', error)
      return []
    }
  })

  const getOverlaysByName = useMemoizedFn((name: string): Overlay[] => {
    return getOverlays({ name })
  })

  const getOverlayById = useMemoizedFn((id: string): Overlay | null => {
    const overlays = getOverlays({ id })
    return overlays.length > 0 ? (overlays[0] ?? null) : null
  })

  const getOverlaysByGroupId = useMemoizedFn((groupId: string): Overlay[] => {
    return getOverlays({ groupId })
  })

  const getAllGroups = useMemoizedFn((): OverlayGroupInfo[] => {
    const allOverlays = getOverlays()
    const groupMap = new Map<string, Overlay[]>()

    allOverlays.forEach((overlay) => {
      const groupId = overlay.groupId || 'default'
      if (!groupMap.has(groupId)) {
        groupMap.set(groupId, [])
      }
      groupMap.get(groupId)?.push(overlay)
    })

    return Array.from(groupMap.entries()).map(([groupId, overlays]) => ({
      groupId,
      overlays,
      count: overlays.length,
    }))
  })

  const getOverlaysByPaneId = useMemoizedFn((paneId: string): Overlay[] => {
    return getOverlays({ paneId })
  })

  const removeOverlay = useMemoizedFn((filter?: OverlayFilter): boolean => {
    const currentChart = latestChartRef.current?.current

    if (!currentChart || !initialized) {
      console.warn('Chart instance is not available or not initialized')
      return false
    }

    try {
      return currentChart.removeOverlay(filter)
    } catch (error) {
      console.error('Failed to remove overlay:', error)
      return false
    }
  })

  const removeOverlayGroup = useMemoizedFn((groupId: string): boolean => {
    return removeOverlay({ groupId })
  })

  const removeOverlaysByName = useMemoizedFn((name: string): boolean => {
    return removeOverlay({ name })
  })

  const overrideOverlay = useMemoizedFn(
    (override: Parameters<Chart['overrideOverlay']>[0]): boolean => {
      const currentChart = latestChartRef.current?.current

      if (!currentChart || !initialized) {
        console.warn('Chart instance is not available or not initialized')
        return false
      }

      try {
        return currentChart.overrideOverlay(override)
      } catch (error) {
        console.error('Failed to override overlay:', error)
        return false
      }
    },
  )

  const overrideOverlayGroup = useMemoizedFn(
    (
      groupId: string,
      override: Parameters<Chart['overrideOverlay']>[0],
    ): boolean => {
      const groupOverlays = getOverlaysByGroupId(groupId)
      if (groupOverlays.length === 0) return false

      let success = true
      groupOverlays.forEach((overlay) => {
        const result = overrideOverlay({
          id: overlay.id,
          ...override,
        })
        success = success && result
      })

      return success
    },
  )

  const clearAllOverlays = useMemoizedFn((): boolean => {
    return removeOverlay({})
  })

  const clearOverlaysByPaneId = useMemoizedFn((paneId: string): boolean => {
    return removeOverlay({ paneId })
  })

  const batchCreateOverlays = useMemoizedFn(
    (overlays: Array<string | OverlayCreate>): Array<string | null> => {
      const results: Array<string | null> = []

      overlays.forEach((overlay) => {
        const result = createOverlay(overlay)
        if (Array.isArray(result)) {
          results.push(result[0] ?? null)
        } else {
          results.push(result)
        }
      })

      return results
    },
  )

  const batchRemoveOverlays = useMemoizedFn(
    (filters: OverlayFilter[]): boolean[] => {
      return filters.map((filter) => removeOverlay(filter))
    },
  )

  const hasOverlay = useMemoizedFn((filter: OverlayFilter): boolean => {
    const overlays = getOverlays(filter)
    return overlays.length > 0
  })

  const hasGroup = useMemoizedFn((groupId: string): boolean => {
    return hasOverlay({ groupId })
  })

  const getOverlayStats = useMemoizedFn(() => {
    const allOverlays = getOverlays()

    const stats = {
      total: allOverlays.length,
      byName: {} as Record<string, number>,
      byGroup: {} as Record<string, number>,
      byPane: {} as Record<string, number>,
    }

    allOverlays.forEach((overlay) => {
      stats.byName[overlay.name] = (stats.byName[overlay.name] || 0) + 1
      const groupId = overlay.groupId || 'default'
      stats.byGroup[groupId] = (stats.byGroup[groupId] || 0) + 1
      stats.byPane[overlay.paneId] = (stats.byPane[overlay.paneId] || 0) + 1
    })

    return stats
  })

  const toggleOverlayVisibility = useMemoizedFn(
    (filter: OverlayFilter, visible?: boolean): boolean => {
      const overlays = getOverlays(filter)
      if (overlays.length === 0) return false

      let success = true
      overlays.forEach((overlay) => {
        const newVisible = visible !== undefined ? visible : !overlay.visible
        const result = overrideOverlay({
          id: overlay.id,
          visible: newVisible,
        })
        success = success && result
      })

      return success
    },
  )

  const toggleGroupVisibility = useMemoizedFn(
    (groupId: string, visible?: boolean): boolean => {
      return toggleOverlayVisibility({ groupId }, visible)
    },
  )

  // 方法读取最新 chartRef/initialized，对象本身保持稳定，避免调用方反复清理和重建覆盖物。
  return useCreation(
    () => ({
      registerOverlayTemplate,
      createOverlay,
      getOverlays,
      getOverlaysByName,
      getOverlayById,
      getOverlaysByGroupId,
      getAllGroups,
      getOverlaysByPaneId,
      removeOverlay,
      removeOverlayGroup,
      removeOverlaysByName,
      overrideOverlay,
      overrideOverlayGroup,
      clearAllOverlays,
      clearOverlaysByPaneId,
      batchCreateOverlays,
      batchRemoveOverlays,
      hasOverlay,
      hasGroup,
      getOverlayStats,
      toggleOverlayVisibility,
      toggleGroupVisibility,
    }),
    [],
  )
}
