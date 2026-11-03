/**
 * 止盈止损方向
 * - Long: 做多仓位 - 向上拖动为止盈，向下拖动为止损
 * - Short: 做空仓位 - 向上拖动为止损，向下拖动为止盈
 */
export enum TpslDirection {
  Long = 'long',
  Short = 'short',
}

export type TPSLDirection = TpslDirection

/**
 * 预估收益线类型枚举
 * - TakeProfit: 止盈线（绿色）
 * - StopLoss: 止损线（红色）
 */
export enum TpslEstimateType {
  TakeProfit = 'takeProfit',
  StopLoss = 'stopLoss',
}

/**
 * 可为 null 的预估收益线类型（null 表示未创建预估收益线）
 */
export type TPSLEstimateType = TpslEstimateType | null

/**
 * 拖拽来源
 * - 'tpslButton': 从主线上的止盈止损按钮开始拖拽（创建新的预估收益线）
 * - 'estimateHandle': 从预估收益线的拖拽手柄开始拖拽（调整已有的预估收益线）
 * - null: 未在拖拽
 */
export type TPSLDragSource = 'tpslButton' | 'estimateHandle' | null

/**
 * 线的类型
 * - 'order': 委托单 - 显示限价价格和关闭按钮
 * - 'tpslOrder': 止盈止损委托单 - 显示止盈/止损标签、价格和关闭按钮
 * - 'position': 持仓 - 显示收益额、持仓量、关闭按钮和止盈止损按钮
 */
export const TPSL_LINE_TYPES = {
  Order: 'order',
  TpslOrder: 'tpslOrder',
  Position: 'position',
} as const

export type TPSLLineType =
  (typeof TPSL_LINE_TYPES)[keyof typeof TPSL_LINE_TYPES]

/**
 * 止盈止损overlay的扩展数据
 * Extended data for TPSL overlay
 */
export interface TPSLExtendData {
  // ===== 线类型 =====
  /** 线的类型：'order' 委托单 | 'tpslOrder' 止盈止损委托单 | 'position' 持仓 */
  lineType: TPSLLineType

  // ===== 仓位信息 =====
  /** 仓位方向：Long 做多 | Short 做空 */
  direction: TPSLDirection
  /** 收益额文本含币种 (e.g., "+123.45 USDT") - 仅持仓显示 */
  profitPercent: string
  /** 持仓数量 (e.g., "0.01") - 仅持仓显示，不含单位 */
  positionAmount: string
  /** 委托价格文本 (e.g., "22,449.80") - 仅委托单显示 */
  orderPriceText: string

  // ===== 预估收益线状态 =====
  /** 当前拖拽的止盈/止损类型（用于交互过程） */
  estimateType: TPSLEstimateType
  /** 预估收益文本 (e.g., "预估收益 +3.98%") */
  estimateText: string
  /** 止盈预估收益文本 */
  takeProfitText?: string
  /** 止损预估收益文本 */
  stopLossText?: string
  /** 止盈线价格值 */
  takeProfitValue: number | null
  /** 止损线价格值 */
  stopLossValue: number | null

  // ===== 交互状态 =====
  /** 鼠标是否悬停在主线上 */
  isHovered: boolean
  /** 鼠标是否悬停在关闭按钮上 */
  isCloseHovered: boolean
  /** 鼠标是否悬停在止盈止损按钮上 */
  isTPSLHovered: boolean
  /** 是否正在拖拽 */
  isDragging: boolean
  /** 拖拽来源 */
  dragSource: TPSLDragSource
  /** 主线的初始价格值（拖拽时用于保持主线不动） */
  _mainValueSnapshot: number | null
  /** 当前拖拽的类型 */
  _activeEstimateType: TPSLEstimateType
  /** 拖拽开始前是否已有止盈线 */
  _hadTakeProfitBeforeDrag: boolean
  /** 拖拽开始前是否已有止损线 */
  _hadStopLossBeforeDrag: boolean

  // ===== 按钮位置缓存（用于检测hover区域） =====
  /** 关闭按钮的起始X坐标 */
  _closeButtonX: number
  /** 关闭按钮的宽度 */
  _closeButtonWidth: number
  /** 止盈止损按钮的起始X坐标 */
  _tpslButtonX: number
  /** 止盈止损按钮的宽度 */
  _tpslButtonWidth: number

  // ===== i18n 文案（可选，默认中文） =====
  /** "限价" 标签文案 */
  limitLabelText?: string
  /** "收益额" 标签文案 */
  profitAmountLabel?: string
  /** "预估收益" 默认文案 */
  estimatedProfitLabel?: string
  /** "预估亏损" 默认文案 */
  estimatedLossLabel?: string

  // ===== 事件回调 =====
  /** 关闭按钮点击回调 */
  onClose?: () => void

  /** 首次拖出预估线；业务层决定确认或提交，回调本身不代表已创建订单。 */
  onFirstDragEnd?: (data: {
    direction: TPSLDirection
    mainValue: number
    estimateValue: number
    estimateType: TPSLEstimateType
  }) => void

  /** 已有线修改；携带原侧和目标侧，供业务提交及失败回滚。 */
  onEstimateDragEnd?: (data: {
    direction: TPSLDirection
    mainValue: number
    estimateValue: number
    estimateType: TPSLEstimateType
    originalEstimateType?: TPSLEstimateType
  }) => void

  /**
   * 拖拽中回调 - 实时更新预估收益线位置
   */
  onDragging?: (data: {
    direction: TPSLDirection
    currentValue: number
    estimateType: TPSLEstimateType
    isFirstDrag: boolean
  }) => void

  /**
   * 预估线关闭回调 - 点击预估线右侧关闭按钮触发
   */
  onEstimateClose?: (data: {
    direction: TPSLDirection
    mainValue: number
    estimateValue: number
    estimateType: TPSLEstimateType
  }) => void
}

/**
 * 默认扩展数据
 */
export const defaultExtendData: TPSLExtendData = {
  lineType: TPSL_LINE_TYPES.Position,
  direction: TpslDirection.Long,
  profitPercent: '--',
  positionAmount: '--',
  orderPriceText: '',
  estimateType: null,
  estimateText: '',
  takeProfitText: '',
  stopLossText: '',
  takeProfitValue: null,
  stopLossValue: null,
  isHovered: false,
  isCloseHovered: false,
  isTPSLHovered: false,
  isDragging: false,
  dragSource: null,
  _mainValueSnapshot: null,
  _activeEstimateType: null,
  _hadTakeProfitBeforeDrag: false,
  _hadStopLossBeforeDrag: false,
  _closeButtonX: 0,
  _closeButtonWidth: 0,
  _tpslButtonX: 0,
  _tpslButtonWidth: 0,
}

export type TpslModalHandlers = {
  onOpenTpslModal?: () => void
  onOpenEstimateModal?: (type?: TpslEstimateType) => void
}

/** 绘图事件只报告交互结果；是否弹窗、提交接口、按合约精度截断以及失败回滚由业务层决定。 */
export type TpslEstimateDragCallbacks = {
  onFirstDragEnd?: (data: {
    direction: TPSLDirection
    mainValue: number
    estimateValue: number
    estimateType: TPSLEstimateType
  }) => void
  onEstimateDragEnd?: (data: {
    direction: TPSLDirection
    mainValue: number
    estimateValue: number
    estimateType: TPSLEstimateType
    originalEstimateType?: TPSLEstimateType
  }) => void
  onDragging?: (data: {
    direction: TPSLDirection
    currentValue: number
    estimateType: TPSLEstimateType
    isFirstDrag: boolean
  }) => void
  onEstimateClose?: (data: {
    direction: TPSLDirection
    mainValue: number
    estimateValue: number
    estimateType: TPSLEstimateType
  }) => void
  getEstimateText?: (
    currentValue: number,
    estimateType: TpslEstimateType,
  ) => string
}

/** 一项业务快照会生成多个图形；主线价格与止盈/止损目标价分别传递。 */
export type TpslOverlayBase = TpslEstimateDragCallbacks &
  TpslModalHandlers & {
    /** 在当前图表中唯一且稳定，需包含业务类型，避免订单与仓位 id 相撞。 */
    id: string
    lineType: TPSLLineType
    mainValue: number
    direction: TPSLDirection
    /** 强平价格上下文；当前拖拽模板仅传递此值，不代表已完成价格校验。 */
    reducePrice?: number | null
    takeProfitValue?: number | null
    stopLossValue?: number | null
    takeProfitText?: string
    stopLossText?: string
    onClose?: () => void
    /** 服务端尚无止盈价时保留首次拖拽草稿；确认/取消结束后由业务层释放。 */
    keepTemporaryTakeProfit?: boolean
    /** 与 keepTemporaryTakeProfit 相同，用于止损侧。 */
    keepTemporaryStopLoss?: boolean
  }

export type TpslOrderOverlayData = TpslOverlayBase & {
  lineType: typeof TPSL_LINE_TYPES.Order
  orderLabelText?: string
  orderPriceText: string
}

export type TpslTpslOrderOverlayData = TpslOverlayBase & {
  lineType: typeof TPSL_LINE_TYPES.TpslOrder
  orderLabelText: string
  orderPriceText: string
}

export type TpslPositionOverlayData = TpslOverlayBase & {
  lineType: typeof TPSL_LINE_TYPES.Position
  profitPercent: string
  positionAmount: string
}

export type TpslOverlayData =
  | TpslOrderOverlayData
  | TpslTpslOrderOverlayData
  | TpslPositionOverlayData
