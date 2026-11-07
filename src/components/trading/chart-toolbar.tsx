'use client'

import { ChartIcon, Checkbox, Tooltip } from '@fameex/ui'
import { classNames } from '@fameex/utils'
import { Popover, PopoverContent, PopoverTrigger } from '@heroui/react'
import { useState } from 'react'
import type { useChartControls } from '@/hooks/use-chart-controls'
import { t, useLocale } from '@/i18n'
import { type ChartInterval, chartIntervals } from '@/lib/chart-periods'
export type ChartEngine = 'kline' | 'tradingview'
export type ChartMode = ChartEngine | 'depth'
export const periodLabel = (value: ChartInterval) =>
  value
    .replace(/m$/, t('分'))
    .replace(/h$/, t('时'))
    .replace(/d$/, t('日'))
    .replace(/w$/, t('周'))
    .replace(/M$/, t('月'))

const toolClass =
  'flex size-7 shrink-0 items-center justify-center rounded text-2 hover:bg-cc-2 hover:text-1 disabled:opacity-40'
const popupClass =
  'rounded-m border border-edge bg-panel p-2 text-ink shadow-xl'

/** FameEX 周期栏、ChartViewTabs、工具图标；操作由图表 hook 执行。 */
export function ChartToolbar({
  interval,
  controls,
  engine,
  onEngineChange,
}: {
  interval: ChartInterval
  controls: ReturnType<typeof useChartControls>
  engine: ChartMode
  onEngineChange: (value: ChartMode) => void
}) {
  useLocale()

  const [open, setOpen] = useState(false)
  const [shapeOpen, setShapeOpen] = useState(false)
  const quick = ['time', '1m', '5m', '15m', '30m', '1h', '4h', '1d'] as const
  return (
    <nav
      aria-label={t('图表工具栏')}
      className="flex min-h-10 shrink-0 flex-wrap items-center justify-between gap-x-2 gap-y-1 border-b border-edge bg-bg-2 px-2 py-1 text-3"
    >
      <div
        className={
          engine === 'depth'
            ? 'hidden'
            : 'flex min-w-0 flex-wrap items-center gap-0.5'
        }
      >
        {quick.map((value) => (
          <button
            type="button"
            key={value}
            onClick={() => controls.selectPeriod(value)}
            aria-pressed={
              value === 'time'
                ? controls.timeline
                : !controls.timeline && interval === value
            }
            className={classNames(
              'flex h-[22px] shrink-0 items-center rounded px-2 text-body-regular leading-none hover:text-brand-1',
              (
                value === 'time'
                  ? controls.timeline
                  : !controls.timeline && interval === value
              )
                ? 'bg-cc-2 text-1'
                : 'text-3',
            )}
          >
            {value === 'time' ? t('分时') : periodLabel(value)}
          </button>
        ))}
        <Popover
          isOpen={open}
          onOpenChange={setOpen}
          placement="bottom-start"
          triggerScaleOnOpen={false}
        >
          <Tooltip content={t('更多时间周期')}>
            <PopoverTrigger>
              <button
                type="button"
                aria-label={t('更多时间周期')}
                className={toolClass}
              >
                <ChartIcon
                  name="arrow-drop-down"
                  className={`size-3 ${open ? 'rotate-180' : ''}`}
                />
              </button>
            </PopoverTrigger>
          </Tooltip>
          <PopoverContent className={popupClass}>
            <div className="grid grid-cols-4 gap-2">
              {chartIntervals.map((value) => (
                <button
                  type="button"
                  key={value}
                  onClick={() => {
                    controls.selectPeriod(value)
                    setOpen(false)
                  }}
                  aria-pressed={!controls.timeline && interval === value}
                  className={`flex h-7 w-16 items-center justify-center rounded border text-xs ${interval === value && !controls.timeline ? 'border-ink text-ink' : 'border-cc-1 text-muted hover:text-ink'}`}
                >
                  {periodLabel(value)}
                </button>
              ))}
            </div>
          </PopoverContent>
        </Popover>
        <Popover
          isOpen={shapeOpen}
          onOpenChange={setShapeOpen}
          placement="bottom-start"
          triggerScaleOnOpen={false}
        >
          <Tooltip content={t('图表类型')}>
            <PopoverTrigger>
              <button
                type="button"
                aria-label={t('图表类型')}
                className={toolClass}
                disabled={!controls.ready}
              >
                <ChartIcon
                  name={controls.shape === 'area' ? 'area' : 'k-line-chart'}
                />
              </button>
            </PopoverTrigger>
          </Tooltip>
          <PopoverContent className={popupClass}>
            <fieldset
              className="grid min-w-28 gap-1"
              aria-label={t('图表类型选项')}
            >
              {(
                [
                  ['candle_solid', t('实心蜡烛')],
                  ['candle_stroke', t('空心蜡烛')],
                  ['ohlc', 'OHLC'],
                  ['area', t('面积图')],
                ] as const
              ).map(([value, title]) => (
                <button
                  type="button"
                  key={value}
                  aria-pressed={controls.shape === value}
                  className={`rounded px-3 py-2 text-left text-xs hover:bg-cc-2 ${controls.shape === value ? 'text-accent' : 'text-ink'}`}
                  onClick={() => {
                    controls.selectShape(value)
                    setShapeOpen(false)
                  }}
                >
                  {t(title)}
                </button>
              ))}
            </fieldset>
          </PopoverContent>
        </Popover>
        <Tooltip content={t('指标')}>
          <button
            type="button"
            aria-label={t('指标')}
            className={toolClass}
            disabled={!controls.ready}
            onClick={() =>
              engine === 'kline'
                ? controls.setIndicatorsOpen(true)
                : controls.openIndicators()
            }
          >
            <ChartIcon name="indicators" />
          </button>
        </Tooltip>
        {engine === 'kline' && (
          <Popover placement="bottom-start" triggerScaleOnOpen={false}>
            <PopoverTrigger>
              <button
                type="button"
                aria-label={t('交易线')}
                className="rounded px-2 py-1 text-xs text-muted hover:text-ink"
                disabled={!controls.ready}
              >
                {t('交易线')}
              </button>
            </PopoverTrigger>
            <PopoverContent className={popupClass}>
              <div className="flex flex-col gap-3 p-2">
                {(
                  [
                    ['position', '持仓线'],
                    ['order', '订单线'],
                    ['tpslOrder', '止盈止损线'],
                  ] as const
                ).map(([key, label]) => (
                  <Checkbox
                    key={key}
                    isSelected={controls.tradeLines[key]}
                    onValueChange={(value) =>
                      controls.setTradeLines({
                        ...controls.tradeLines,
                        [key]: value,
                      })
                    }
                  >
                    {t(label)}
                  </Checkbox>
                ))}
              </div>
            </PopoverContent>
          </Popover>
        )}
        <Tooltip content={t('重置图表')}>
          <button
            type="button"
            aria-label={t('重置图表')}
            className={toolClass}
            disabled={!controls.ready}
            onClick={controls.reset}
          >
            <ChartIcon name="refresh" className="size-5 -scale-x-100" />
          </button>
        </Tooltip>
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-2">
        <div
          className="flex h-6 items-center rounded-m bg-cc-3 px-px"
          aria-label={t('图表引擎')}
          role="toolbar"
        >
          {(['kline', 'tradingview', 'depth'] as const).map((value) => (
            <button
              type="button"
              key={value}
              onClick={() => onEngineChange(value)}
              aria-pressed={engine === value}
              className={classNames(
                'flex h-[22px] items-center justify-center px-2 text-body-s font-normal',
                engine === value ? 'rounded-m bg-2 text-1' : 'text-3',
              )}
            >
              {value === 'kline'
                ? t('基础版')
                : value === 'depth'
                  ? t('深度图')
                  : 'TradingView'}
            </button>
          ))}
        </div>
        <Tooltip content={controls.fullscreen ? t('退出全屏') : t('全屏图表')}>
          <button
            type="button"
            aria-label={controls.fullscreen ? t('退出全屏') : t('全屏图表')}
            onClick={controls.toggleFullscreen}
            className={toolClass}
          >
            <ChartIcon
              name={
                controls.fullscreen
                  ? 'aspect-ratio-close2'
                  : 'aspect-ratio-open2'
              }
            />
          </button>
        </Tooltip>
      </div>
    </nav>
  )
}
