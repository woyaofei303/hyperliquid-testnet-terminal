import type { info, MarketContext } from './hyperliquid.ts'
import type { Market } from './orders.ts'

type SpotMeta = Awaited<ReturnType<typeof info.spotMetaAndAssetCtxs>>
type PerpMeta = Awaited<ReturnType<typeof info.allPerpMetas>>
type Outcomes = Awaited<ReturnType<typeof info.outcomeMeta>>
type Templates = Awaited<ReturnType<typeof info.outcomeTemplates>>
export const isCash = (market?: Market) =>
  market?.kind === 'spot' || market?.kind === 'outcome'
export const baseName = (market: Market) => market.base ?? market.name
export const quoteName = (market?: Market) => market?.quote ?? 'USDC'
export const marketLabel = (market: Market) =>
  market.label ?? `${baseName(market)} / ${quoteName(market)}`
export const pricePrecision = (market: Market) =>
  market.kind === 'outcome'
    ? 5
    : Math.max(0, (market.kind === 'spot' ? 8 : 6) - market.szDecimals)
const emptyContext = () => ({ markPx: '', prevDayPx: '', dayNtlVlm: '' })

export function cashMarkets([meta, contexts]: SpotMeta): MarketContext[] {
  const byCoin = new Map(contexts.map((c) => [c.coin, c]))
  const tokens = new Map(meta.tokens.map((t) => [t.index, t]))
  return meta.universe.flatMap((pair) => {
    const base = tokens.get(pair.tokens[0]),
      quote = tokens.get(pair.tokens[1])
    if (!base || !quote || base.szDecimals > 8) return []
    return [
      {
        name: pair.name,
        asset: 10000 + pair.index,
        kind: 'spot' as const,
        base: base.name,
        quote: quote.name,
        baseToken: base.index,
        quoteToken: quote.index,
        szDecimals: base.szDecimals,
        maxLeverage: 1,
        canonical: pair.isCanonical,
        context: byCoin.get(pair.name) ?? emptyContext(),
      },
    ]
  })
}
export function builderMarkets(
  metas: PerpMeta,
  tokens: SpotMeta[0]['tokens'],
): MarketContext[] {
  return metas.flatMap((meta, dexIndex) =>
    dexIndex === 0
      ? []
      : meta.universe.flatMap((item, index) => {
          const quote = tokens.find((t) => t.index === meta.collateralToken)
          if (item.isDelisted || !quote || !item.name.includes(':')) return []
          return [
            {
              ...item,
              kind: 'perp' as const,
              dex: item.name.split(':')[0],
              asset: 100000 + dexIndex * 10000 + index,
              quote: quote.name,
              quoteToken: quote.index,
              base: item.name.split(':').slice(1).join(':'),
              context: emptyContext(),
            },
          ]
        }),
  )
}
function expand(text: string, values: Record<string, string>) {
  return text.replace(
    /\{([^}]+)\}/g,
    (original, key: string) => values[key] ?? original,
  )
}
export function predictionMarkets(
  meta: Outcomes,
  templates: Templates,
): MarketContext[] {
  const render = (item: { name: string; description: string }) => {
    const values = Object.fromEntries(
      item.description.split('|').flatMap((part) => {
        const split = part.indexOf(':')
        return split < 0 ? [] : [[part.slice(0, split), part.slice(split + 1)]]
      }),
    )
    const template = templates.find((t) => item.name === `template:${t.id}`)
    return {
      values,
      title: template ? expand(template.name, values) : item.name,
      description: template
        ? expand(template.description, values)
        : item.description,
    }
  }
  return meta.outcomes.flatMap((item) => {
    const resolved = render(item)
    const parent = meta.questions?.find(
      (q) =>
        q.fallbackOutcome === item.outcome ||
        q.namedOutcomes.includes(item.outcome),
    )
    const question = parent ? render(parent) : null
    const values = resolved.values
    const title = question
      ? `${question.title} / ${resolved.title}`
      : resolved.title
    const description = question
      ? `${question.description}\n\n${resolved.description}`
      : resolved.description
    return item.sideSpecs.slice(0, 2).map((side, index) => {
      const encoding = 10 * item.outcome + index
      const sideName = expand(side.name.replace(/^template:/, ''), values)
      return {
        name: `#${encoding}`,
        asset: 100000000 + encoding,
        kind: 'outcome' as const,
        base: sideName,
        quote: item.quoteToken,
        label: `${title} · ${sideName}`,
        outcome: item.outcome,
        paired: `#${10 * item.outcome + (1 - index)}`,
        description,
        balanceCoin: `+${encoding}`,
        szDecimals: 0,
        maxLeverage: 1,
        context: emptyContext(),
      }
    })
  })
}
