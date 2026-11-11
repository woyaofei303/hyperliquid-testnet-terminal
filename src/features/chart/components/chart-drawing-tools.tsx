'use client'
import { DrawingIcon, getChartEngine, xabcdOverlay } from '@fameex/kline'
import { ChartIcon, SmartPopover, Tooltip } from '@fameex/ui'
import type { Chart, OverlayCreate, OverlayMode } from 'klinecharts'
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import {
  type DrawingTool,
  drawingStorageKey,
  drawingTools,
  readDrawings,
} from '@/features/chart/lib/chart-drawings'
import { t, useLocale } from '@/i18n'

const groupId = 'drawing_tools'
const buttonClass =
  'flex size-8 items-center justify-center rounded text-muted hover:bg-field hover:text-ink aria-pressed:bg-field aria-pressed:text-accent disabled:opacity-40'
export function ChartDrawingTools({
  chart,
  coin,
  visible,
  expanded,
  onExpandedChange,
}: {
  chart: Chart | null
  coin: string
  visible: boolean
  expanded: boolean
  onExpandedChange: (value: boolean) => void
}) {
  useLocale()
  const toolsId = useId()
  const [tool, setTool] = useState<DrawingTool | null>(null)
  const [mode, setMode] = useState<OverlayMode>('normal' as OverlayMode)
  const [locked, setLocked] = useState(false)
  const [hidden, setHidden] = useState(false)
  const [error, setError] = useState('')
  const create = useRef<(name: DrawingTool) => void>(() => {})
  const save = useRef(() => {})
  const cancel = () => {
    if (chart)
      for (const overlay of chart.getOverlays({ groupId }))
        if (overlay.currentStep !== -1) chart.removeOverlay({ id: overlay.id })
    setTool(null)
  }
  useEffect(() => {
    if (!chart) return
    getChartEngine().registerOverlay(xabcdOverlay)
    let active = true
    const key = drawingStorageKey(coin)
    setTool(null)
    setLocked(false)
    setHidden(false)
    setError('')
    const persist = () => {
      if (!active) return
      try {
        const drawings = chart
          .getOverlays({ groupId })
          .filter((o) => o.currentStep === -1)
          .map(({ name, points, lock }) => ({
            name,
            points: points.map(({ timestamp, value }) => ({
              timestamp,
              value,
            })),
            lock,
          }))
        localStorage.setItem(
          key,
          JSON.stringify(readDrawings(JSON.stringify(drawings))),
        )
        setError('')
      } catch {
        setError(t('绘图无法保存在本地'))
      }
    }
    const callbacks = {
      onDrawEnd: () => {
        setTool(null)
        queueMicrotask(persist)
      },
      onPressedMoveEnd: () => queueMicrotask(persist),
      onRemoved: () => queueMicrotask(persist),
    }
    try {
      const restored = readDrawings(localStorage.getItem(key))
      setLocked(restored.length > 0 && restored.every((item) => item.lock))
      for (const item of restored)
        chart.createOverlay({
          ...item,
          groupId,
          paneId: 'candle_pane',
          ...callbacks,
        })
    } catch {
      setError(t('本地绘图数据无法恢复'))
    }
    save.current = persist
    create.current = (name) => {
      for (const overlay of chart.getOverlays({ groupId }))
        if (overlay.currentStep !== -1) chart.removeOverlay({ id: overlay.id })
      if (chart.getOverlays({ groupId }).length >= 200) {
        setError(t('最多保存 200 个绘图'))
        return
      }
      const result = chart.createOverlay({
        name,
        groupId,
        paneId: 'candle_pane',
        ...callbacks,
      } as OverlayCreate)
      if (result) setTool(name)
    }
    const keydown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      for (const overlay of chart.getOverlays({ groupId }))
        if (overlay.currentStep !== -1) chart.removeOverlay({ id: overlay.id })
      setTool(null)
    }
    document.addEventListener('keydown', keydown)
    return () => {
      active = false
      chart.removeOverlay({ groupId })
      document.removeEventListener('keydown', keydown)
      create.current = () => {}
      save.current = () => {}
    }
  }, [chart, coin])
  useEffect(() => {
    chart?.overrideOverlay({ groupId, mode, lock: locked, visible: !hidden })
  }, [chart, mode, locked, hidden])
  // 侧栏布局提交后立即测量，避免等到 ResizeObserver 下一帧才拉伸 Canvas。
  // biome-ignore lint/correctness/useExhaustiveDependencies: expanded 改变实际图表宽度，须在浏览器绘制前完成布局。
  useLayoutEffect(() => {
    if (visible) chart?.resize()
  }, [chart, expanded, visible])
  // 工具栏收起或切换图表时结束未完成的绘图，保留已完成的对象。
  useEffect(() => {
    if ((!visible || !expanded) && chart) {
      for (const overlay of chart.getOverlays({ groupId }))
        if (overlay.currentStep !== -1) chart.removeOverlay({ id: overlay.id })
      setTool(null)
    }
  }, [chart, visible, expanded])
  function choose(name: DrawingTool) {
    setHidden(false)
    setLocked(false)
    create.current(name)
    chart?.overrideOverlay({ groupId, mode, lock: false, visible: true })
  }
  const action = (
    label: string,
    icon: string,
    onClick: () => void,
    pressed?: boolean,
  ) => (
    <Tooltip content={t(label)}>
      <button
        type="button"
        aria-label={t(label)}
        aria-pressed={pressed}
        disabled={!chart}
        className={buttonClass}
        onClick={onClick}
      >
        <DrawingIcon name={icon} />
      </button>
    </Tooltip>
  )
  return (
    <aside
      hidden={!visible}
      aria-label={t('画图工具')}
      className={`relative z-20 h-full min-h-0 shrink-0 bg-panel ${expanded ? 'w-10 border-r border-edge py-1 md:w-11' : 'w-0'}`}
    >
      <button
        type="button"
        aria-label={t(expanded ? '收起画图工具' : '展开画图工具')}
        aria-expanded={expanded}
        aria-controls={toolsId}
        className="absolute left-full top-[calc(72%-20px)] z-20 flex h-7 w-3 -translate-y-1/2 before:absolute before:-inset-x-1.5 before:-inset-y-0.5 before:content-[''] items-center justify-center rounded-r border border-l-0 border-edge bg-panel text-muted hover:bg-field hover:text-ink focus-visible:outline-2 focus-visible:outline-accent"
        onClick={() => onExpandedChange(!expanded)}
      >
        <ChartIcon
          name="arrow-drop-down"
          className={`size-2.5 ${expanded ? 'rotate-90' : '-rotate-90'}`}
        />
      </button>
      <div
        id={toolsId}
        hidden={!expanded}
        className="h-full overflow-y-auto overscroll-contain"
      >
        {expanded && (
          <div className="flex flex-col items-center gap-1">
            {action('光标', 'cross_cursor', cancel, tool === null)}
            <SmartPopover
              triggerLabel={t('线段工具')}
              placement="right-start"
              contentClassName="max-w-[calc(100vw-24px)] rounded-md border border-edge bg-panel p-1 text-ink shadow-xl"
              content={
                <div className="grid max-h-80 grid-cols-2 gap-1 overflow-auto p-1">
                  {Object.entries(drawingTools).map(([name, label]) => (
                    <button
                      key={name}
                      type="button"
                      aria-pressed={tool === name}
                      className="flex items-center gap-2 rounded px-2 py-2 text-xs hover:bg-field aria-pressed:text-accent"
                      onClick={() => choose(name as DrawingTool)}
                    >
                      <DrawingIcon name={name} />
                      {t(label)}
                    </button>
                  ))}
                </div>
              }
            >
              <span className={buttonClass}>
                <DrawingIcon name={tool ?? 'segment'} />
              </span>
            </SmartPopover>
            {action(
              '水平直线',
              'horizontalStraightLine',
              () => choose('horizontalStraightLine'),
              tool === 'horizontalStraightLine',
            )}
            {action(
              '趋势线段',
              'segment',
              () => choose('segment'),
              tool === 'segment',
            )}
            {action(
              '斐波那契回撤',
              'fibonacciLine',
              () => choose('fibonacciLine'),
              tool === 'fibonacciLine',
            )}
            {action(
              'XABCD 形态',
              'xabcd',
              () => choose('xabcd'),
              tool === 'xabcd',
            )}
            <span className="my-1 w-6 border-t border-edge" />
            {action(
              mode === 'normal'
                ? '磁吸：关闭'
                : mode === 'weak_magnet'
                  ? '磁吸：弱'
                  : '磁吸：强',
              mode === 'strong_magnet' ? 'strong_magnet' : 'weak_magnet',
              () =>
                setMode(
                  (mode === 'normal'
                    ? 'weak_magnet'
                    : mode === 'weak_magnet'
                      ? 'strong_magnet'
                      : 'normal') as OverlayMode,
                ),
              mode !== 'normal',
            )}
            {action(
              locked ? '解锁绘图' : '锁定绘图',
              locked ? 'lock' : 'unlock',
              () => {
                chart?.overrideOverlay({ groupId, lock: !locked })
                setLocked(!locked)
                save.current()
              },
              locked,
            )}
            {action(
              hidden ? '显示绘图' : '隐藏绘图',
              hidden ? 'invisible' : 'visible',
              () => setHidden(!hidden),
              hidden,
            )}
            {action('清除绘图', 'remove', () => {
              chart?.removeOverlay({ groupId })
              setTool(null)
              save.current()
            })}
          </div>
        )}
      </div>
      {error && (
        <output className="absolute bottom-8 left-12 rounded bg-panel p-2 text-xs text-loss">
          {error}
        </output>
      )}
    </aside>
  )
}
