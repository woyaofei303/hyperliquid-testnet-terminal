import assert from 'node:assert/strict'
import test from 'node:test'
import { fundingFeedback, tradeFeedbackTone } from './feedback.ts'

test('交易提示以业务回报分类，拒单和未知结果不能提示成功', () => {
  assert.equal(tradeFeedbackTone('resting'), 'success')
  assert.equal(tradeFeedbackTone('filled'), 'success')
  assert.equal(tradeFeedbackTone('rejected'), 'error')
  assert.equal(tradeFeedbackTone('partial-rejected'), 'warning')
  assert.equal(tradeFeedbackTone('pending'), 'warning')
  assert.equal(tradeFeedbackTone('unconfirmed'), 'warning')
  assert.equal(tradeFeedbackTone('unrecognized-state'), 'warning')
})

test('资金提示区分源链确认和到账，不把待确认或授权成功当作存款到账', () => {
  assert.equal(fundingFeedback('deposit', 'confirmed').tone, 'info')
  assert.match(fundingFeedback('deposit', 'confirmed').text, /仍需核对到账/)
  assert.equal(fundingFeedback('deposit', 'unknown').tone, 'warning')
  assert.equal(fundingFeedback('deposit', 'credited').tone, 'success')
  assert.equal(fundingFeedback('withdraw', 'submitted').tone, 'info')
  assert.equal(fundingFeedback('withdraw', 'reverted').tone, 'error')
  assert.equal(fundingFeedback('transfer', 'confirmed').tone, 'success')
  assert.match(fundingFeedback('approve', 'confirmed').text, /授权已确认/)
})
