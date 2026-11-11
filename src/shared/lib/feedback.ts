import type { FundingRecord } from '../../features/assets/lib/funding.ts'

export type FeedbackTone = 'success' | 'error' | 'warning' | 'info' | 'loading'

export function tradeFeedbackTone(state: string) {
  if (state === 'rejected') return 'error'
  if (
    [
      'resting',
      'filled',
      'accepted',
      'confirmed',
      'canceled',
      'waiting',
    ].includes(state)
  )
    return 'success'
  return 'warning'
}

export function fundingFeedback(
  kind: FundingRecord['kind'],
  status: FundingRecord['status'],
): { tone: FeedbackTone; text: string } {
  if (status === 'unknown')
    return {
      tone: 'warning',
      text: '资金请求结果待确认，请先核对记录，不要重复提交。',
    }
  if (status === 'reverted')
    return {
      tone: 'error',
      text: '本次资金操作未完成，请在资金记录中核对原因。',
    }
  if (kind === 'approve' && status === 'confirmed')
    return {
      tone: 'success',
      text: 'USDC 授权已确认；存款到账请以资金记录为准。',
    }
  if (status === 'credited' || (kind === 'transfer' && status === 'confirmed'))
    return {
      tone: 'success',
      text:
        kind === 'withdraw'
          ? '提款已到账，请核对目标链钱包余额。'
          : kind === 'transfer'
            ? 'USDC 划转已确认。'
            : '存款已到账，账户余额正在更新。',
    }
  return {
    tone: 'info',
    text:
      status === 'confirmed'
        ? '源链交易已确认，仍需核对到账，请勿重复存入。'
        : '资金请求已提交，请在资金记录中查询进度；提交不代表到账。',
  }
}
