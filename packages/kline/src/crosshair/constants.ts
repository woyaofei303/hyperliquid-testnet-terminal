import { getColorByCssVar } from '@fameex/utils'

export const CROSSHAIR_OVERLAY_NAME = 'crosshairAxisMarker'

export const CROSSHAIR_OVERLAY_GROUP_ID = 'crosshairAxisMarkerGroup'

export const CROSSHAIR_LEFT_PANEL_FIGURE = 'crosshairLeftPanel'

export const CROSSHAIR_RIGHT_PANEL_FIGURE = 'crosshairRightPanel'

export const CROSSHAIR_OVERLAY_STYLES = {
  // Overall dimensions
  height: 36,
  gap: 1, // 1px gap between left and right sections
  borderRadius: 4,
  padding: { x: 4, y: 2 },

  // Left section (circle button)
  left: {
    width: 20,
  },

  // Right section
  right: {
    paddingRight: 6, // Padding from Y-axis right edge
  },

  // Circle with plus icon
  circle: {
    size: 12,
    borderWidth: 1,
  },

  // Typography
  text: {
    fontFamily: 'HarmonyOS Sans SC, sans-serif',
    fontSize: 10,
    lineHeight: 1.6,
  },

  // Colors
  colors: {
    background: '#2D2F39',
    text: '#FFFFFF',
    border: '#FFFFFF',
    // KlineColorPairsMap - percent change colors
    up: '#14B881', // Green for positive change
    down: '#EB4747', // Red for negative change
  },
}

export const CROSSHAIR_PLUS_ICON_SVG =
  'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTIiIGhlaWdodD0iMTIiIHZpZXdCb3g9IjAgMCAxMiAxMiIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48Y2lyY2xlIGN4PSI2IiBjeT0iNiIgcj0iNS41IiBzdHJva2U9IndoaXRlIi8+PHBhdGggZD0iTTYgMy41VjguNU0zLjUgNkg4LjUiIHN0cm9rZT0id2hpdGUiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIvPjwvc3ZnPg=='

export const getThemeCrosshairBgColor = (): string =>
  getColorByCssVar('--fx-text-10') ||
  getColorByCssVar('--fx-text-8') ||
  '#2D2F39'

export const getThemeCrosshairHoverBgColor = (): string =>
  typeof document !== 'undefined' &&
  document.documentElement.classList.contains('dark')
    ? getColorByCssVar('--fx-text-6', 0.92) || 'rgba(255, 255, 255, 0.92)'
    : '#474C58'

export const getThemeCrosshairFgColor = (): string =>
  getColorByCssVar('--fx-text-11') ||
  (typeof document !== 'undefined' &&
  document.documentElement.classList.contains('dark')
    ? '#1E2026'
    : '#FFFFFF')
