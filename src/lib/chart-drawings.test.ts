import assert from 'node:assert/strict'
import test from 'node:test'
import { drawingStorageKey, readDrawings } from './chart-drawings.ts'

test('绘图持久化按市场隔离，仅恢复支持的绘图和有限坐标', () => {
  assert.notEqual(drawingStorageKey('BTC'), drawingStorageKey('@7'))
  assert.deepEqual(readDrawings(null), [])
  const line = {
    name: 'horizontalStraightLine',
    points: [{ timestamp: 1700000000000, value: 70000, dataIndex: 8 }],
    lock: true,
    onClose: 'malicious',
    groupId: 'trade',
  }
  assert.deepEqual(readDrawings(JSON.stringify([line])), [
    {
      name: line.name,
      points: [{ timestamp: 1700000000000, value: 70000 }],
      lock: true,
    },
  ])
  for (const raw of [
    'bad',
    '{}',
    '[null]',
    JSON.stringify([{ ...line, name: 'tpsl-close-button' }]),
    JSON.stringify([{ ...line, points: [{ timestamp: 1, value: '70000' }] }]),
    JSON.stringify(Array(201).fill(line)),
  ])
    assert.throws(() => readDrawings(raw))
})
