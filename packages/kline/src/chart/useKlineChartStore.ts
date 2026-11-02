import type { Chart, Period } from 'klinecharts'
import { create } from 'zustand'

type KlineChartStore = {
  chartInstance: Chart | null
  isReady: boolean
  symbol: string | null
  period: Period | null
  overlayIds: string[]
  isDrawing: boolean
  isTpslDragging: boolean
  setChartInstance: (chartInstance: Chart | null) => void
  setReady: (isReady: boolean) => void
  setSymbol: (symbol: string | null) => void
  setPeriod: (period: Period | null) => void
  setOverlayIds: (overlayIds: string[]) => void
  addOverlayId: (overlayId: string | null | undefined) => void
  removeOverlayId: (overlayId: string) => void
  clearOverlays: () => void
  setIsDrawing: (isDrawing: boolean) => void
  setIsTpslDragging: (isTpslDragging: boolean) => void
}

/** 单例运行状态，供画线工具与交易光标协调；不持久化，也不按图表实例隔离。 */
export const useKlineChartStore = create<KlineChartStore>((set) => ({
  chartInstance: null,
  isReady: false,
  symbol: null,
  period: null,
  overlayIds: [],
  isDrawing: false,
  isTpslDragging: false,
  setChartInstance: (chartInstance) => set({ chartInstance }),
  setReady: (isReady) => set({ isReady }),
  setSymbol: (symbol) => set({ symbol }),
  setPeriod: (period) => set({ period }),
  setOverlayIds: (overlayIds) => set({ overlayIds }),
  addOverlayId: (overlayId) => {
    if (!overlayId) return
    set((state) => {
      if (state.overlayIds.includes(overlayId)) return state
      return { overlayIds: [...state.overlayIds, overlayId] }
    })
  },
  removeOverlayId: (overlayId) =>
    set((state) => ({
      overlayIds: state.overlayIds.filter((id) => id !== overlayId),
    })),
  clearOverlays: () => set({ overlayIds: [] }),
  setIsDrawing: (isDrawing) => set({ isDrawing }),
  setIsTpslDragging: (isTpslDragging) => set({ isTpslDragging }),
}))

export const setKlineChartInstance =
  useKlineChartStore.getState().setChartInstance
export const setKlineChartReady = useKlineChartStore.getState().setReady
