import type { info, MarketContext } from '../../../shared/lib/fameex-testnet.ts'
import type { Market } from '../../trading/lib/orders.ts'

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
  contexts: Pick<
    SpotMeta[1][number],
    'coin' | 'markPx' | 'prevDayPx' | 'dayNtlVlm'
  >[] = [],
): MarketContext[] {
  const byCoin = new Map(contexts.map((c) => [c.coin, c]))
  const render = (item: { name: string; description: string }) => {
    const values = Object.fromEntries(
      item.description.split('|').flatMap((part) => {
        const split = part.indexOf(':')
        return split < 0 ? [] : [[part.slice(0, split), part.slice(split + 1)]]
      }),
    )
    const template = templates.find((t) => item.name === `template:${t.id}`)
    const displayValues = { ...values }
    for (const [key, type] of template?.keywords ?? []) {
      if (type !== 'dateTime') continue
      const match = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})$/.exec(
        values[key] ?? '',
      )
      if (match)
        displayValues[key] =
          `${match[1]}-${match[2]}-${match[3]} ${match[4]}:${match[5]} UTC`
    }
    return {
      values,
      priceTemplate:
        template?.keywords?.some(([, type]) => type === 'hlPerp') ?? false,
      title: template ? expand(template.name, displayValues) : item.name,
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
        q.namedOutcomes.includes(item.outcome) ||
        q.settledNamedOutcomes.includes(item.outcome),
    )
    const question = parent ? render(parent) : null
    const values = resolved.values
    const rawCategory =
      /metadata=category:([^|\s]+)/.exec(
        question?.description ?? resolved.description,
      )?.[1] ??
      ((question?.priceTemplate ?? resolved.priceTemplate) ? 'price' : 'other')
    const category =
      rawCategory === 'price'
        ? Object.entries(question?.values ?? values).some(
            ([key, value]) =>
              ['perp', 'coin', 'asset', 'shortName', 'instrument'].includes(
                key,
              ) && /^[a-z]+:/.test(value),
          )
          ? 'tradfi'
          : 'crypto'
        : rawCategory
    const eventValues = question?.values ?? values
    const iconCoin =
      category === 'crypto' || category === 'tradfi'
        ? /^(?:[a-z]+:)?(k?[A-Z][A-Z0-9]*)(?:[-/](?:USD|USDC|USDT))?$/.exec(
            eventValues.perp ?? eventValues.shortName ?? '',
          )?.[1]
        : undefined
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
        feeScale:
          'feeScale' in meta && typeof meta.feeScale === 'string'
            ? meta.feeScale
            : undefined,
        deployerFeeScale:
          'deployerFeeScale' in item &&
          typeof item.deployerFeeScale === 'string'
            ? item.deployerFeeScale
            : undefined,
        eventTitle: question?.title ?? resolved.title,
        iconCoin,
        outcomeTitle: resolved.title,
        category,
        venue:
          'venue' in item && typeof item.venue === 'string'
            ? item.venue
            : (item.deployer ?? ''),
        question: parent?.question,
        questionOutcomes: parent
          ? [...parent.namedOutcomes, parent.fallbackOutcome]
          : undefined,
        fallback: parent?.fallbackOutcome === item.outcome,
        settled: parent?.settledNamedOutcomes.includes(item.outcome) ?? false,
        paired: `#${10 * item.outcome + (1 - index)}`,
        description,
        balanceCoin: `+${encoding}`,
        szDecimals: 0,
        maxLeverage: 1,
        context: byCoin.get(`#${encoding}`) ?? emptyContext(),
      }
    })
  })
}

export function predictionEvents(markets: MarketContext[]) {
  const events = new Map<
    string,
    {
      id: string
      title: string
      iconCoin?: string
      category: string
      venue: string
      markets: MarketContext[]
    }
  >()
  for (const market of markets) {
    if (market.kind !== 'outcome' || market.fallback || market.settled) continue
    if (market.question != null && (market.asset - 100000000) % 10 !== 0)
      continue
    const id =
      market.question == null
        ? `outcome:${market.outcome}`
        : `question:${market.question}`
    let event = events.get(id)
    if (!event) {
      event = {
        id,
        title: market.eventTitle ?? marketLabel(market),
        iconCoin: market.iconCoin,
        category: market.category ?? 'other',
        venue: market.venue ?? '',
        markets: [],
      }
      events.set(id, event)
    }
    event.markets.push(market)
  }
  return [...events.values()]
}
