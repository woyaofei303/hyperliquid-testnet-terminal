import assert from 'node:assert/strict'
import { readArchive } from './archive.ts'
import { HORIZONS, samplePoints } from './followups.ts'
import { parseQuote } from './mainnet-read.ts'
import { COINS } from './opportunities.ts'
import {
  createStudy,
  STUDY_COST_BPS,
  STUDY_METHOD,
  type Study,
} from './study.ts'

function object(value: unknown): Record<string, unknown> {
  assert.ok(
    value && typeof value === 'object' && !Array.isArray(value),
    '对象无效',
  )
  return value as Record<string, unknown>
}
function time(value: unknown) {
  assert.ok(
    typeof value === 'number' &&
      Number.isSafeInteger(value) &&
      value >= 0 &&
      Number.isFinite(new Date(value).getTime()),
    '时间无效',
  )
  return value
}
function reason(value: unknown) {
  assert.ok(
    typeof value === 'string' && value.length > 0 && value.length <= 300,
    '缺测原因无效',
  )
  return value
}
function quote(value: unknown, capturedAt: number) {
  const row = object(value),
    receivedAt = time(row.receivedAt)
  assert.ok(receivedAt <= capturedAt, '接收时间晚于存档')
  return parseQuote(
    {
      coin: row.coin,
      time: row.time,
      levels: [
        row.bid === null ? [] : [row.bid],
        row.ask === null ? [] : [row.ask],
      ],
    },
    receivedAt,
  )
}

export function readStudy(checkpoint: string, protocol: string, now: number) {
  assert.ok(
    checkpoint.length <= 20_000_000 && protocol.length <= 1_000_000,
    '批次文件过大',
  )
  const root = object(JSON.parse(checkpoint)),
    saved = object(root.study),
    plan = object(JSON.parse(protocol))
  assert.equal(saved.version, 1, '批次版本不支持')
  const capturedAt = time(root.capturedAt),
    startedAt = time(saved.startedAt),
    enrollmentEndsAt = time(saved.enrollmentEndsAt)
  assert.ok(
    capturedAt >= startedAt && capturedAt <= now + 10000,
    '存档时间无效',
  )
  const expected = createStudy(
    startedAt,
    (enrollmentEndsAt - startedAt) / 60000,
  )
  assert.equal(saved.endsAt, expected.endsAt)
  assert.ok(
    ['collecting', 'following', 'complete', 'interrupted', 'failed'].includes(
      String(root.status),
    ),
    '批次状态无效',
  )
  for (const [key, value] of Object.entries({
    version: 1,
    method: STUDY_METHOD,
    network: 'hyperliquid-mainnet',
    readOnly: true,
    startedAt,
    enrollmentEndsAt,
    endsAt: expected.endsAt,
    coins: COINS,
    maxAccounts: 6,
    uniqueSignal: 'account+coin',
    horizonsMinutes: HORIZONS,
    extraRoundTripCostBps: STUDY_COST_BPS,
    controls: expected.controls.map(({ coin, side, scheduledAt }) => ({
      coin,
      side,
      scheduledAt,
    })),
  }))
    assert.deepEqual(plan[key], value, `批次协议不兼容：${key}`)
  const signals = readArchive(
    JSON.stringify({ version: 1, followups: saved.signals, cooldownUntil: 0 }),
    capturedAt,
  ).followups
  assert.deepEqual(
    JSON.parse(JSON.stringify(signals)),
    saved.signals,
    '信号存档包含未更新的过期采样点',
  )
  assert.equal(
    new Set(signals.map((row) => `${row.address}:${row.coin}`)).size,
    signals.length,
    '重复账户币种',
  )
  assert.ok(
    new Set(signals.map((row) => row.address)).size <= 6,
    '账户超出批次范围',
  )
  assert.ok(
    signals.every(
      (row) => row.detectedAt >= startedAt && row.detectedAt < enrollmentEndsAt,
    ),
    '信号越过入组窗口',
  )
  assert.ok(
    Array.isArray(saved.controls) &&
      saved.controls.length === expected.controls.length,
    '对照数量无效',
  )
  const controls = saved.controls.map(
    (value, index): Study['controls'][number] => {
      const row = object(value),
        original = expected.controls[index],
        detectedAt = time(row.detectedAt)
      for (const key of ['coin', 'side', 'scheduledAt'] as const)
        assert.equal(row[key], original[key], '预设对照已变更')
      assert.ok(
        detectedAt >= original.scheduledAt &&
          detectedAt <= original.scheduledAt + 10000,
        '对照起点越过采样窗口',
      )
      let entry: Study['controls'][number]['entry'] = null
      const entryQuote =
        row.entryQuote === undefined
          ? undefined
          : quote(row.entryQuote, capturedAt)
      if (row.entry !== null) {
        const data = object(row.entry)
        if (data.available === true) {
          assert.ok(
            entryQuote &&
              entryQuote.coin === original.coin &&
              entryQuote.time >= original.scheduledAt &&
              entryQuote.time <= detectedAt + 10000 &&
              entryQuote.receivedAt >= original.scheduledAt &&
              entryQuote.receivedAt <= detectedAt &&
              detectedAt <= capturedAt,
            '对照起点盘口无效',
          )
          const level = entryQuote[original.side === 'long' ? 'ask' : 'bid']
          assert.ok(level)
          assert.equal(data.price, level.px, '对照起点价格不一致')
          entry = { available: true, price: level.px }
        } else {
          assert.equal(data.available, false)
          assert.ok(
            capturedAt > original.scheduledAt + 10000,
            '对照未到缺测期限',
          )
          entry = { available: false, reason: reason(data.reason) }
        }
      } else
        assert.ok(
          capturedAt <= original.scheduledAt + 10000,
          '过期对照仍无起点状态',
        )
      if (!entry?.available) {
        assert.equal(detectedAt, original.scheduledAt)
        assert.equal(entryQuote, undefined)
      }
      assert.ok(
        Array.isArray(row.points) && row.points.length === 3,
        '采样点数量无效',
      )
      const points = row.points.map(
        (value, index): Study['controls'][number]['points'][number] => {
          const point = object(value),
            minutes = HORIZONS[index],
            dueAt = detectedAt + minutes * 60000
          assert.equal(point.minutes, minutes)
          assert.equal(point.dueAt, dueAt)
          if (point.status === 'missing') {
            assert.ok(entry !== null)
            return {
              minutes,
              dueAt,
              status: 'missing',
              reason: reason(point.reason),
            }
          }
          assert.ok(entry === null || entry.available, '无起点却有采样结果')
          if (point.status === 'pending') {
            assert.ok(capturedAt <= dueAt + 10000)
            return { minutes, dueAt, status: 'pending' }
          }
          assert.equal(point.status, 'measured')
          assert.ok(entry?.available)
          const sampledAt = time(point.sampledAt),
            book = quote(point.quote, capturedAt)
          assert.ok(sampledAt <= capturedAt)
          const replay = samplePoints(
            {
              ...original,
              entry,
              points: [{ minutes, dueAt, status: 'pending' }],
            },
            { [original.coin]: book },
            sampledAt,
            true,
          )[0]
          assert.equal(replay.status, 'measured')
          assert.ok(replay.status === 'measured')
          assert.equal(replay.percent, point.percent, '对照收益与报价不一致')
          return replay
        },
      )
      return {
        ...original,
        detectedAt,
        entry,
        ...(entryQuote ? { entryQuote } : {}),
        points,
      }
    },
  )
  const study: Study = { ...expected, signals, controls }
  if (root.status === 'complete') {
    assert.ok(capturedAt >= study.endsAt, '提前宣告批次完成')
    assert.ok(
      [...signals, ...controls].every((row) =>
        row.points.every((point) => point.status !== 'pending'),
      ),
      '完整批次仍有待采样',
    )
  }
  return { study, capturedAt, status: String(root.status) }
}
