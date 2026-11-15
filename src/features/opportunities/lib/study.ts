import { assessCandidate, type PositionSummary } from './candidates.ts'
import { QUOTE_STALE_MS } from './entry-price.ts'
import {
  type Followup,
  HORIZONS,
  samplePoints,
  summarizeFollowups,
  updateFollowups,
} from './followups.ts'
import type { Quote } from './mainnet-read.ts'
import { COINS, type Coin, decimal } from './opportunities.ts'

export const STUDY_METHOD = 'opportunity-study-v1'
export const STUDY_COST_BPS = [0, 10, 20] as const

interface Control {
  coin: Coin
  side: 'long' | 'short'
  scheduledAt: number
  detectedAt: number
  entry:
    | { available: true; price: string }
    | { available: false; reason: string }
    | null
  entryQuote?: Quote
  points: Followup['points']
}

export function summarizeStudy(study: Study) {
  return COINS.flatMap((coin) =>
    (['long', 'short'] as const).flatMap((side) => {
      const signals = study.signals.filter(
        (row) => row.coin === coin && row.side === side,
      )
      const controls = study.controls.filter(
        (row) => row.coin === coin && row.side === side,
      )
      const signalStats = summarizeFollowups(signals)
      const controlStats = summarizeFollowups(controls)
      return HORIZONS.map((minutes, index) => ({
        coin,
        side,
        minutes,
        signal: signalStats[index],
        control: controlStats[index],
        costs: STUDY_COST_BPS.map((roundTripBps) => {
          const cost = decimal(String(roundTripBps)).div(100)
          const net = (value: string | null) =>
            value === null ? null : decimal(value).minus(cost).toFixed()
          const positive = (records: { points: Followup['points'] }[]) =>
            records.filter((row) =>
              row.points.some(
                (point) =>
                  point.minutes === minutes &&
                  point.status === 'measured' &&
                  decimal(point.percent).gt(cost),
              ),
            ).length
          const signalNetPercent = net(signalStats[index].averagePercent)
          const controlNetPercent = net(controlStats[index].averagePercent)
          return {
            roundTripBps,
            signalNetPercent,
            controlNetPercent,
            signalPositive: positive(signals),
            controlPositive: positive(controls),
            difference:
              signalNetPercent !== null && controlNetPercent !== null
                ? decimal(signalNetPercent)
                    .minus(decimal(controlNetPercent))
                    .toFixed()
                : null,
          }
        }),
      }))
    }),
  )
}

export interface Study {
  version: 1
  startedAt: number
  enrollmentEndsAt: number
  endsAt: number
  signals: Followup[]
  controls: Control[]
}

const pointsAt = (time: number): Followup['points'] =>
  HORIZONS.map((minutes) => ({
    minutes,
    dueAt: time + minutes * 60000,
    status: 'pending',
  }))

export function createStudy(startedAt: number, minutes: number): Study {
  if (
    !Number.isSafeInteger(minutes) ||
    minutes < 1 ||
    minutes > 1440 ||
    !Number.isSafeInteger(startedAt) ||
    startedAt < 0
  )
    throw new Error('入组时长须为 1–1440 整数分钟，开始时间须有效')
  const enrollmentEndsAt = startedAt + minutes * 60000
  const endsAt = enrollmentEndsAt + 15 * 60000 + 2 * QUOTE_STALE_MS
  if (!Number.isFinite(new Date(endsAt).getTime()))
    throw new Error('批次截止时间无效')
  const controls: Control[] = []
  for (
    let scheduledAt = startedAt + 5000;
    scheduledAt < enrollmentEndsAt;
    scheduledAt += 5 * 60000
  )
    for (const coin of COINS)
      for (const side of ['long', 'short'] as const)
        controls.push({
          coin,
          side,
          scheduledAt,
          detectedAt: scheduledAt,
          entry: null,
          points: pointsAt(scheduledAt),
        })
  return {
    version: 1,
    startedAt,
    enrollmentEndsAt,
    endsAt,
    signals: [],
    controls,
  }
}

export function updateStudy(
  study: Study,
  summaries: PositionSummary[],
  quotes: Partial<Record<Coin, Quote>>,
  now: number,
  connected: boolean,
): Study {
  const seen = new Set(study.signals.map((row) => `${row.address}:${row.coin}`))
  const candidates =
    now < study.enrollmentEndsAt
      ? summaries.filter((row) => {
          const key = `${row.address}:${row.coin}`
          if (seen.has(key) || !assessCandidate(row, now).eligible) return false
          seen.add(key)
          return true
        })
      : []
  const signals = updateFollowups(
    study.signals,
    candidates,
    quotes,
    now,
    connected,
  )
  const controls = study.controls.map((row) => {
    if (row.entry) {
      const points = samplePoints(
        { ...row, entry: row.entry },
        quotes,
        now,
        connected,
      )
      return points === row.points ? row : { ...row, points }
    }
    if (now < row.scheduledAt) return row
    if (now > row.scheduledAt + QUOTE_STALE_MS) {
      const reason = '预设时点后 10 秒内没有有效起点盘口'
      return {
        ...row,
        entry: { available: false as const, reason },
        points: row.points.map((point) => ({
          ...point,
          status: 'missing' as const,
          reason,
        })),
      }
    }
    const quote = quotes[row.coin]
    const level = row.side === 'long' ? quote?.ask : quote?.bid
    if (
      !connected ||
      !quote ||
      !level ||
      quote.coin !== row.coin ||
      quote.time < row.scheduledAt ||
      quote.time > now + QUOTE_STALE_MS ||
      quote.receivedAt < row.scheduledAt ||
      quote.receivedAt > now
    )
      return row
    return {
      ...row,
      detectedAt: now,
      entry: { available: true as const, price: level.px },
      entryQuote: quote,
      points: pointsAt(now),
    }
  })
  return signals === study.signals &&
    controls.every((row, index) => row === study.controls[index])
    ? study
    : { ...study, signals, controls }
}
