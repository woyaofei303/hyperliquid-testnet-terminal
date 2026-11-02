import Link from 'next/link'

export default function NotFound() {
  return (
    <main className="flex h-dvh flex-col items-center justify-center gap-4 bg-panel px-6 text-ink">
      <span className="text-xs text-muted">404</span>
      <h1 className="text-lg font-medium">页面不存在</h1>
      <p className="text-sm text-muted">请检查地址，或返回交易页面。</p>
      <Link
        href="/"
        className="rounded-md bg-brand px-5 py-2 text-sm font-medium text-panel"
      >
        返回交易页
      </Link>
    </main>
  )
}
