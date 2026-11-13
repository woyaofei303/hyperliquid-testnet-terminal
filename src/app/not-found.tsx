import Image from 'next/image'
import Link from 'next/link'

export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col bg-canvas text-ink">
      <header className="px-6 py-5 sm:px-10">
        <Link
          href="/"
          aria-label="fameex-testnet 首页"
          className="inline-flex items-center gap-2"
        >
          <Image src="/fameex-logo.svg" alt="FameEX" width={109} height={24} />
          <span className="rounded border border-accent/30 px-1.5 py-0.5 text-xs text-accent">
            testnet
          </span>
        </Link>
      </header>
      <main className="flex flex-1 flex-col items-center justify-center px-6 pb-24 text-center">
        <p
          className="select-none text-[112px] font-semibold leading-none tracking-tighter text-muted/35 sm:text-[160px]"
          aria-hidden="true"
        >
          404
        </p>
        <h1 className="mt-6 text-2xl font-semibold sm:text-3xl">页面不存在</h1>
        <p className="mt-3 text-sm leading-6 text-muted">
          链接可能已失效，换个入口继续。
        </p>
        <div className="mt-8 flex w-full max-w-sm flex-col gap-3 sm:flex-row">
          <Link
            href="/"
            className="flex min-h-12 flex-1 items-center justify-center rounded-lg bg-brand px-6 text-sm font-medium text-white hover:brightness-110"
          >
            返回交易页
          </Link>
          <Link
            href="/connect"
            className="flex min-h-12 flex-1 items-center justify-center rounded-lg border border-edge bg-panel px-6 text-sm font-medium hover:bg-surface"
          >
            连接手机 App
          </Link>
        </div>
      </main>
    </div>
  )
}
