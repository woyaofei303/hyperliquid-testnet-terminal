import type { NextConfig } from 'next'

const config: NextConfig = {
  output: process.env.STATIC_EXPORT === '1' ? 'export' : undefined,
  images: { unoptimized: process.env.STATIC_EXPORT === '1' },
  turbopack: { root: process.cwd() },
  devIndicators: false,
  reactProductionProfiling: true,
  transpilePackages: ['@fameex/ui', '@fameex/utils', '@fameex/kline'],
}
export default config
