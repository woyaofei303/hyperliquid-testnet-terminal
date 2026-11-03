import { OVERLAY_Z_LEVELS } from '../shared/layers'

export const TPSL_OVERLAY_NAME = 'takeProfitStopLoss'

export const TPSL_OVERLAY_GROUP_ID = 'takeProfitStopLossGroup'

export const TPSL_OVERLAY_GROUP_PREFIX = 'tpsl-group'

export const TPSL_OVERLAY_ID_PREFIX = 'tpsl'

export const TPSL_MAIN_LINE_FIGURE = 'tpslMainLine'

export const TPSL_ESTIMATE_LINE_FIGURE = 'tpslEstimateLine'

export const TPSL_AREA_FIGURE = 'tpslArea'

export const TPSL_DRAG_HANDLE_FIGURE = 'tpslDragHandle'

export const TPSL_BUTTON_HITBOX_FIGURE = 'tpslButtonHitbox'

export const TPSL_LIMIT_LABEL_FIGURE = 'tpslLimitLabel'

export const TPSL_PRICE_LABEL_FIGURE = 'tpslPriceLabel'

export const TPSL_CLOSE_BUTTON_FIGURE = 'tpslCloseButton'

export const TPSL_TPSL_BUTTON_FIGURE = 'tpslTpslButton'

export const TPSL_PROFIT_LABEL_FIGURE = 'tpslProfitLabel'

export const TPSL_POSITION_LABEL_FIGURE = 'tpslPositionLabel'

export const TPSL_HORIZONTAL_LINE_FIGURE = 'tpslHorizontalLine'

export const TPSL_MAIN_LINE_HITBOX_FIGURE = 'tpslMainLineHitbox'

export const TPSL_VERTICAL_CONNECTOR_FIGURE = 'tpslVerticalConnector'

export const TPSL_Z_LEVELS = OVERLAY_Z_LEVELS.TPSL

export const TPSL_Z_LEVEL = TPSL_Z_LEVELS.base

export const TPSL_OVERLAY_STYLES = {
  // Overall dimensions
  height: 22,
  borderRadius: 2,
  borderWidth: 0.5,
  padding: { x: 6, y: 4 },

  // Horizontal/connector lines
  line: {
    width: 1,
    dash: [1, 1],
  },

  // Main line (entry price line) left panel
  mainLine: {
    // Left badge: "收益额 -3%"
    leftBadge: {
      minWidth: 51,
      height: 22,
      paddingX: 6,
      paddingY: 4,
      borderRadius: { tl: 2, tr: 0, br: 0, bl: 2 },
    },
    // Position badge: "764.09"
    positionBadge: {
      minWidth: 20,
      height: 22,
      paddingX: 6,
    },
    // Close button
    closeButton: {
      size: 12,
      padding: 5,
    },
    // "止盈止损" button with drag handle
    tpslButton: {
      minWidth: 40,
      height: 22,
      paddingX: 6,
      dragHandleWidth: 6,
      dragHandlePadding: 3,
    },
  },

  // Estimate line (TP/SL target line)
  estimateLine: {
    // Label: "预估收益 7000USDT +3.98%" or "预估收益-3.98%"
    label: {
      minWidth: 73,
      height: 22,
      paddingX: 6,
      paddingY: 4,
    },
    // Drag handle
    dragHandle: {
      width: 22,
      height: 22,
      padding: 2,
      barWidth: 6,
      barHeight: 1,
      barGap: 1.5,
      borderRadius: 4,
    },
    // Price label (right side)
    priceLabel: {
      minWidth: 40,
      height: 22,
      paddingX: 6,
    },
  },

  // Area between lines
  area: {
    backgroundColor: 'rgba(235, 71, 71, 0.1)', // #EB47471A
    draggingBackgroundColor: 'rgba(231, 248, 242, 0.2)', // #E7F8F233
  },

  // Typography
  text: {
    fontFamily: 'HarmonyOS Sans SC, sans-serif',
    fontSize: 12,
    lineHeight: 1.6,
    fontWeight: {
      regular: 400,
      medium: 500,
    },
  },

  // Colors
  colors: {
    // Stop Loss (红色)
    loss: {
      primary: '#EB4747',
      background: '#FFFFFF',
      badgeBackground: '#FDEDED', // bg-r
      areaBackground: 'rgba(235, 71, 71, 0.1)', // #EB47471A
    },
    // Take Profit (绿色)
    profit: {
      primary: '#14B881',
      background: '#FFFFFF',
      badgeBackground: '#E7F8F2', // bg-g
      areaBackground: 'rgba(20, 184, 129, 0.1)',
    },
    // Common
    white: '#FFFFFF',
    text: '#FFFFFF',
  },
}

export const TPSL_CLOSE_ICON_SVG =
  'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTIiIGhlaWdodD0iMTIiIHZpZXdCb3g9IjAgMCAxMiAxMiIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cGF0aCBkPSJNMyAzTDkgOU05IDNMM3ciIHN0cm9rZT0iI0VCNDc0NyIgc3Ryb2tlLXdpZHRoPSIxLjUiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIvPjwvc3ZnPg=='
