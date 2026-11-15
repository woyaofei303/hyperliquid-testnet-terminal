import assert from 'node:assert/strict'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import test, { type TestContext } from 'node:test'
import { collectStudy } from './collector.ts'

function workspace() {
  const parent = 'output-tdd/opportunity-study/tests'
  mkdirSync(parent, { recursive: true })
  return mkdtempSync(join(parent, 'run-'))
}

function mockSocket(t: TestContext, onConnect: () => void) {
  const original = globalThis.WebSocket
  let closed = 0
  Object.defineProperty(globalThis, 'WebSocket', {
    value: class {
      constructor() {
        queueMicrotask(onConnect)
      }
      close() {
        closed++
      }
    },
  })
  t.after(() => {
    globalThis.WebSocket = original
  })
  return () => closed
}

test('已有批次目录拒绝覆盖，非法时长和已取消任务不创建批次', async (t) => {
  const root = workspace()
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const sockets = t.mock.method(globalThis, 'WebSocket', () => {
    throw new Error('不应联网')
  })
  writeFileSync(join(root, 'original.txt'), 'keep')
  await assert.rejects(
    collectStudy(root, 1, new AbortController().signal),
    /EEXIST/,
  )
  assert.equal(readFileSync(join(root, 'original.txt'), 'utf8'), 'keep')
  await assert.rejects(
    collectStudy(join(root, 'invalid'), 0, new AbortController().signal),
    /时长/,
  )
  await assert.rejects(
    collectStudy(join(root, 'aborted'), 1, AbortSignal.abort()),
  )
  assert.deepEqual(readdirSync(root), ['original.txt'])
  assert.equal(sockets.mock.callCount(), 0)
})

test('停止进程关闭订阅并保存未完成状态，不把尚未到期样本冒充已完成', async (t) => {
  const root = workspace(),
    output = join(root, 'batch')
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const abort = new AbortController()
  const closed = mockSocket(t, () => abort.abort())
  const result = await collectStudy(output, 1, abort.signal)
  assert.equal(result.status, 'interrupted')
  assert.equal(closed(), 1)
  const saved = JSON.parse(
    readFileSync(join(output, 'checkpoint.json'), 'utf8'),
  )
  assert.equal(saved.status, 'interrupted')
  assert.equal(saved.study.signals.length, 0)
  assert.equal(saved.study.controls.length, 6)
  assert.ok(
    saved.study.controls.every((row: { entry: unknown }) => row.entry === null),
  )
  assert.ok(
    readFileSync(join(output, 'report.md'), 'utf8').includes('批次未完成'),
  )
  assert.equal(existsSync(join(output, 'checkpoint.json.tmp')), false)
})

test('保存失败结束采集并保留上次完整检查点，不继续积累未保存结果', async (t) => {
  const root = workspace(),
    output = join(root, 'batch')
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const abort = new AbortController()
  const closed = mockSocket(t, () => {
    mkdirSync(join(output, 'checkpoint.json.tmp'))
    abort.abort()
  })
  await assert.rejects(collectStudy(output, 1, abort.signal), /EISDIR/)
  assert.equal(closed(), 1)
  assert.equal(
    JSON.parse(readFileSync(join(output, 'checkpoint.json'), 'utf8')).status,
    'collecting',
  )
})
