// The three Gantt helpers svg-chart-plan.ts reads, copied from skins' chart-art.ts
// (lines 165-227) without the terminal cell art around them.

import type { ChartWords } from './mermaid'

const MINUTE = 60_000
export const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const STEPS = [HOUR, 2 * HOUR, 3 * HOUR, 6 * HOUR, 12 * HOUR, DAY, 2 * DAY, 7 * DAY, 14 * DAY]

export interface Tick {
  at: number
  label: string
}

const twoDigits = (n: number): string => String(n).padStart(2, '0')

// Ticks a label apart at most every eight columns: hours, days, weeks, then whole
// calendar months, named in the reader's language.
export function ticksOf(min: number, max: number, width: number, words: Pick<ChartWords, 'months' | 'day'>): Tick[] {
  const dayOf = (at: number): string => {
    const date = new Date(at)

    return words.day(words.months[date.getUTCMonth()] ?? '', date.getUTCDate())
  }

  const most = Math.max(2, Math.floor(width / 8))
  const step = STEPS.find(candidate => (max - min) / candidate <= most)
  const ticks: Tick[] = []

  if (step !== undefined) {
    for (let at = Math.ceil(min / step) * step; at <= max; at += step) {
      const date = new Date(at)
      ticks.push({ at, label: step < DAY ? `${twoDigits(date.getUTCHours())}:${twoDigits(date.getUTCMinutes())}` : dayOf(at) })
    }

    return ticks
  }

  const start = new Date(min)
  const onFirst = min === Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1)
  const first = start.getUTCFullYear() * 12 + start.getUTCMonth() + (onFirst ? 0 : 1)
  const months = (max - min) / (30 * DAY)
  const every = [1, 3, 6, 12].find(candidate => months / candidate <= most) ?? Math.ceil(months / most / 12) * 12

  for (let month = Math.ceil(first / every) * every; ; month += every) {
    const year = Math.floor(month / 12)
    const at = Date.UTC(year, month % 12, 1)

    if (at > max) {
      break
    }

    ticks.push({ at, label: every >= 12 ? String(year) : `${words.months[month % 12] ?? ''} ${year}` })
  }

  return ticks
}

export function lengthOf(ms: number, words: Pick<ChartWords, 'durations'>): string {
  const [unit, size] = ms >= DAY ? [words.durations.day, DAY] : ms >= HOUR ? [words.durations.hour, HOUR] : [words.durations.minute, MINUTE]
  const count = ms / size

  return `${Number(count.toFixed(count < 10 && count % 1 !== 0 ? 1 : 0))}${unit}`
}
