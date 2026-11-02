'use client'

export function ErrorFallback({
  name,
  onRetry,
  className = '',
}: {
  name: string
  onRetry: () => void
  className?: string
}) {
  return (
    <section
      role="alert"
      className={`flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center gap-3 overflow-auto rounded-sm border border-edge bg-panel p-5 text-center text-ink ${className}`}
    >
      <span
        aria-hidden="true"
        className="flex size-9 shrink-0 items-center justify-center rounded-full bg-loss/10 text-lg text-loss"
      >
        !
      </span>
      <h2 className="text-sm font-medium">{name}暂时无法显示</h2>
      <p className="max-w-sm text-xs leading-5 text-muted">
        恢复仅重新加载界面。已提交的订单和资金请求请先核对记录，不要重复提交。
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="shrink-0 rounded-md bg-brand px-4 py-2 text-xs font-medium text-panel hover:bg-brand/80"
      >
        恢复{name}
      </button>
    </section>
  )
}
