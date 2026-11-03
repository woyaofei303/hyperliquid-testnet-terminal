import type { OverlayTemplate } from 'klinecharts'
import { getThemeBgGColor, getThemeBgRColor } from '../../shared/colors'
import {
  TPSL_CLOSE_BUTTON_FIGURE,
  TPSL_OVERLAY_STYLES,
  TPSL_Z_LEVELS,
} from '../constants'
import {
  registerCloseButtonFigure,
  type TPSLCloseButtonAttrs,
} from '../figures/index'
import { TPSL_TEMPLATE_NAMES } from '../idFactory'
import { clamp } from '../utils'

const S = TPSL_OVERLAY_STYLES

export interface CloseButtonExtendData {
  /** X 偏移量 */
  offsetX: number
  /** 是否亏损（控制颜色） */
  isLoss: boolean
  /** 是否有左圆角 */
  hasLeftRadius?: boolean
  /** 是否有右圆角 */
  hasRightRadius?: boolean
  /** 点击回调 */
  onClose?: () => void
  /** Hover 状态变化回调（用于外部状态同步） */
  onHoverChange?: (hovered: boolean) => void
  /** 内部状态：hover 背景色 */
  _hoverBgColor?: string
  /** 内部状态：是否 hover */
  _isHovered?: boolean
}

/**
 * 关闭按钮 Overlay Template
 * 负责显示关闭按钮并处理点击事件
 */
export const closeButtonTemplate: OverlayTemplate<CloseButtonExtendData> = {
  name: TPSL_TEMPLATE_NAMES.closeButton,
  fixedZLevel: true,
  totalStep: 1,
  needDefaultPointFigure: false,
  needDefaultXAxisFigure: false,
  needDefaultYAxisFigure: false,

  createPointFigures: ({ coordinates, bounding, overlay }) => {
    if (coordinates.length === 0) return []
    registerCloseButtonFigure()

    const extendData = overlay.extendData
    if (!extendData) return []
    const {
      offsetX,
      isLoss,
      hasLeftRadius = false,
      hasRightRadius = true,
      _hoverBgColor,
      _isHovered = false,
    } = extendData
    const mainY = clamp(
      coordinates[0].y,
      S.height / 2,
      bounding.height - S.height / 2,
    )

    const color = isLoss ? S.colors.loss.primary : S.colors.profit.primary
    const badgeBgColor = isLoss ? getThemeBgRColor() : getThemeBgGColor()
    const bgColor = _hoverBgColor || badgeBgColor

    const attrs: TPSLCloseButtonAttrs = {
      x: offsetX,
      y: mainY,
      bgColor,
      iconColor: color,
      borderColor: color,
      isHovered: _isHovered,
      hasLeftRadius,
      hasRightRadius,
    }

    return [
      {
        key: 'closeButton',
        type: TPSL_CLOSE_BUTTON_FIGURE,
        attrs,
        ignoreEvent: [
          'onPressedMoveStart',
          'onPressedMoving',
          'onPressedMoveEnd',
        ],
      },
    ]
  },

  // hover 进入：提升层级 + 改变颜色
  onMouseEnter: (event) => {
    const { overlay, chart } = event
    if (!overlay.extendData || !overlay.id) return

    const extendData = overlay.extendData
    if (extendData._isHovered) return

    const { isLoss } = extendData
    const hoverBgColor = isLoss ? getThemeBgRColor() : getThemeBgGColor()

    chart.overrideOverlay({
      id: overlay.id,
      zLevel: TPSL_Z_LEVELS.tooltip,
      extendData: {
        ...extendData,
        _hoverBgColor: hoverBgColor,
        _isHovered: true,
      },
    })
    extendData.onHoverChange?.(true)

    const container = chart.getDom(overlay.paneId, 'root')
    if (container) {
      container.style.cursor = 'pointer'
    }
  },

  // hover 离开：恢复层级 + 恢复颜色
  onMouseLeave: (event) => {
    const { overlay, chart } = event
    if (!overlay.extendData || !overlay.id) return

    const extendData = overlay.extendData
    if (!extendData._isHovered) return

    chart.overrideOverlay({
      id: overlay.id,
      zLevel: TPSL_Z_LEVELS.action,
      extendData: {
        ...extendData,
        _hoverBgColor: undefined,
        _isHovered: false,
      },
    })
    extendData.onHoverChange?.(false)

    const container = chart.getDom(overlay.paneId, 'root')
    if (container) {
      container.style.cursor = 'crosshair'
    }
  },

  // 点击：触发关闭回调
  onClick: (event) => {
    const { overlay } = event
    if (!overlay.extendData) return

    const extendData = overlay.extendData
    extendData.onClose?.()
  },
}
