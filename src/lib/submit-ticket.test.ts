import assert from 'node:assert/strict'
import test from 'node:test'
import { batchOrderResults } from './submit-ticket.ts'

const order = {
  a: 0,
  b: true,
  p: '70000',
  s: '0.01',
  r: false,
  t: { limit: { tif: 'Gtc' as const } },
}
test('批量回报逐笔处理部分拒绝与等待激活，不能误报全部成功', () => {
  const result = batchOrderResults(
    {
      status: 'ok',
      response: {
        type: 'order',
        data: {
          statuses: [
            { resting: { oid: 1 } },
            { error: 'Insufficient margin' },
            'waitingForTrigger',
          ],
        },
      },
    },
    [order, order, order],
  )
  assert.deepEqual(
    result.map((item) => item.state),
    ['resting', 'rejected', 'waiting'],
  )
  assert.throws(
    () =>
      batchOrderResults(
        { status: 'ok', response: { type: 'order', data: { statuses: [] } } },
        [order],
      ),
    /数量/,
  )
})
