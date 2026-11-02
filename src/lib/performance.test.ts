import assert from 'node:assert/strict'
import test from 'node:test'
import { createFrameBatch } from './frame-batch.ts'
import {
  adjustPressure,
  createPerformanceMetrics,
  type PressureState,
} from './performance.ts'

test('一万次更新只挂起一个 rAF，提交最新状态；销毁后不执行旧任务', () => {
  const callbacks = new Map<number, FrameRequestCallback>()
  let next = 0
  let value = 0
  let committed = 0
  let calls = 0
  const batch = createFrameBatch(
    'book',
    () => {
      committed = value
      calls++
    },
    {
      request: (callback) => {
        callbacks.set(++next, callback)
        return next
      },
      cancel: (id) => {
        callbacks.delete(id)
      },
    },
  )
  for (let i = 1; i <= 10000; i++) {
    value = i
    batch.schedule()
  }
  assert.equal(callbacks.size, 1)
  const callback = callbacks.values().next().value
  assert.ok(callback)
  callbacks.clear()
  callback(16)
  assert.equal(committed, 10000)
  assert.equal(calls, 1)
  batch.schedule()
  batch.cancel()
  batch.schedule()
  assert.equal(callbacks.size, 0)
  assert.equal(calls, 1)
})
test('短时抖动不降级，持续超载才降级；连续健康十秒恢复一级', () => {
  let state: PressureState = { level: 0, bad: 0, healthy: 0, reason: '' }
  state = adjustPressure(state, '图表耗时高')
  state = adjustPressure(state, '')
  assert.equal(state.level, 0)
  for (let i = 0; i < 3; i++) state = adjustPressure(state, '图表耗时高')
  assert.equal(state.level, 1)
  for (let i = 0; i < 10; i++) state = adjustPressure(state, '')
  assert.equal(state.level, 0)
  assert.equal(state.reason, '')
  assert.equal(adjustPressure(state, '堆内存临界', true).level, 2)
})
test('指标按模块汇总且成本样本有界；后台和单纯高消息率不会误降级', () => {
  const metrics = createPerformanceMetrics()
  for (let i = 0; i < 10000; i++) {
    metrics.input('book')
    metrics.record('book', i < 9880 ? 1000 : 1)
  }
  metrics.queue('book', 1, 9999)
  metrics.retain('book', 40)
  const args = {
    seconds: 1,
    frames: 60,
    slowFrames: 0,
    longTasks: 0,
    heapUsed: null,
    heapLimit: null,
    hidden: false,
  }
  let data = metrics.sample(args)
  assert.equal(data.modules.find((row) => row.id === 'book')?.p95, 1)
  assert.equal(data.modules.find((row) => row.id === 'book')?.totalInput, 10000)
  assert.equal(data.level, 0)
  for (let i = 0; i < 4; i++) {
    metrics.input('book', 10000)
    data = metrics.sample({ ...args, hidden: true, longTasks: 10 })
  }
  assert.equal(data.level, 0)
  for (let i = 0; i < 3; i++) {
    metrics.input('book', 10000)
    data = metrics.sample({ ...args, longTasks: 10 })
  }
  assert.equal(data.level, 1)
})
