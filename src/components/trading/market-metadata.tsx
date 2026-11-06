import type { TerminalModel } from '@/hooks/use-terminal'
import { t, useLocale } from '@/i18n'
import { marketLabel } from '@/lib/market-catalog'
import { marketMetadata } from '@/lib/market-metadata'

export function MarketMetadata({
  model,
  outcomes = false,
}: {
  model: TerminalModel
  outcomes?: boolean
}) {
  const locale = useLocale()
  const { market, feed } = model
  const pair = market ? marketLabel(market) : 'BTC / USDC'
  const price = feed.stale
    ? undefined
    : (feed.trades[0]?.px ?? market?.context.markPx)
  const meta = marketMetadata(pair, market?.kind ?? 'perp', price, locale)
  if (outcomes) {
    meta.title = `${t('预测市场')} | FameEX Testnet`
    meta.description = t('选择事件与结果，使用测试网资产参与预测。')
  }
  // React 19 将标签提升到 head；只保留一个所有者，避免与异步注入的 Next 元数据重复。
  return (
    <>
      <title>{meta.title}</title>
      <meta name="description" content={meta.description} />
      <meta name="keywords" content={meta.keywords} />
      <meta property="og:title" content={meta.title} />
      <meta property="og:description" content={meta.description} />
      <meta property="og:type" content="website" />
      <meta property="og:site_name" content="Hyperliquid Terminal" />
      <meta name="twitter:card" content="summary" />
      <meta name="twitter:title" content={meta.title} />
      <meta name="twitter:description" content={meta.description} />
    </>
  )
}
