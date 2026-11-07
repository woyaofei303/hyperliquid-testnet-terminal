export function marketMetadata(
  pair: string,
  kind: string,
  price: string | undefined,
  locale: string,
) {
  const english = locale === 'en-US'
  const product =
    kind === 'spot'
      ? english
        ? 'Spot'
        : '现货'
      : kind === 'outcome'
        ? english
          ? 'Prediction'
          : '预测'
        : english
          ? 'Perpetual'
          : '永续'
  const valid = price && Number.isFinite(Number(price)) && Number(price) > 0
  const formatted = valid
    ? new Intl.NumberFormat('en-US', { maximumFractionDigits: 8 }).format(
        Number(price),
      )
    : ''
  return {
    title: `${formatted ? `${formatted} | ` : ''}${pair} ${product} | Hyperliquid`,
    description: english
      ? `${pair} ${product} trading on Hyperliquid: live order book, charts, orders and positions.`
      : `Hyperliquid ${pair} ${product}交易：实时订单簿、K 线、订单与仓位管理。`,
    keywords: `${pair}, ${product}, Hyperliquid, Perp DEX, Web3`,
  }
}
