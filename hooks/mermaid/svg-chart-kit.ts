import type { Palette, Slot } from './skin'
import { escape, fitText, measure } from './svg-kit'

// What the chart cards share: the header band's height, the inset, the order the skin's
// accent slots colour series, slices, sections and branches in, and text placement.

export const HEADER_H = 56
export const PAD = 24

export type Body = { body: string; height: number }

const SERIES: readonly Slot[] = ['user', 'read', 'ok', 'warn', 'web', 'mcp', 'search', 'err']

// How far apart two colours must be to tell neighbouring series apart: redmean distance,
// past rose-pine's two pines (79) and short of the accents a skin means as different.
const DISTINCT = 85

// A colour an earlier slot already gave is skipped, so two series never share one where a
// skin reuses a colour (rose-pine's read and ok), and one close to an earlier colour waits
// until the distinct ones run out. The terminal art paints by this too.
export function seriesColor(palette: Palette, i: number): string {
  const colors = SERIES.map(slot => palette[slot].toLowerCase()).filter((color, at, all) => all.indexOf(color) === at)
  const distinct: string[] = []
  const close: string[] = []

  for (const color of colors) {
    ;(distinct.every(other => distance(color, other) >= DISTINCT) ? distinct : close).push(color)
  }

  const order = [...distinct, ...close]

  return order[i % order.length] ?? palette.user
}

const channels = (color: string): number[] => [1, 3, 5].map(at => Number.parseInt(color.slice(at, at + 2), 16))

function distance(a: string, b: string): number {
  const [r1 = 0, g1 = 0, b1 = 0] = channels(a)
  const [r2 = 0, g2 = 0, b2 = 0] = channels(b)
  const red = (r1 + r2) / 2

  return Math.sqrt((2 + red / 256) * (r1 - r2) ** 2 + 4 * (g1 - g2) ** 2 + (2 + (255 - red) / 256) * (b1 - b2) ** 2)
}

export const text = (x: number, y: number, body: string, attrs = ''): string => `<text x="${x}" y="${y}"${attrs === '' ? '' : ` ${attrs}`}>${escape(body)}</text>`

// `body` broken at spaces into lines `width` wide at `size`, `most` at most, the last
// cut short where text is left over.
export function wrapText(body: string, width: number, size: number, most: number): string[] {
  const lines: string[] = []
  let current = ''

  for (const word of body.split(' ').filter(word => word !== '')) {
    const next = current === '' ? word : `${current} ${word}`

    if (measure(next, false, size) <= width || current === '') {
      current = next
    } else {
      lines.push(current)
      current = word
    }
  }

  if (current !== '') {
    lines.push(current)
  }

  const kept = lines.slice(0, most)

  if (lines.length > most) {
    kept[most - 1] = `${kept[most - 1] ?? ''} ${lines.slice(most).join(' ')}`
  }

  return kept.map(line => fitText(line, width, false, size))
}
