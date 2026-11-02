export const KLINE_MAIN_PANE_ID = 'candle_pane'

export const KLINE_DEFAULT_LOCALE = 'en-US'

export const KLINE_DIVIDER_LINE_COLORS = {
  light: 'rgba(11, 12, 14, 0.04)',
  dark: 'rgba(255, 255, 255, 0.02)',
} as const

export const getKlineDividerLineColor = (isDark: boolean): string =>
  isDark ? KLINE_DIVIDER_LINE_COLORS.dark : KLINE_DIVIDER_LINE_COLORS.light

export const KLINE_GRID_LINE_SIZE = 0.5
