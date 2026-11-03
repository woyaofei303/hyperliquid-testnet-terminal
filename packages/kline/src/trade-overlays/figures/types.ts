import type { TPSLLineType, TpslEstimateType } from '../types'

/**
 * 图形属性类型
 */
export interface TPSLMainLineAttrs {
  /** 起始 X 坐标 */
  x: number
  /** Y 坐标（价格对应的像素位置） */
  y: number
  /** 线条宽度（通常为图表宽度） */
  width: number
  /** 线的类型：'order' 委托单 | 'tpslOrder' 止盈止损委托单 | 'position' 持仓 */
  lineType: TPSLLineType
  /** 收益文本，如 "收益额 -3%" - 仅持仓显示 */
  profitText: string
  /** 持仓量文本，如 "764.09" - 仅持仓显示 */
  positionText: string
  /** 委托价格文本，如 "22,449.80" - 仅委托单显示 */
  orderPriceText: string
  /** 价格文本（Y轴显示，此处可为空） */
  priceText: string
  /** 是否鼠标悬停状态 - 控制关闭按钮显示，持仓时也控制止盈止损按钮 */
  isHovered: boolean
  /** 是否亏损状态 - 控制颜色（true=红色，false=绿色） */
  isLoss: boolean
  /** 是否hover在关闭按钮上 */
  isCloseHovered?: boolean
  /** 是否hover在止盈止损按钮上 - 仅持仓有效 */
  isTPSLHovered?: boolean
}

export interface TPSLEstimateLineAttrs {
  /** 起始 X 坐标 */
  x: number
  /** Y 坐标（目标价格对应的像素位置） */
  y: number
  /** 线条宽度 */
  width: number
  /** 预估收益文本，如 "预估收益 +3.98%" */
  estimateText: string
  /** 价格文本（Y轴显示，此处可为空） */
  priceText: string
  /** 是否止损线 - 控制颜色（true=红色止损，false=绿色止盈） */
  isLoss: boolean
  /** 止盈/止损类型 */
  estimateType: TpslEstimateType
  /** 标签左偏移量（对齐 tpslButton 位置），不设时使用默认值 */
  labelOffsetX?: number
}

export interface TPSLAreaAttrs {
  /** 起始 X 坐标 */
  x: number
  /** 主线 Y 坐标 */
  y1: number
  /** 预估收益线 Y 坐标 */
  y2: number
  /** 区域宽度 */
  width: number
  /** 是否正在拖拽 - 控制背景色透明度 */
  isDragging: boolean
  /** 是否止损区域 - 控制背景颜色 */
  isLoss: boolean
}

export interface TPSLDragHandleAttrs {
  /** X 坐标 */
  x: number
  /** Y 坐标 */
  y: number
  /** 是否止损 - 控制颜色 */
  isLoss: boolean
}

export interface TPSLButtonHitboxAttrs {
  /** X 坐标 */
  x: number
  /** Y 坐标 */
  y: number
  /** 宽度 */
  width: number
  /** 高度 */
  height: number
  /** 按钮类型 */
  role: 'close' | 'tpsl'
}
