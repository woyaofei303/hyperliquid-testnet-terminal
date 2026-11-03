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
}
export const defaultOrderFields = (market: MarketContext): OrderFormFields => ({
  side: 'buy',
  kind: 'limit',
  price: market.context.markPx
    ? formatOrderPrice(market.context.markPx, market)
    : '',
  amount: '',
  unit: 'base',
  reduceOnly: false,
  slippage: '0.5',
  protection: false,
  tif: 'Gtc',
  trigger: '',
  takeProfit: '',
  stopLoss: '',
  upperPrice: '',
  levels: '5',
  distribution: 'equal',
  minutes: '30',
  randomize: true,
  twapTrigger: '',
  twapAbove: true,
  twapLimit: '',
  retracement: '1',
  retracementUnit: 'pct',
  activationPrice: '',
})
