'use client'

import { Button, Spinner } from '@fameex/ui'
import { getToastQueue, ToastProvider } from '@heroui/react'
import { useIsPresent } from 'framer-motion'
import { type ComponentPropsWithRef, useEffect } from 'react'
import type { FeedbackTone } from '@/lib/feedback'

export type { FeedbackTone } from '@/lib/feedback'

const labels = {
  success: '操作成功',
  error: '操作未完成',
  warning: '请注意',
  info: '提示',
  loading: '正在处理',
}
const colors = {
  success: 'success',
  error: 'danger',
  warning: 'warning',
  info: 'primary',
  loading: 'primary',
} as const
const active = new Map<
  string,
  { key: string; tone: FeedbackTone; text: string }
>()

export function dismissNotification(channel: string) {
  const previous = active.get(channel)
  if (previous) getToastQueue().close(previous.key)
  active.delete(channel)
}

export function notify(tone: FeedbackTone, text: string, channel = 'terminal') {
  if (!text) return
  const queue = getToastQueue()
  for (const [id, toast] of active) {
    if (!queue.visibleToasts.some((item) => item.key === toast.key))
      active.delete(id)
  }
  const previous = active.get(channel)
  if (previous?.tone === tone && previous.text === text) return
  dismissNotification(channel)
  // 限制实际队列，避免重复网络错误在隐藏通知中持续堆积。
  if (queue.visibleToasts.length >= 3) {
    const oldest = queue.visibleToasts.at(-1)
    if (oldest) queue.close(oldest.key)
  }
  const key = queue.add({
    title: labels[tone],
    description: (
      <output className="block" data-feedback={tone}>
        {text}
      </output>
    ),
    color: colors[tone],
    severity: colors[tone],
    classNames: {
      base: 'border-edge bg-surface text-ink shadow-xl max-w-[calc(100vw-24px)]',
      title: 'text-sm font-medium text-ink',
      description:
        'text-xs leading-5 text-ink break-words max-h-40 overflow-y-auto',
      icon:
        tone === 'error'
          ? 'text-loss'
          : tone === 'warning'
            ? 'text-amber-300'
            : tone === 'success'
              ? 'text-mint'
              : 'text-accent',
    },
    timeout:
      tone === 'loading' || tone === 'error'
        ? 0
        : tone === 'success'
          ? 4500
          : 8000,
    icon: tone === 'loading' ? <Spinner size="sm" /> : undefined,
    hideCloseButton: true,
    endContent: (
      <Button
        isIconOnly
        size="sm"
        variant="light"
        color="default"
        aria-label="关闭提示"
        onPress={() => dismissNotification(channel)}
        className="text-muted hover:text-ink"
      >
        ×
      </Button>
    ),
    onClose: () => {
      if (active.get(channel)?.key === key) active.delete(channel)
    },
  })
  active.set(channel, { key, tone, text })
}

function NotificationSurface({
  className,
  ...props
}: ComponentPropsWithRef<'div'>) {
  const present = useIsPresent()
  // 组件库禁用动画后仍保留退出节点一帧，立即隐藏，避免挤动下一条提示。
  return (
    <div
      {...props}
      className={`${className ?? ''} ${present ? '' : 'hidden!'}`}
    />
  )
}

const toastProps = {
  as: NotificationSurface,
  radius: 'sm',
  variant: 'bordered',
} as const

export function Notifications() {
  useEffect(() => {
    const offline = () =>
      notify(
        'warning',
        '网络已断开，请等待行情和余额恢复后操作。已提交请求需核对结果。',
        'network',
      )
    const online = () =>
      notify('info', '网络连接已恢复，请等待行情与余额更新后操作。', 'network')
    const unexpected = () =>
      notify(
        'error',
        '页面发生未预期异常。请先核对当前委托和资金记录，再刷新页面；不要直接重复提交。',
        'runtime',
      )
    const onError = (event: ErrorEvent) => {
      if (event.error) unexpected()
    }
    window.addEventListener('offline', offline)
    window.addEventListener('online', online)
    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', unexpected)
    if (!navigator.onLine) offline()
    return () => {
      window.removeEventListener('offline', offline)
      window.removeEventListener('online', online)
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', unexpected)
    }
  }, [])
  const regionProps = {
    'aria-label': '全局通知',
    className: 'z-[1300] top-16!',
  }
  return (
    <ToastProvider
      placement="top-center"
      maxVisibleToasts={3}
      disableAnimation
      regionProps={regionProps}
      toastProps={toastProps}
    />
  )
}
