/**
 * ============================================================================
 * 止盈止损 Overlay 图形绘制模块
 * TPSL (Take Profit / Stop Loss) Overlay Figures
 * ============================================================================
 *
 * 本模块定义了止盈止损overlay所需的自定义图形元素：
 *
 * 1. TPSLMainLineFigure - 主线图形（已重构为组合模式）
 *    - 由多个独立 Figure 组成：水平线、标签、按钮等
 *
 * 2. TPSLEstimateLineFigure - 预估收益线图形
 *    - 水平虚线表示止盈/止损目标价格
 *
 * 3. TPSLAreaFigure - 区域背景图形
 *    - 主线和预估收益线之间的半透明填充
 *
 * 4. 独立组件 Figures：
 *    - HorizontalLine: 水平线
 *    - LimitLabel: 限价标签
 *    - PriceLabel: 价格标签
 *    - CloseButton: 关闭按钮
 *    - TpslButton: 止盈止损按钮
 *    - ProfitLabel: 收益标签
 *    - PositionLabel: 持仓量标签
 *
 * ============================================================================
 */
import { registerAreaFigure } from './area'
import { registerButtonHitboxFigure } from './buttonHitbox'
import {
  registerCloseButtonFigure,
  type TPSLCloseButtonAttrs,
} from './closeButton'
import { registerDragHandleFigure } from './dragHandle'
import { registerEstimateLineFigure } from './estimateLine'
import {
  registerHorizontalLineFigure,
  type TPSLHorizontalLineAttrs,
} from './horizontalLine'
import {
  registerLimitLabelFigure,
  type TPSLLimitLabelAttrs,
} from './limitLabel'
import { registerMainLineFigure } from './mainLine'
import {
  registerMainLineHitboxFigure,
  type TPSLMainLineHitboxAttrs,
} from './mainLineHitbox'
import {
  registerPositionLabelFigure,
  type TPSLPositionLabelAttrs,
} from './positionLabel'
import {
  registerPriceLabelFigure,
  type TPSLPriceLabelAttrs,
} from './priceLabel'
import {
  registerProfitLabelFigure,
  type TPSLProfitLabelAttrs,
} from './profitLabel'
import {
  registerTpslButtonFigure,
  type TPSLTpslButtonAttrs,
} from './tpslButton'
import {
  registerVerticalConnectorFigure,
  type TPSLVerticalConnectorAttrs,
} from './verticalConnector'

// Export legacy register functions
export { registerAreaFigure } from './area'
export { registerButtonHitboxFigure } from './buttonHitbox'
// Export new component register functions
export { registerCloseButtonFigure } from './closeButton'
export { registerDragHandleFigure } from './dragHandle'
export { registerEstimateLineFigure } from './estimateLine'
export { registerHorizontalLineFigure } from './horizontalLine'
export { registerLimitLabelFigure } from './limitLabel'
export { registerMainLineFigure } from './mainLine'
export { registerMainLineHitboxFigure } from './mainLineHitbox'
export { registerPositionLabelFigure } from './positionLabel'
export { registerPriceLabelFigure } from './priceLabel'
export { registerProfitLabelFigure } from './profitLabel'
export { registerTpslButtonFigure } from './tpslButton'
// Export legacy types
export type {
  TPSLAreaAttrs,
  TPSLButtonHitboxAttrs,
  TPSLDragHandleAttrs,
  TPSLEstimateLineAttrs,
  TPSLMainLineAttrs,
} from './types'
export { registerVerticalConnectorFigure } from './verticalConnector'
// Export new component figure types
export type {
  TPSLCloseButtonAttrs,
  TPSLHorizontalLineAttrs,
  TPSLLimitLabelAttrs,
  TPSLMainLineHitboxAttrs,
  TPSLPositionLabelAttrs,
  TPSLPriceLabelAttrs,
  TPSLProfitLabelAttrs,
  TPSLTpslButtonAttrs,
  TPSLVerticalConnectorAttrs,
}

/**
 * Register all TPSL figures
 */
export const registerAllTPSLFigures = (): void => {
  // Legacy figures
  registerMainLineFigure()
  registerEstimateLineFigure()
  registerAreaFigure()
  registerDragHandleFigure()
  registerButtonHitboxFigure()

  // New component figures
  registerHorizontalLineFigure()
  registerLimitLabelFigure()
  registerPriceLabelFigure()
  registerCloseButtonFigure()
  registerTpslButtonFigure()
  registerProfitLabelFigure()
  registerPositionLabelFigure()
  registerMainLineHitboxFigure()
  registerVerticalConnectorFigure()
}
