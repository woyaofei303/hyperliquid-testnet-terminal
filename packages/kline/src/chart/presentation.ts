import { getColorByCssVar } from '@fameex/utils'
import type {
  CandleStyle,
  CandleTooltipLegendsCustomCallback,
  DeepPartial,
  KLineData,
  NeighborData,
  Styles,
  TooltipLegend,
} from 'klinecharts'
import {
  getThemeCrosshairBgColor,
  getThemeCrosshairFgColor,
} from '../crosshair/constants'
import { getKlineDividerLineColor, KLINE_GRID_LINE_SIZE } from './constants'

const TOOLTIP_COLLAPSE_FEATURE_ID = 'tooltip-collapse-toggle'
const INDICATOR_COLLAPSE_COLOR = 'rgba(128,128,128,0.8)'
const INDICATOR_COLLAPSE_ACTIVE_COLOR = 'rgba(255,255,255,0.9)'

const CHEVRON_DOWN_PATH = 'M 2.25 3.75 L 5 6.25 L 7.75 3.75'
const CHEVRON_RIGHT_PATH = 'M 3.75 2.25 L 6.25 5 L 3.75 7.75'

export function buildTooltipCollapseFeature(collapsed: boolean) {
  return {
    id: TOOLTIP_COLLAPSE_FEATURE_ID,
    position: 'left' as const,
    type: 'path' as const,
    size: 10,
    color: INDICATOR_COLLAPSE_COLOR,
    activeColor: INDICATOR_COLLAPSE_ACTIVE_COLOR,
    backgroundColor: 'transparent',
    activeBackgroundColor: 'transparent',
    borderRadius: 4,
    paddingLeft: CANDLE_TOOLTIP_COLLAPSE_PADDING_LEFT,
    paddingRight: 4,
    paddingTop: 4,
    paddingBottom: 4,
    marginLeft: 0,
    marginTop: 0,
    marginRight: 0,
    marginBottom: 4,
    content: {
      path: collapsed ? CHEVRON_RIGHT_PATH : CHEVRON_DOWN_PATH,
      style: 'stroke' as const,
      lineWidth: 1.5,
    },
  }
}

interface LegendFormatting {
  pricePrecision?: number
  formatNumber?: (value: string) => string
  defaultValue?: string
  locale?: string
}

type CandleValues = Pick<KLineData, 'close'> &
  Partial<Pick<KLineData, 'open' | 'high' | 'low'>>
type CandleColors = {
  priceMark: {
    last: Pick<CandleStyle['priceMark']['last'], 'upColor' | 'downColor'>
  }
}

/** 涨跌以本根开盘价为基准，振幅以前收盘价为基准；直接返回文本，避免依赖引擎私有占位符。 */
export function buildCandleLegendTemplate(
  data: NeighborData<CandleValues | null>,
  styles: CandleColors,
  {
    pricePrecision = 2,
    formatNumber = String,
    defaultValue = '--',
    locale = 'en-US',
  }: LegendFormatting = {},
): TooltipLegend[] {
  const text1 = getColorByCssVar('--fx-text-1')
  const current = data.current
  const change = current ? current.close - (current.open ?? current.close) : 0
  const color =
    change > 0
      ? styles.priceMark.last.upColor
      : change < 0
        ? styles.priceMark.last.downColor
        : text1
  const open = current?.open ?? current?.close ?? 0
  const previousClose = data.prev?.close ?? current?.close ?? 0
  const changeText =
    open === 0
      ? defaultValue
      : `${formatNumber(((change / open) * 100).toFixed(2))}%(${formatNumber(change.toFixed(pricePrecision))})`
  const amplitudeText =
    !previousClose || current?.high == null || current.low == null
      ? defaultValue
      : `${formatNumber((((current.high - current.low) / previousClose) * 100).toFixed(2))}%`
  return [
    { title: 'time', value: '{time}' },
    ...['open', 'high', 'low', 'close', 'volume'].map((key) => ({
      title: key,
      value: { text: `{${key}}`, color },
    })),
    { title: 'change', value: { text: changeText, color } },
    {
      title: locale === 'zh-CN' ? '振幅：' : 'Amplitude：',
      value: { text: amplitudeText, color },
    },
  ]
}

export const MAIN_PANE_INDICATOR_TOOLTIP_OFFSET_TOP = 0
export const CANDLE_TOOLTIP_COLLAPSE_PADDING_LEFT = 4

export function createChartStyles(
  theme: string | undefined,
  legendTemplate: CandleTooltipLegendsCustomCallback,
  collapsed = false,
): DeepPartial<Styles> {
  const dividerLineColor = getKlineDividerLineColor(theme === 'dark')
  const red = getColorByCssVar('--fx-sem-r')
  const green = getColorByCssVar('--fx-sem-g')
  const text1 = getColorByCssVar('--fx-text-1')
  const crosshairTextBg = getThemeCrosshairBgColor()
  const crosshairTextFg = getThemeCrosshairFgColor()

  return {
    grid: {
      horizontal: {
        color: dividerLineColor,
        size: KLINE_GRID_LINE_SIZE,
        style: 'solid',
      },
      vertical: {
        color: dividerLineColor,
        size: KLINE_GRID_LINE_SIZE,
        style: 'solid',
      },
    },
    xAxis: {
      axisLine: { color: dividerLineColor },
      tickLine: { color: dividerLineColor },
    },
    yAxis: {
      axisLine: { color: dividerLineColor },
      tickLine: { color: dividerLineColor },
    },
    // 本工程不接入 FameEX 的快捷下单覆盖物，显示图表原生价格标签。
    crosshair: {
      horizontal: {
        text: {
          show: true,
          backgroundColor: crosshairTextBg,
          color: crosshairTextFg,
        },
      },
      vertical: {
        text: {
          backgroundColor: crosshairTextBg,
          color: crosshairTextFg,
        },
      },
    },
    candle: {
      bar: {
        upColor: green,
        downColor: red,
        upBorderColor: green,
        downBorderColor: red,
        upWickColor: green,
        downWickColor: red,
      },
      tooltip: {
        title: {
          color: text1,
          show: false,
        },
        legend: {
          color: text1,
          template: collapsed ? [] : legendTemplate,
        },
        features: [buildTooltipCollapseFeature(collapsed)],
      },
    },
    indicator: {
      tooltip: {
        offsetTop: MAIN_PANE_INDICATOR_TOOLTIP_OFFSET_TOP,
      },
    },
    separator: {
      color: dividerLineColor,
    },
  }
}
