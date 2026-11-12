import type { UserOutcomeParameters } from '@nktkas/hyperliquid/api/exchange'
import type { AccountSnapshot } from '../../../shared/lib/fameex-testnet.ts'
import { availableBalance } from '../../trading/lib/cash-order.ts'
import {
  type Market,
  Money,
  positiveDecimal,
} from '../../trading/lib/orders.ts'

export const conversionKinds = [
  ['splitOutcome', '拆分结果'],
  ['mergeOutcome', '合并结果'],
  ['mergeQuestion', '合并问题'],
  ['negateOutcome', '取反结果'],
] as const
export type ConversionKind = (typeof conversionKinds)[number][0]
type Balances = AccountSnapshot['spot']['balances']

export function conversionMaximum(
  kind: ConversionKind,
  market: Market,
  balances: Balances,
) {
  if (
    market.kind !== 'outcome' ||
    market.outcome == null ||
    !Number.isSafeInteger(market.outcome) ||
    market.outcome < 0
  )
    throw new Error('预测市场无效')
  const outcome = market.outcome
  const available = (id: number, side: number) =>
    availableBalance(balances, `+${id * 10 + side}`)
  if (kind === 'splitOutcome')
    return new Money(availableBalance(balances, market.quote ?? 'USDC'))
      .floor()
      .toFixed()
  if (kind === 'mergeOutcome')
    return Money.min(available(outcome, 0), available(outcome, 1))
      .floor()
      .toFixed()
  if (
    market.question == null ||
    !Number.isSafeInteger(market.question) ||
    market.question < 0 ||
    !market.questionOutcomes?.includes(outcome)
  )
    throw new Error('该结果未关联有效问题')
  if (kind === 'negateOutcome')
    return new Money(available(outcome, 1)).floor().toFixed()
  if (
    kind !== 'mergeQuestion' ||
    market.questionOutcomes.some((id) => !Number.isSafeInteger(id) || id < 0)
  )
    throw new Error('转换类型或问题无效')
  return Money.min(...market.questionOutcomes.map((id) => available(id, 0)))
    .floor()
    .toFixed()
}

export function prepareConversion(
  kind: ConversionKind,
  market: Market,
  value: string,
  balances: Balances,
): UserOutcomeParameters {
  if (market.outcome == null) throw new Error('预测市场无效')
  const amount = positiveDecimal(value, '转换数量')
  if (!amount.isInteger()) throw new Error('转换数量必须为整数份额')
  if (amount.gt(conversionMaximum(kind, market, balances)))
    throw new Error('转换数量超过可用余额或份额')
  const outcome = market.outcome
  if (kind === 'splitOutcome')
    return { splitOutcome: { outcome, amount: amount.toFixed() } }
  if (kind === 'mergeOutcome')
    return { mergeOutcome: { outcome, amount: amount.toFixed() } }
  if (market.question == null) throw new Error('该结果未关联有效问题')
  if (kind === 'mergeQuestion')
    return {
      mergeQuestion: { question: market.question, amount: amount.toFixed() },
    }
  return {
    negateOutcome: {
      outcome,
      question: market.question,
      amount: amount.toFixed(),
    },
  }
}
