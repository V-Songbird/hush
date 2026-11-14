import { placeParts } from './mermaid-system'
import type { ArchGroup, ArchIcon, ArchService, Architecture, Block, BoxPart, BoxShape, C4, Link, Metrics, Part, Placed, Side } from './mermaid-system'
import type { ChartWords } from './mermaid'
import type { Palette } from './skin'
import { HEADER_H, PAD, seriesColor, text, wrapText } from './svg-chart-kit'
import type { Body } from './svg-chart-kit'
import { escape, fitText, measure, riseDelay, strokeIcon } from './svg-kit'

// The system kinds as card bodies: block diagrams and C4 as boxes flowed into frames with
// straight links between them, architecture as icon tiles on their grid inside group
// outlines, the edges leaving by the sides the source names.

const LABEL_SIZE = 12.5
const LABEL_LINE = 16
const NOTE_SIZE = 11
const NOTE_LINE = 14
const PERSON_ROOM = 24
const BOX_H = 40

// --- Boxes --------------------------------------------------------------------------

// How wide a line of text inside a shape can run.
function roomIn(shape: BoxShape, w: number): number {
  switch (shape) {
    case 'diamond':
      return w * 0.5
    case 'circle':
      return Math.min(w, 76) - 14
    case 'hexagon':
    case 'arrow-x':
      return w - 40
    case 'arrow-right':
    case 'arrow-left':
      return w - 36
    case 'slant':
    case 'asymmetric':
      return w - 30
    default:
      return w - 20
  }
}

type BoxText = { label: string[]; kind: string; notes: string[] }

// A C4 element's type and technology, as `Container database · SQL`.
const kindOf = (box: BoxPart, words: ChartWords): string =>
  box.c4 === undefined ? '' : `${words.c4Kind(box.c4.base, box.c4.store, box.isExternal)}${box.c4.tech === '' ? '' : ` · ${box.c4.tech}`}`

// The label in at most two lines; on a C4 element, its type under it and the
// description in at most three.
function boxText(box: BoxPart, w: number, words: ChartWords): BoxText {
  const room = roomIn(box.shape, w)
  const kind = kindOf(box, words)

  return {
    label: wrapText(box.label, room, LABEL_SIZE, 2),
    kind: kind === '' ? '' : fitText(kind, room, false, 10.5),
    notes: wrapText(box.notes.join(' '), room, NOTE_SIZE, 3),
  }
}

function contentHeight(box: BoxPart, lines: BoxText): number {
  return (box.shape === 'person' ? PERSON_ROOM : 0) + lines.label.length * LABEL_LINE + (lines.kind === '' ? 0 : NOTE_LINE + 2) + lines.notes.length * NOTE_LINE
}

function boxHeight(box: BoxPart, w: number, words: ChartWords): number {
  const content = contentHeight(box, boxText(box, w, words))

  switch (box.shape) {
    case 'diamond':
      return Math.max(60, content * 1.8)
    case 'circle':
      return Math.max(Math.min(w, 76), content + 20)
    default:
      return Math.max(BOX_H, content + 22)
  }
}

// A shape's outline, filled faintly in its colour; external elements dashed and fainter.
function shapeSvg(shape: BoxShape, x: number, y: number, w: number, h: number, color: string, isExternal: boolean): string {
  const paint = `fill="${color}" fill-opacity="${isExternal ? '.05' : '.12'}" stroke="${color}" stroke-opacity=".6"${isExternal ? ' stroke-dasharray="5 4"' : ''}`
  const line = (d: string) => `<path d="${d}" fill="none" stroke="${color}" stroke-opacity=".6"/>`
  const path = (d: string) => `<path d="${d}" ${paint}/>`
  const rect = (rx: number) => `<rect x="${x + 0.5}" y="${y + 0.5}" width="${w - 1}" height="${h - 1}" rx="${rx}" ${paint}/>`
  const mid = y + h / 2
  const head = Math.min(h / 2, w / 3)
  const tip = Math.min(h * 0.4, 16)

  switch (shape) {
    case 'round':
      return rect(12)
    case 'stadium':
      return rect(h / 2)
    case 'circle':
      return `<circle cx="${x + w / 2}" cy="${mid}" r="${Math.min(w, h) / 2 - 0.5}" ${paint}/>`
    case 'subroutine':
      return rect(4) + line(`M${x + 8} ${y}V${y + h}M${x + w - 8} ${y}V${y + h}`)
    case 'cylinder': {
      const ry = Math.min(7, h / 6)

      return path(`M${x} ${y + ry}A${w / 2} ${ry} 0 0 1 ${x + w} ${y + ry}V${y + h - ry}A${w / 2} ${ry} 0 0 1 ${x} ${y + h - ry}Z`) + line(`M${x} ${y + ry}A${w / 2} ${ry} 0 0 0 ${x + w} ${y + ry}`)
    }
    case 'queue': {
      const rx = Math.min(9, w / 8)

      return path(`M${x + rx} ${y}H${x + w - rx}A${rx} ${h / 2} 0 0 1 ${x + w - rx} ${y + h}H${x + rx}A${rx} ${h / 2} 0 0 1 ${x + rx} ${y}Z`) + line(`M${x + w - rx} ${y}A${rx} ${h / 2} 0 0 0 ${x + w - rx} ${y + h}`)
    }
    case 'diamond':
      return path(`M${x + w / 2} ${y}L${x + w} ${mid}L${x + w / 2} ${y + h}L${x} ${mid}Z`)
    case 'hexagon': {
      const inset = Math.min(16, w / 4)

      return path(`M${x} ${mid}L${x + inset} ${y}H${x + w - inset}L${x + w} ${mid}L${x + w - inset} ${y + h}H${x + inset}Z`)
    }
    case 'slant':
      return path(`M${x + 12} ${y}H${x + w}L${x + w - 12} ${y + h}H${x}Z`)
    case 'asymmetric':
      return path(`M${x} ${y}H${x + w}V${y + h}H${x}L${x + 12} ${mid}Z`)
    case 'arrow-right':
      return path(`M${x} ${y + h * 0.22}H${x + w - head}V${y}L${x + w} ${mid}L${x + w - head} ${y + h}V${y + h * 0.78}H${x}Z`)
    case 'arrow-left':
      return path(`M${x + w} ${y + h * 0.22}H${x + head}V${y}L${x} ${mid}L${x + head} ${y + h}V${y + h * 0.78}H${x + w}Z`)
    case 'arrow-x':
      return path(`M${x} ${mid}L${x + head} ${y}V${y + h * 0.22}H${x + w - head}V${y}L${x + w} ${mid}L${x + w - head} ${y + h}V${y + h * 0.78}H${x + head}V${y + h}Z`)
    case 'arrow-up':
      return path(`M${x} ${y + h}V${y + tip}L${x + w / 2} ${y}L${x + w} ${y + tip}V${y + h}Z`)
    case 'arrow-down':
      return path(`M${x} ${y}V${y + h - tip}L${x + w / 2} ${y + h}L${x + w} ${y + h - tip}V${y}Z`)
    case 'arrow-y':
      return path(`M${x} ${y + tip}L${x + w / 2} ${y}L${x + w} ${y + tip}V${y + h - tip}L${x + w / 2} ${y + h}L${x} ${y + h - tip}Z`)
    case 'person': {
      const cx = x + w / 2

      return rect(10) + `<g fill="none" stroke="${color}" stroke-opacity=".8" stroke-width="1.4"><circle cx="${cx}" cy="${y + 13}" r="4.5"/><path d="M${cx - 8} ${y + 27}a8 7 0 0 1 16 0"/></g>`
    }
    default:
      return rect(7)
  }
}

function boxSvg(placed: Placed & { part: BoxPart }, color: string, palette: Palette, words: ChartWords): string {
  const { part: box, x, y, w, h } = placed
  const lines = boxText(box, w, words)
  const cx = x + w / 2
  let at = y + (h - contentHeight(box, lines)) / 2 + (box.shape === 'person' ? PERSON_ROOM : 0)
  const parts = [shapeSvg(box.shape, x, y, w, h, color, box.isExternal)]

  for (const line of lines.label) {
    parts.push(text(cx, at + 12, line, `font-size="${LABEL_SIZE}" text-anchor="middle"${box.c4 === undefined ? '' : ' font-weight="600"'}`))
    at += LABEL_LINE
  }

  if (lines.kind !== '') {
    parts.push(text(cx, at + 12, lines.kind, `font-size="10.5" text-anchor="middle" style="fill:${palette.muted}"`))
    at += NOTE_LINE + 2
  }

  for (const line of lines.notes) {
    parts.push(text(cx, at + 11, line, `font-size="${NOTE_SIZE}" text-anchor="middle" fill-opacity=".85"`))
    at += NOTE_LINE
  }

  return `${parts.join('')}<title>${escape(boxLines(box, words).join('\n'))}</title>`
}

// What a box says, label first, for its tooltip and the alt text.
const boxLines = (box: BoxPart, words: ChartWords): string[] => [box.label, kindOf(box, words), ...box.notes].filter(line => line !== '')

// A frame's outline with its name, and its type in muted text after it where both fit.
function frameSvg(placed: Placed, isDashed: boolean, palette: Palette, words: ChartWords): string {
  const { part, x, y, w, h, depth } = placed
  const [name = '', typed = ''] = part.type === 'frame' ? part.label.split(' · ') : []
  const type = part.type === 'frame' && part.boundary !== undefined ? words.boundaries[part.boundary] : typed
  const room = w - 24
  const both = type !== '' && measure(`${name} · ${type}`, false, 11.5) <= room
  const label =
    name === ''
      ? ''
      : `<text x="${x + 12}" y="${y + 20}" font-size="11.5" font-weight="600">${escape(both ? name : fitText(name, room, false, 11.5))}${both ? `<tspan style="fill:${palette.muted};font-weight:400">&#160;· ${escape(type)}</tspan>` : ''}</text>`

  return `<rect x="${x + 0.5}" y="${y + 0.5}" width="${w - 1}" height="${h - 1}" rx="10" fill="${palette.fg}" fill-opacity="${depth === 0 ? '.03' : '.04'}" stroke="${palette.muted}" stroke-opacity=".5"${isDashed ? ' stroke-dasharray="6 4"' : ''}/>${label}`
}

const markerDefs = (id: string, palette: Palette): string =>
  `<defs><marker id="${id}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 1L9 5L0 9z" fill="${palette.muted}"/></marker></defs>`

const strokeOf = (line: Link['line'], palette: Palette): string =>
  `stroke="${palette.muted}" stroke-opacity=".85" fill="none" stroke-width="${line === 'thick' ? 2.2 : 1.3}"${line === 'dotted' ? ' stroke-dasharray="4 4"' : ''}`

// Where a line from a box's centre towards (dx, dy) crosses its outline: the drawn circle
// or diamond where the box is one, its rectangle otherwise.
function edgeOf(placed: Placed, dx: number, dy: number, margin: number): { x: number; y: number } {
  const cx = placed.x + placed.w / 2
  const cy = placed.y + placed.h / 2
  const shape = placed.part.type === 'box' ? placed.part.shape : 'box'
  const half = { w: placed.w / 2 + margin, h: placed.h / 2 + margin }
  const t =
    shape === 'circle'
      ? Math.min(placed.w, placed.h) / 2 + margin
      : shape === 'diamond'
        ? 1 / (Math.abs(dx) / half.w + Math.abs(dy) / half.h)
        : Math.min(dx === 0 ? Infinity : half.w / Math.abs(dx), dy === 0 ? Infinity : half.h / Math.abs(dy))

  return { x: cx + dx * t, y: cy + dy * t }
}

// A straight line from one box's outline to the other's, its label beside the middle.
function linkSvg(link: Link, from: Placed, to: Placed, palette: Palette, marker: string): string {
  const dx = to.x + to.w / 2 - (from.x + from.w / 2)
  const dy = to.y + to.h / 2 - (from.y + from.h / 2)
  const length = Math.hypot(dx, dy)

  if (length < 1) {
    return ''
  }

  const start = edgeOf(from, dx / length, dy / length, link.arrow === 'both' ? 2 : 0)
  const end = edgeOf(to, -dx / length, -dy / length, link.arrow === 'none' ? 0 : 2)
  const mid = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 }
  const arrows = `${link.arrow === 'both' ? ` marker-start="url(#${marker})"` : ''}${link.arrow === 'none' ? '' : ` marker-end="url(#${marker})"`}`
  const style = `font-size="11" style="fill:${palette.muted}"`
  // Above a level line, beside an upright one, and on the open side of a slanted one: up
  // and right of a `\`, up and left of a `/`.
  const label =
    link.label === ''
      ? ''
      : Math.abs(end.y - start.y) < 8
        ? text(mid.x, mid.y - 6, fitText(link.label, Math.max(60, Math.min(160, Math.abs(end.x - start.x) + 40)), false, 11), `${style} text-anchor="middle"`)
        : Math.abs(end.x - start.x) < 8 || dx * dy > 0
          ? text(mid.x + 8, mid.y + (Math.abs(end.x - start.x) < 8 ? 4 : -6), fitText(link.label, 150, false, 11), style)
          : text(mid.x - 8, mid.y - 6, fitText(link.label, Math.max(60, Math.min(220, mid.x - 8 - PAD)), false, 11), `${style} text-anchor="end"`)

  return `<path d="M${start.x} ${start.y}L${end.x} ${end.y}" ${strokeOf(link.line, palette)}${arrows}/>${label}`
}

// Whether the straight line between two points passes through a box other than its ends.
function isBlocked(from: Point, to: Point, ends: Placed[], placed: Placed[]): boolean {
  const others = placed.filter(other => other.part.type === 'box' && !ends.includes(other))
  const steps = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / 4))

  return Array.from({ length: steps + 1 }, (_, step) => step / steps).some(t => {
    const x = from.x + (to.x - from.x) * t
    const y = from.y + (to.y - from.y) * t

    return others.some(other => x > other.x + 2 && x < other.x + other.w - 2 && y > other.y + 2 && y < other.y + other.h - 2)
  })
}

const centreOf = (placed: Placed): Point => ({ x: placed.x + placed.w / 2, y: placed.y + placed.h / 2 })

// A link that would run through another box goes out to a lane right of everything
// instead, its label turned to read along the lane.
function laneSvg(link: Link, from: Placed, to: Placed, lane: number, palette: Palette, marker: string): string {
  const start = { x: from.x + from.w + (link.arrow === 'both' ? 2 : 0), y: centreOf(from).y }
  const end = { x: to.x + to.w + (link.arrow === 'none' ? 0 : 2), y: centreOf(to).y }
  const arrows = `${link.arrow === 'both' ? ` marker-start="url(#${marker})"` : ''}${link.arrow === 'none' ? '' : ` marker-end="url(#${marker})"`}`
  const span = Math.abs(end.y - start.y)
  const at = { x: lane + 13, y: (start.y + end.y) / 2 }
  const label =
    link.label === '' || span < 40
      ? ''
      : text(at.x, at.y, fitText(link.label, span - 12, false, 11), `font-size="11" style="fill:${palette.muted}" text-anchor="middle" transform="rotate(-90 ${at.x} ${at.y})"`)

  return `<path d="M${start.x} ${start.y}H${lane}V${end.y}H${end.x}" ${strokeOf(link.line, palette)}${arrows}/>${label}`
}

// Each lane and its label take this much of the card's right side.
const LANE = 22

// Boxes and frames flowed across the card, the links drawn over the frames and under
// the boxes.
function systemBody(chart: Block | C4, palette: Palette, width: number, metrics: Metrics, color: (box: BoxPart) => string, words: ChartWords): Body | null {
  const top = HEADER_H + PAD - 4
  const columns = chart.kind === 'block' ? chart.columns : 'fit'
  const straight = (placed: Placed[]): Link[] => {
    const byId = new Map(placed.map(part => [part.part.id, part]))

    return chart.links.filter(link => {
      const from = byId.get(link.from)
      const to = byId.get(link.to)

      return from !== undefined && to !== undefined && isBlocked(centreOf(from), centreOf(to), [from, to], placed)
    })
  }
  const first = placeParts(chart.parts, columns, PAD, top, width - PAD * 2, metrics)

  if (first === null) {
    return null
  }

  // Lay out again narrower when some links need lanes; up to three get one.
  const blocked = straight(first.placed).slice(0, 3)
  const strip = blocked.length === 0 ? 0 : 8 + LANE * blocked.length
  const layout = strip === 0 ? first : (placeParts(chart.parts, columns, PAD, top, width - PAD * 2 - strip, metrics) ?? first)
  const laned = layout === first ? [] : straight(layout.placed).filter(link => blocked.includes(link))
  const right = Math.max(...layout.placed.map(placed => placed.x + placed.w))

  const height = top + layout.height + PAD
  const marker = `arrow-${width}x${height}`
  const byId = new Map(layout.placed.map(placed => [placed.part.id, placed]))
  const frames = layout.placed.filter(placed => placed.part.type === 'frame').map(placed => frameSvg(placed, chart.kind === 'c4', palette, words))
  const links = chart.links.map((link, i) => {
    const from = byId.get(link.from)
    const to = byId.get(link.to)
    const lane = laned.indexOf(link)
    const drawn =
      from === undefined || to === undefined
        ? ''
        : lane === -1
          ? linkSvg(link, from, to, palette, marker)
          : laneSvg(link, from, to, right + 10 + LANE * lane, palette, marker)

    return drawn === '' ? '' : `<g class="rise" ${riseDelay(i, 30, 200)}>${drawn}</g>`
  })
  const boxes = layout.placed
    .filter((placed): placed is Placed & { part: BoxPart } => placed.part.type === 'box')
    .map((placed, i) => `<g class="rise" ${riseDelay(i, 30, 80)}>${boxSvg(placed, color(placed.part), palette, words)}</g>`)

  return { body: markerDefs(marker, palette) + frames.join('') + links.join('') + boxes.join(''), height }
}

export function blockBody(chart: Block, palette: Palette, width: number, words: ChartWords): Body | null {
  const hasLabels = chart.links.some(link => link.label !== '')

  return systemBody(
    chart,
    palette,
    width,
    { gap: hasLabels ? 56 : 32, rowGap: hasLabels ? 44 : 32, side: 14, head: 14, foot: 14, least: 56, most: 4, boxHeight: (box, w) => boxHeight(box, w, words) },
    box => seriesColor(palette, box.tone),
    words,
  )
}

export function c4Body(chart: C4, palette: Palette, width: number, words: ChartWords): Body | null {
  // External people and systems in grey, as C4 draws everything outside the scope.
  return systemBody(
    chart,
    palette,
    width,
    { gap: 40, rowGap: 48, side: 16, head: 32, foot: 16, least: 170, most: 4, boxHeight: (box, w) => boxHeight(box, w, words) },
    box => (box.isExternal ? palette.muted : seriesColor(palette, box.tone)),
    words,
  )
}

// --- Architecture -------------------------------------------------------------------

const TILE = 44
const STUB = 12

const ICONS: Readonly<Record<ArchIcon, string>> = {
  cloud: '<path d="M7 18h10a4 4 0 0 0 .6-7.95A6 6 0 0 0 6.1 9.6 4.2 4.2 0 0 0 7 18z"/>',
  database: '<ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v12c0 1.66 3.58 3 8 3s8-1.34 8-3V6M4 12c0 1.66 3.58 3 8 3s8-1.34 8-3"/>',
  disk: '<path d="M3 13h18v6H3zM3 13l3-8h12l3 8M7 16h.01M11 16h2"/>',
  internet: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z"/>',
  server: '<path d="M4 4h16v6H4zM4 14h16v6H4zM8 7h.01M8 17h.01"/>',
  generic: '<path d="M12 3l8 4.5-8 4.5-8-4.5zM4 7.5v9L12 21l8-4.5v-9M12 12v9"/>',
}

const SIDE_STEP: Readonly<Record<Side, readonly [number, number]>> = { T: [0, -1], B: [0, 1], L: [-1, 0], R: [1, 0] }

type Point = { x: number; y: number }

// Out of each side a short way, then across with at most two turns.
function routeOf(start: Point, from: Side, end: Point, to: Side): Point[] {
  const [fx, fy] = SIDE_STEP[from]
  const [tx, ty] = SIDE_STEP[to]
  const out = { x: start.x + fx * STUB, y: start.y + fy * STUB }
  const into = { x: end.x + tx * STUB, y: end.y + ty * STUB }
  const isFlat = (side: Side) => side === 'L' || side === 'R'
  const between =
    isFlat(from) && isFlat(to)
      ? [
          { x: (out.x + into.x) / 2, y: out.y },
          { x: (out.x + into.x) / 2, y: into.y },
        ]
      : !isFlat(from) && !isFlat(to)
        ? [
            { x: out.x, y: (out.y + into.y) / 2 },
            { x: into.x, y: (out.y + into.y) / 2 },
          ]
        : isFlat(from)
          ? [{ x: into.x, y: out.y }]
          : [{ x: out.x, y: into.y }]

  return [start, out, ...between, into, end]
}

export function architectureBody(chart: Architecture, palette: Palette, width: number): Body | null {
  const plotW = width - PAD * 2
  const groupOf = new Map(chart.groups.map(group => [group.id, group]))
  // How many levels of groups sit inside a group, itself counted.
  const levels = (id: string): number => 1 + Math.max(0, ...chart.groups.filter(group => group.parent === id).map(group => levels(group.id)))
  const padOf = (id: string) => 12 + 14 * (levels(id) - 1)
  const deepest = Math.max(0, ...chart.groups.filter(group => group.parent === null).map(group => levels(group.id)))
  const outer = deepest === 0 ? 0 : 12 + 14 * (deepest - 1)
  const colGap = Math.max(44, outer * 2 + 12)
  const rowGap = Math.max(40, outer * 2 + 18 * deepest + 12)
  const cell = Math.min(150, (plotW - outer * 2 - colGap * (chart.columns - 1)) / chart.columns)

  if (cell < 72) {
    return null
  }

  const labelsOf = (service: ArchService) => (service.isJunction ? [] : wrapText(service.label, cell, 11.5, 2))
  const cellH = TILE + 8 + 2 * 14
  const gridW = chart.columns * cell + colGap * (chart.columns - 1)
  const left = PAD + (plotW - gridW) / 2
  const top = HEADER_H + PAD + outer + 18 * deepest - 6
  const at = (service: ArchService) => ({ cx: left + service.col * (cell + colGap) + cell / 2, y: top + service.row * (cellH + rowGap) })
  const height = top + chart.rows * cellH + (chart.rows - 1) * rowGap + outer + PAD - 10
  const marker = `arrow-${width}x${height}`

  // Every tile in the colour of its outermost group; ungrouped ones in the first.
  const roots = chart.groups.filter(group => group.parent === null)
  const rootOf = (id: string | null): ArchGroup | undefined => {
    let group = id === null ? undefined : groupOf.get(id)

    while (group?.parent != null) {
      group = groupOf.get(group.parent)
    }

    return group
  }
  const colorOf = (id: string | null) => {
    const root = rootOf(id)

    return root === undefined ? seriesColor(palette, 0) : seriesColor(palette, roots.indexOf(root) + 1)
  }

  const inside = (service: ArchService, id: string): boolean => {
    for (let group = service.group; group !== null; group = groupOf.get(group)?.parent ?? null) {
      if (group === id) {
        return true
      }
    }

    return false
  }

  const outlines = chart.groups.flatMap(group => {
    const members = chart.services.filter(service => inside(service, group.id)).map(at)

    if (members.length === 0) {
      return []
    }

    const pad = padOf(group.id)
    const x0 = Math.min(...members.map(member => member.cx)) - cell / 2 - pad
    const x1 = Math.max(...members.map(member => member.cx)) + cell / 2 + pad
    const y0 = Math.min(...members.map(member => member.y)) - pad - 18 * levels(group.id)
    const y1 = Math.max(...members.map(member => member.y)) + cellH + pad - 10
    const color = colorOf(group.id)
    const name = fitText(group.label, x1 - x0 - 36, false, 11.5)

    return [
      `<rect x="${x0}" y="${y0}" width="${x1 - x0}" height="${y1 - y0}" rx="10" fill="${color}" fill-opacity=".04" stroke="${color}" stroke-opacity=".5" stroke-dasharray="6 4"/>`,
      strokeIcon(ICONS[group.icon], x0 + 10, y0 + 8, 14, color),
      text(x0 + 30, y0 + 19, name, 'font-size="11.5" font-weight="600"'),
    ]
  })

  const sideOf = (service: ArchService, side: Side): Point => {
    const { cx, y } = at(service)
    const mid = y + TILE / 2
    const reach = service.isJunction ? 4 : TILE / 2 + 2

    switch (side) {
      case 'T':
        return { x: cx, y: mid - reach }
      case 'L':
        return { x: cx - reach, y: mid }
      case 'R':
        return { x: cx + reach, y: mid }
      case 'B':
        return { x: cx, y: service.isJunction ? mid + 4 : y + TILE + labelsOf(service).length * 14 + 6 }
    }
  }

  const byId = new Map(chart.services.map(service => [service.id, service]))
  const edges = chart.edges.map((edge, i) => {
    const from = byId.get(edge.from)
    const to = byId.get(edge.to)

    if (from === undefined || to === undefined) {
      return ''
    }

    const points = routeOf(sideOf(from, edge.fromSide), edge.fromSide, sideOf(to, edge.toSide), edge.toSide)
    const segments = points.slice(1).map((point, j) => [points[j] as Point, point] as const)
    const [a, b] = segments.reduce((best, segment) => (Math.hypot(segment[1].x - segment[0].x, segment[1].y - segment[0].y) > Math.hypot(best[1].x - best[0].x, best[1].y - best[0].y) ? segment : best))
    const isFlat = Math.abs(b.x - a.x) > Math.abs(b.y - a.y)
    const label =
      edge.label === ''
        ? ''
        : isFlat
          ? text((a.x + b.x) / 2, a.y - 6, fitText(edge.label, Math.max(60, Math.abs(b.x - a.x)), false, 11), `font-size="11" text-anchor="middle" style="fill:${palette.muted}"`)
          : text(a.x + 6, (a.y + b.y) / 2 + 4, fitText(edge.label, 120, false, 11), `font-size="11" style="fill:${palette.muted}"`)
    const arrows = `${edge.arrow === 'from' || edge.arrow === 'both' ? ` marker-start="url(#${marker})"` : ''}${edge.arrow === 'to' || edge.arrow === 'both' ? ` marker-end="url(#${marker})"` : ''}`

    return `<g class="rise" ${riseDelay(i, 30, 200)}><path d="M${points.map(point => `${point.x} ${point.y}`).join('L')}" ${strokeOf('solid', palette)} stroke-linejoin="round"${arrows}/>${label}</g>`
  })

  const tiles = chart.services.map((service, i) => {
    const { cx, y } = at(service)
    const color = colorOf(service.group)

    if (service.isJunction) {
      return `<circle cx="${cx}" cy="${y + TILE / 2}" r="3.5" fill="${palette.muted}"/>`
    }

    return [
      `<g class="rise" ${riseDelay(i, 30, 80)}>`,
      `<rect x="${cx - TILE / 2 + 0.5}" y="${y + 0.5}" width="${TILE - 1}" height="${TILE - 1}" rx="10" fill="${color}" fill-opacity=".12" stroke="${color}" stroke-opacity=".6"><title>${escape(service.label)}</title></rect>`,
      strokeIcon(ICONS[service.icon], cx - 11, y + 11, 22, color),
      ...labelsOf(service).map((line, j) => text(cx, y + TILE + 16 + j * 14, line, 'font-size="11.5" text-anchor="middle"')),
      '</g>',
    ].join('')
  })

  return { body: markerDefs(marker, palette) + outlines.join('') + edges.join('') + tiles.join(''), height }
}

// --- What a screen reader hears -----------------------------------------------------

const boxesIn = (parts: readonly Part[]): BoxPart[] => parts.flatMap(part => (part.type === 'box' ? [part] : part.type === 'frame' ? boxesIn(part.parts) : []))

function linkLines(parts: readonly Part[], links: readonly Link[]): string[] {
  const names = new Map(boxesIn(parts).map(box => [box.id, box.label]))
  const name = (id: string) => names.get(id) ?? id

  return links.map(link => `${name(link.from)} ${link.arrow === 'both' ? '↔' : '→'} ${name(link.to)}${link.label === '' ? '' : ` (${link.label})`}`)
}

export function systemAlt(chart: Block | C4 | Architecture, heading: string, words: ChartWords): string {
  if (chart.kind === 'architecture') {
    const names = new Map(chart.services.map(service => [service.id, service.label || service.id]))

    return [
      heading,
      ...chart.groups.map(group => `${group.label}: ${chart.services.filter(service => service.group === group.id && !service.isJunction).map(service => service.label).join(', ') || words.empty}`),
      ...chart.edges.map(edge => `${names.get(edge.from)} → ${names.get(edge.to)}${edge.label === '' ? '' : ` (${edge.label})`}`),
    ].join('\n')
  }

  return [heading, ...boxesIn(chart.parts).map(box => boxLines(box, words).join(', ')), ...linkLines(chart.parts, chart.links)].join('\n')
}
