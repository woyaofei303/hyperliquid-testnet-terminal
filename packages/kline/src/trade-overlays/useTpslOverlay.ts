import { useMemo } from 'react'
import { createMeasureText } from './helpers/measurements'
import { createFont } from './helpers/overlayConstants'
import { useOverlayLifecycle } from './lifecycle'
import { type OverlayTexts, useTpslOverlayManager } from './manager'
import type { UseTpslOverlayOptions } from './options'

const TPSL_FONT = createFont()

const buildOverlayTexts = (t?: (key: string) => string): OverlayTexts => ({
  limitText: t?.('tpsl_limit') ?? '',
  tpslText: t?.('tpsl_take_profit_stop_loss') ?? '',
  tpText: t?.('tpsl_take_profit') ?? '',
  slText: t?.('tpsl_stop_loss') ?? '',
  profitAmountText: t?.('tpsl_profit_amount') ?? '',
  estimatedProfitText: t?.('tpsl_estimated_profit') ?? '',
  estimatedLossText: t?.('tpsl_estimated_loss') ?? '',
})

/** 将业务快照转换为桌面交易线；这里只组织绘图，创建/修改/撤单通过 data 中的回调交回业务层。 */
export const useTpslOverlay = ({
  chartRef,
  overlayApi,
  initialized,
  data,
  translate,
  lineTypeVisibility,
  isMobile = false,
}: UseTpslOverlayOptions) => {
  const shouldRenderOverlay = initialized && !isMobile
  const { overlayMapRef, overlayRevision } = useOverlayLifecycle({
    chartRef,
    overlayApi,
    initialized: shouldRenderOverlay,
  })
  const overlayTexts = useMemo(() => buildOverlayTexts(translate), [translate])
  const measureText = useMemo(() => createMeasureText(TPSL_FONT), [])
  // 隐藏类型会从同步输入中移除，manager 随之删除该组；重新开启时按最新数据重建。
  const filteredData = useMemo(() => {
    if (!lineTypeVisibility) return data
    return data.filter((item) => lineTypeVisibility[item.lineType] !== false)
  }, [data, lineTypeVisibility])
  const visibleData = useMemo(
    () => (shouldRenderOverlay ? filteredData : []),
    [filteredData, shouldRenderOverlay],
  )

  useTpslOverlayManager({
    data: visibleData,
    initialized: shouldRenderOverlay,
    overlayApi,
    overlayMapRef,
    overlayRevision,
    texts: overlayTexts,
    measureText,
  })

  return {
    overlayMap: overlayMapRef.current,
  }
}

export type {
  EstimateDragCallbacks,
  TpslOrderOverlayData,
  TpslOverlayBase,
  TpslOverlayData,
  TpslPositionOverlayData,
  UseTpslOverlayOptions,
} from './options'
