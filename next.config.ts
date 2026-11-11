import type { NextConfig } from 'next'

const config: NextConfig = {
  output: process.env.STATIC_EXPORT === '1' ? 'export' : undefined,
  images: { unoptimized: process.env.STATIC_EXPORT === '1' },
  turbopack: { root: process.cwd() },
  devIndicators: false,
  // 沿用性能验收开关；普通发布不向用户展示内部指标。
  env: { NEXT_PUBLIC_PERF_CHECK: process.env.PERF_CHECK === '1' ? '1' : '0' },
  reactProductionProfiling: true,
  transpilePackages: ['@fameex/ui', '@fameex/utils', '@fameex/kline'],
}
export default config
