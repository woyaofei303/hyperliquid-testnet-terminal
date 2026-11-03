import assert from 'node:assert/strict'
import test from 'node:test'
import { createStoredBoolean } from '../../packages/utils/storage.ts'

test('确认偏好沿用旧 key，同页订阅、跨标签、清除和非法值都安全恢复', () => {
  const values = new Map<string, string>([['hl-skip-order-confirm', 'true']])
  const events = new EventTarget()
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window')
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      localStorage: {
        getItem: (k: string) => values.get(k) ?? null,
        setItem: (k: string, v: string) => values.set(k, v),
      },
      addEventListener: events.addEventListener.bind(events),
      removeEventListener: events.removeEventListener.bind(events),
    },
  })
  try {
    const pref = createStoredBoolean('hl-skip-order-confirm', false)
    const observed: boolean[] = []
    const unsubscribe = pref.subscribe(() => observed.push(pref.get()))
    assert.equal(pref.get(), true)
    pref.set(false)
    pref.set(false)
    assert.deepEqual(observed, [false])
    values.set(pref.key, 'true')
    events.dispatchEvent(Object.assign(new Event('storage'), { key: pref.key }))
    assert.equal(observed.at(-1), true)
    values.clear()
    events.dispatchEvent(Object.assign(new Event('storage'), { key: null }))
    assert.equal(observed.at(-1), false)
    values.set(pref.key, 'corrupted')
    assert.equal(pref.get(), false)
    unsubscribe()
    pref.set(true)
    assert.equal(observed.length, 3)
  } finally {
    if (previous) Object.defineProperty(globalThis, 'window', previous)
    else Reflect.deleteProperty(globalThis, 'window')
  }
})
