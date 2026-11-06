import type { MarketContext } from './hyperliquid.ts'
import type { TicketInput } from './order-ticket.ts'
import { formatOrderPrice } from './orders.ts'

export type BookPriceSelection = { coin: string; price: string }

export type OrderFormFields = Omit<
  TicketInput,
  'market' | 'mark' | 'size' | 'slippageBps'
> & {
  amount: string
  unit: 'base' | 'usdc'
  slippage: string
  protection: boolean
  sizeSkew: string
}
export const defaultOrderFields = (market: MarketContext): OrderFormFields => ({
  side: 'buy',
  kind: market.kind === 'outcome' ? 'market' : 'limit',
  price: market.context.markPx
    ? formatOrderPrice(market.context.markPx, market)
    : '',
  amount: '',
  unit: market.kind === 'outcome' ? 'usdc' : 'base',
  reduceOnly: false,
  slippage: market.kind === 'outcome' ? '8' : '0.5',
  protection: false,
  tif: 'Gtc',
  trigger: '',
  takeProfit: '',
  stopLoss: '',
  upperPrice: '',
  levels: '5',
  distribution: 'equal',
  sizeSkew: '1',
  minutes: '30',
  randomize: true,
  twapTrigger: '',
  twapAbove: true,
  twapLimit: '',
  retracement: '1',
  retracementUnit: 'pct',
  activationPrice: '',
})
