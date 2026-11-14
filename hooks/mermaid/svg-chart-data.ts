import { formatValue } from './mermaid'
import { packetRows, squarify } from './mermaid-data'
import type { Packet, Rect, TreeNode, Treemap } from './mermaid-data'
import type { Palette } from './skin'
import { HEADER_H, PAD, seriesColor, text } from './svg-chart-kit'
import type { Body } from './svg-chart-kit'
import { escape, fitText, riseDelay } from './svg-kit'

// The data kinds as card bodies: a treemap as nested squarified tiles, each top-level
// section in its own colour, and a packet diagram as rows of bit cells.

// --- Treemap ------------------------------------------------------------------------

const TREE_MAX_H = 420
const TREE_MIN_H = 240
const STRIP_H = 22
const GAP = 1.5

export function treemapBody(chart: Treemap, palette: Palette, width: number): Body | null {
  const plotW = width - PAD * 2
  const plotH = Math.round(Math.min(TREE_MAX_H, Math.max(TREE_MIN_H, plotW * 0.55)))
  const top = HEADER_H + 4
  const tiles: string[] = []
  let leaf = 0

  const draw = (node: TreeNode, rect: Rect, color: string, depth: number) => {
    const { x, y, w, h } = { x: rect.x + GAP, y: rect.y + GAP, w: rect.w - GAP * 2, h: rect.h - GAP * 2 }
    const tip = `<title>${escape(`${node.label}: ${formatValue(node.value)}`)}</title>`

    if (w < 2 || h < 2) {
      return
    }

    if (node.children.length === 0) {
      const label = w > 34 && h > 18 ? fitText(node.label, w - 12, false, 12) : ''
      const value = h > 38 && w > 34 ? fitText(formatValue(node.value), w - 12, false, 11) : ''

      tiles.push(
        `<g class="rise" ${riseDelay(leaf++, 18, 100)}><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="5" fill="${color}" fill-opacity=".18" stroke="${color}" stroke-opacity=".55">${tip}</rect>`,
        label === '' ? '' : text(x + 6, y + 17, label, 'font-size="12"'),
        value === '' ? '' : text(x + 6, y + 32, value, `font-size="11" style="fill:${palette.muted}"`),
        '</g>',
      )

      return
    }

    // A section: an outline with its name and total along the top, its children inside.
    const strip = h > STRIP_H * 2 && w > 48 ? STRIP_H : 4
    const name = strip === STRIP_H ? fitText(node.label, w - 16 - (w > 120 ? 50 : 0), false, depth === 0 ? 12.5 : 11.5) : ''

    tiles.push(
      `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="7" fill="${color}" fill-opacity="${depth === 0 ? '.06' : '.04'}" stroke="${color}" stroke-opacity="${depth === 0 ? '.6' : '.35'}">${tip}</rect>`,
      name === '' ? '' : text(x + 8, y + 15, name, `font-size="${depth === 0 ? 12.5 : 11.5}" font-weight="600"`),
      name === '' || w <= 120 ? '' : text(x + w - 8, y + 15, formatValue(node.value), `font-size="11" text-anchor="end" style="fill:${palette.muted}"`),
    )

    const inner = { x: x + 2, y: y + strip, w: w - 4, h: h - strip - 2 }
    const cuts = squarify(
      node.children.map(child => child.value),
      inner,
    )

    node.children.forEach((child, i) => {
      const cut = cuts[i]

      if (cut !== undefined) {
        draw(child, cut, color, depth + 1)
      }
    })
  }

  const cuts = squarify(
    chart.roots.map(root => root.value),
    { x: PAD, y: top, w: plotW, h: plotH },
  )

  chart.roots.forEach((root, i) => {
    const cut = cuts[i]

    if (cut !== undefined) {
      draw(root, cut, seriesColor(palette, i), 0)
    }
  })

  return { body: tiles.join(''), height: top + plotH + PAD }
}

// --- Packet -------------------------------------------------------------------------

const BOX_H = 34
const NUMBER_H = 15
const ROW_GAP = 8
const STACK_MAX = 3
const STACK_LINE = 10

export function packetBody(chart: Packet, palette: Palette, width: number): Body | null {
  const plotW = width - PAD * 2
  const perRow = plotW / 32 >= 14 ? 32 : 16
  const cell = plotW / perRow
  const rows = packetRows(chart, perRow)
  const top = HEADER_H + 6
  const rowH = NUMBER_H + BOX_H + ROW_GAP
  const parts: string[] = []

  rows.forEach((row, r) => {
    const y = top + r * rowH

    for (const piece of row) {
      const x = PAD + (piece.start % perRow) * cell
      const w = (piece.end - piece.start + 1) * cell
      const color = seriesColor(palette, piece.field)
      const bits = piece.start === piece.end ? `${piece.start}` : `${piece.start}–${piece.end}`
      const fitted = w > 26 ? fitText(piece.label, w - 10, false, 12) : ''
      // A flag too narrow for its name spells a short one downwards, as RFC header drawings do.
      const letters = [...piece.label.trim()]
      const stacked = fitted !== piece.label && letters.length <= STACK_MAX && w >= 12
      const label = stacked
        ? letters.map((letter, i) => text(x + w / 2, y + NUMBER_H + (BOX_H - letters.length * STACK_LINE) / 2 + (i + 1) * STACK_LINE - 2, letter, 'font-size="10" text-anchor="middle"')).join('')
        : fitted === ''
          ? ''
          : text(x + w / 2, y + NUMBER_H + BOX_H / 2 + 4, fitted, 'font-size="12" text-anchor="middle"')
      const numbers =
        piece.start === piece.end
          ? text(x + w / 2, y + 10, String(piece.start), `font-size="9.5" text-anchor="middle" style="fill:${palette.muted}"`)
          : text(x + 2, y + 10, String(piece.start), `font-size="9.5" style="fill:${palette.muted}"`) +
            text(x + w - 2, y + 10, String(piece.end), `font-size="9.5" text-anchor="end" style="fill:${palette.muted}"`)

      parts.push(
        `<g class="rise" ${riseDelay(piece.field, 16, 100)}>`,
        numbers,
        `<rect x="${x + 1}" y="${y + NUMBER_H}" width="${w - 2}" height="${BOX_H}" rx="5" fill="${color}" fill-opacity=".12" stroke="${color}" stroke-opacity=".6"${piece.cut ? ' stroke-dasharray="4 3"' : ''}><title>${escape(`${bits}: ${piece.label}`)}</title></rect>`,
        label,
        '</g>',
      )
    }
  })

  return { body: parts.join(''), height: top + rows.length * rowH - ROW_GAP + PAD }
}
