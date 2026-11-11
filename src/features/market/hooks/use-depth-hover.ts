import { useCallback, useLayoutEffect, useRef, useState } from 'react'

type Hover = { side: string; price: string; left: number; top: number }
export function useDepthHover(book: unknown, coin: string) {
  const container = useRef<HTMLElement>(null)
  const point = useRef<{ x: number; y: number } | null>(null)
  const focus = useRef<HTMLElement | null>(null)
  const activeCoin = useRef(coin)
  const [hover, setHover] = useState<Hover | null>(null)
  const close = useCallback(() => {
    point.current = null
    focus.current = null
    setHover(null)
  }, [])
  const update = useCallback((target: Element | null) => {
    const row = target?.closest<HTMLElement>('[data-price]')
    const root = container.current
    const side = row?.closest<HTMLElement>('[data-side]')?.dataset.side
    if (!root || !row || !root.contains(row) || !side) {
      setHover(null)
      return
    }
    const bounds = root.getBoundingClientRect()
    const box = row.getBoundingClientRect()
    const width = Math.min(228, window.innerWidth - 16)
    const left =
      bounds.left >= width + 8
        ? bounds.left - width - 8
        : Math.min(bounds.right + 8, window.innerWidth - width - 8)
    const next = {
      side,
      price: row.dataset.price ?? '',
      left: Math.max(8, left),
      top: Math.max(
        8,
        Math.min(box.top + box.height / 2 - 60, window.innerHeight - 128),
      ),
    }
    setHover((previous) =>
      previous &&
      Object.keys(next).every(
        (key) => previous[key as keyof Hover] === next[key as keyof Hover],
      )
        ? previous
        : next,
    )
  }, [])
  // biome-ignore lint/correctness/useExhaustiveDependencies: 盘口更新会移动鼠标下的档位，需要重新命中 DOM。
  useLayoutEffect(() => {
    if (activeCoin.current !== coin) {
      activeCoin.current = coin
      close()
      return
    }
    if (point.current)
      update(document.elementFromPoint(point.current.x, point.current.y))
    else if (focus.current) update(focus.current)
  }, [book, coin, close, update])
  useLayoutEffect(() => {
    window.addEventListener('resize', close)
    window.addEventListener('scroll', close, true)
    return () => {
      window.removeEventListener('resize', close)
      window.removeEventListener('scroll', close, true)
    }
  }, [close])
  return {
    container,
    hover,
    close,
    events: {
      onPointerMove: (event: React.PointerEvent) => {
        if (event.pointerType === 'touch') return
        point.current = { x: event.clientX, y: event.clientY }
        focus.current = null
        update(event.target instanceof Element ? event.target : null)
      },
      onPointerLeave: close,
      onFocusCapture: (event: React.FocusEvent<HTMLElement>) => {
        focus.current = event.target
        point.current = null
        update(event.target)
      },
      onBlurCapture: close,
      onKeyDown: (event: React.KeyboardEvent) => {
        if (event.key === 'Escape') close()
      },
    },
  }
}
