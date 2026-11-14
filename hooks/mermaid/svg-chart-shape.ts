import { formatValue } from './mermaid'
import type { ChartWords, Commit, GitGraph, MindNode, Mindmap, Quadrant, Radar, Sankey } from './mermaid'
import type { Palette } from './skin'
import { HEADER_H, PAD, seriesColor, text } from './svg-chart-kit'
import type { Body } from './svg-chart-kit'
import { escape, fitText, measure, riseDelay } from './svg-kit'

// The shape kinds as card bodies: a mindmap spread both ways from its root, a quadrant
// chart, a radar's curves, a sankey's flows as bands and a git graph's branches as lanes.

// --- Mindmap ------------------------------------------------------------------------

const MIND_ROW = 28
const MIND_STEP_MAX = 190
const BRANCH_H = 24

type Placed = { node: MindNode; depth: number; y: number; branch: number; parent?: Placed }

const leavesOf = (node: MindNode): number => (node.children.length === 0 ? 1 : node.children.reduce((sum, child) => sum + leavesOf(child), 0))

const depthOf = (node: MindNode): number => 1 + Math.max(0, ...node.children.map(depthOf))

// Each leaf takes a row; a parent sits level with the middle of its children.
function placeSide(branches: { node: MindNode; branch: number }[], top: number): Placed[] {
  const placed: Placed[] = []
  let row = 0

  const visit = (node: MindNode, depth: number, branch: number, parent?: Placed): Placed => {
    const own: Placed = { node, depth, y: 0, branch, parent }
    placed.push(own)

    if (node.children.length === 0) {
      own.y = top + row * MIND_ROW + MIND_ROW / 2
      row++
    } else {
      const kids = node.children.map(child => visit(child, depth + 1, branch, own))
      own.y = ((kids[0]?.y ?? 0) + (kids[kids.length - 1]?.y ?? 0)) / 2
    }

    return own
  }

  for (const { node, branch } of branches) {
    visit(node, 1, branch)
  }

  return placed
}

export function mindmapBody(chart: Mindmap, palette: Palette, width: number): Body | null {
  const root = chart.root
  const branches = root.children.map((node, branch) => ({ node, branch }))
  const twoSided = width >= 640 && branches.length > 1
  const split = twoSided ? Math.ceil(branches.length / 2) : branches.length
  const right = branches.slice(0, split)
  const left = branches.slice(split)
  const rows = Math.max(1, ...[right, left].map(side => side.reduce((sum, { node }) => sum + leavesOf(node), 0)))
  const depth = Math.max(1, ...branches.map(({ node }) => depthOf(node)))
  const rootLabel = fitText(root.label, 180, false, 14)
  const rootW = measure(rootLabel, false, 14) + 32
  const rootX = twoSided ? width / 2 : PAD + rootW / 2
  const reach = twoSided ? width / 2 - rootW / 2 - PAD : width - PAD * 2 - rootW
  const step = Math.min(MIND_STEP_MAX, reach / depth)

  if (step < 90) {
    return null
  }

  const plotH = rows * MIND_ROW
  const top = HEADER_H + PAD
  const rootY = top + plotH / 2
  const sides = [
    { dir: 1, placed: placeSide(right, top + (plotH - right.reduce((sum, { node }) => sum + leavesOf(node), 0) * MIND_ROW) / 2) },
    { dir: -1, placed: placeSide(left, top + (plotH - left.reduce((sum, { node }) => sum + leavesOf(node), 0) * MIND_ROW) / 2) },
  ]
  const edges: string[] = []
  const nodes: string[] = []

  for (const { dir, placed } of sides) {
    // Where a node's column begins, measured out from the root's edge.
    const columnX = (depth: number): number => rootX + dir * (rootW / 2 + 20 + (depth - 1) * step)
    const labelOf = (p: Placed): string => fitText(p.node.label, step - 30, false, p.depth === 1 ? 12.5 : 12)
    const widthOf = (p: Placed): number => measure(labelOf(p), false, p.depth === 1 ? 12.5 : 12) + (p.depth === 1 ? 22 : 14)
    // The point a node's edges leave from, toward its children.
    const outOf = (p: Placed): number => columnX(p.depth) + dir * widthOf(p)

    placed.forEach((p, i) => {
      const color = seriesColor(palette, p.branch)
      const x = columnX(p.depth)
      const fromX = p.parent === undefined ? rootX + dir * (rootW / 2) : outOf(p.parent)
      const fromY = p.parent === undefined ? rootY : p.parent.y
      const mid = (fromX + x) / 2
      const label = labelOf(p)

      edges.push(`<path d="M${fromX} ${fromY}C${mid} ${fromY} ${mid} ${p.y} ${x} ${p.y}" fill="none" stroke="${color}" stroke-opacity="${p.depth === 1 ? 0.6 : 0.4}" stroke-width="${p.depth === 1 ? 2 : 1.5}"/>`)

      if (p.depth === 1) {
        const w = widthOf(p)
        const boxX = dir === 1 ? x : x - w
        nodes.push(
          `<g class="rise" ${riseDelay(i, 25, 80)}>`,
          `<rect x="${boxX}" y="${p.y - BRANCH_H / 2}" width="${w}" height="${BRANCH_H}" rx="${BRANCH_H / 2}" fill="${color}" fill-opacity=".16" stroke="${color}" stroke-opacity=".5"/>`,
          text(boxX + w / 2, p.y + 4.5, label, 'text-anchor="middle" font-size="12.5" style="font-weight:600"'),
          `</g>`,
        )
      } else {
        const dotX = x + dir * 4
        nodes.push(
          `<g class="rise" ${riseDelay(i, 25, 80)}>`,
          `<circle cx="${dotX}" cy="${p.y}" r="3" fill="${color}"/>`,
          text(dotX + dir * 9, p.y + 4, label, `${dir === 1 ? '' : 'text-anchor="end" '}font-size="12"`),
          `</g>`,
        )
      }
    })
  }

  return {
    body: [
      ...edges,
      `<rect x="${rootX - rootW / 2}" y="${rootY - 18}" width="${rootW}" height="36" rx="18" fill="${palette.fg}" fill-opacity=".08" stroke="${palette.fg}" stroke-opacity=".3"/>`,
      text(rootX, rootY + 5, rootLabel, 'text-anchor="middle" font-size="14" style="font-weight:700"'),
      ...nodes,
    ].join(''),
    height: top + plotH + PAD,
  }
}

// --- Quadrant -----------------------------------------------------------------------

const QUAD_MAX = 440

type Rect = { x: number; y: number; w: number; h: number }

const overlaps = (a: Rect, b: Rect): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

const inside = (a: Rect, box: Rect): boolean => a.x >= box.x && a.y >= box.y && a.x + a.w <= box.x + box.w && a.y + a.h <= box.y + box.h

export function quadrantBody(chart: Quadrant, palette: Palette, width: number): Body | null {
  const size = Math.min(QUAD_MAX, width - PAD * 2 - 28)

  if (size < 220) {
    return null
  }

  const x0 = (width - size) / 2 + 14
  const y0 = HEADER_H + PAD + 4
  const half = size / 2
  const xOf = (x: number): number => x0 + Math.max(0, Math.min(1, x)) * size
  const yOf = (y: number): number => y0 + (1 - Math.max(0, Math.min(1, y))) * size
  // Quadrants run 1 top right, 2 top left, 3 bottom left, 4 bottom right.
  const cells = [
    { x: x0 + half, y: y0 },
    { x: x0, y: y0 },
    { x: x0, y: y0 + half },
    { x: x0 + half, y: y0 + half },
  ]
  const quadrantOf = (x: number, y: number): number => (y >= 0.5 ? (x >= 0.5 ? 0 : 1) : x < 0.5 ? 2 : 3)
  const parts: string[] = []

  cells.forEach((cell, i) => {
    parts.push(
      `<rect x="${cell.x}" y="${cell.y}" width="${half}" height="${half}" fill="${seriesColor(palette, i)}" fill-opacity=".08"/>`,
      text(cell.x + half / 2, cell.y + 22, fitText(chart.quadrants[i] ?? '', half - 16, false, 12.5), `text-anchor="middle" font-size="12.5" style="fill:${seriesColor(palette, i)};font-weight:600"`),
    )
  })

  parts.push(
    `<rect x="${x0}" y="${y0}" width="${size}" height="${size}" rx="2" fill="none" stroke="${palette.fg}" stroke-opacity=".18"/>`,
    `<line x1="${x0 + half}" y1="${y0}" x2="${x0 + half}" y2="${y0 + size}" stroke="${palette.fg}" stroke-opacity=".18"/>`,
    `<line x1="${x0}" y1="${y0 + half}" x2="${x0 + size}" y2="${y0 + half}" stroke="${palette.fg}" stroke-opacity=".18"/>`,
  )

  const axis = `font-size="11" style="fill:${palette.muted}"`
  const [xLo, xHi] = chart.x
  const [yLo, yHi] = chart.y
  parts.push(
    xLo === '' ? '' : text(x0 + half / 2, y0 + size + 18, fitText(xLo, half - 8, false, 11), `text-anchor="middle" ${axis}`),
    xHi === '' ? '' : text(x0 + half * 1.5, y0 + size + 18, fitText(xHi, half - 8, false, 11), `text-anchor="middle" ${axis}`),
    yLo === '' ? '' : `<text transform="translate(${x0 - 10} ${y0 + half * 1.5}) rotate(-90)" text-anchor="middle" ${axis}>${escape(fitText(yLo, half - 8, false, 11))}</text>`,
    yHi === '' ? '' : `<text transform="translate(${x0 - 10} ${y0 + half / 2}) rotate(-90)" text-anchor="middle" ${axis}>${escape(fitText(yHi, half - 8, false, 11))}</text>`,
  )

  // Each label takes the first side of its dot that hits no other dot, label or the plot edge.
  const dots: Rect[] = chart.points.map(point => ({ x: xOf(point.x) - 7, y: yOf(point.y) - 7, w: 14, h: 14 }))
  const taken: Rect[] = []
  const plot: Rect = { x: x0 + 2, y: y0 + 30, w: size - 4, h: size - 32 }

  chart.points.forEach((point, i) => {
    const px = xOf(point.x)
    const py = yOf(point.y)
    const color = seriesColor(palette, quadrantOf(point.x, point.y))
    const label = fitText(point.label, 120, false, 11.5)
    const w = measure(label, false, 11.5)
    const spots: (Rect & { anchor: string; tx: number; ty: number })[] = [
      { x: px + 10, y: py - 8, w, h: 15, anchor: 'start', tx: px + 10, ty: py + 4 },
      { x: px - 10 - w, y: py - 8, w, h: 15, anchor: 'end', tx: px - 10, ty: py + 4 },
      { x: px - w / 2, y: py - 25, w, h: 15, anchor: 'middle', tx: px, ty: py - 13 },
      { x: px - w / 2, y: py + 9, w, h: 15, anchor: 'middle', tx: px, ty: py + 21 },
    ]
    const others = [...dots.filter((_, k) => k !== i), ...taken]
    const spot = spots.find(s => inside(s, plot) && !others.some(o => overlaps(s, o))) ?? spots.find(s => inside(s, plot)) ?? spots[0]!
    taken.push(spot)

    parts.push(
      `<g class="rise" ${riseDelay(i, 30, 120)}>`,
      `<circle cx="${px}" cy="${py}" r="6" fill="${color}"/>`,
      text(spot.tx, spot.ty, label, `${spot.anchor === 'start' ? '' : `text-anchor="${spot.anchor}" `}font-size="11.5"`),
      `</g>`,
    )
  })

  return { body: parts.join(''), height: y0 + size + (xLo === '' && xHi === '' ? 0 : 22) + PAD - 4 }
}

// --- Radar --------------------------------------------------------------------------

const RADAR_MAX = 150
const LEGEND_ROW = 20

export function radarBody(chart: Radar, palette: Palette, width: number): Body | null {
  const axes = chart.axes
  const radius = Math.min(RADAR_MAX, (width - PAD * 2 - 200) / 2)

  if (axes.length < 3 || radius < 70) {
    return null
  }

  const span = chart.max - chart.min || 1
  const cx = width / 2
  const cy = HEADER_H + PAD + 22 + radius
  const angleOf = (i: number): number => -Math.PI / 2 + (i / axes.length) * Math.PI * 2
  const at = (i: number, r: number): [number, number] => [cx + Math.cos(angleOf(i)) * r, cy + Math.sin(angleOf(i)) * r]
  const ring = (r: number): string =>
    chart.graticule === 'circle'
      ? `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${palette.fg}" stroke-opacity=".1"/>`
      : `<polygon points="${axes.map((_, i) => at(i, r).join(',')).join(' ')}" fill="none" stroke="${palette.fg}" stroke-opacity=".1"/>`
  const parts: string[] = []
  const ticks = Math.max(1, chart.ticks)

  for (let k = 1; k <= ticks; k++) {
    parts.push(ring((radius * k) / ticks))
  }

  axes.forEach((axis, i) => {
    const [x, y] = at(i, radius)
    const [lx, ly] = at(i, radius + 14)
    const cos = Math.cos(angleOf(i))
    const anchor = Math.abs(cos) < 0.2 ? 'middle' : cos > 0 ? 'start' : 'end'
    const sin = Math.sin(angleOf(i))

    parts.push(
      `<line x1="${cx}" y1="${cy}" x2="${x}" y2="${y}" stroke="${palette.fg}" stroke-opacity=".1"/>`,
      text(lx, ly + 4 + sin * 4, fitText(axis.label, 96, false, 11.5), `text-anchor="${anchor}" font-size="11.5" style="fill:${palette.muted}"`),
    )
  })

  chart.curves.forEach((curve, k) => {
    const color = seriesColor(palette, k)
    const points = axes.map((_, i) => at(i, (Math.max(0, Math.min(1, ((curve.values[i] ?? chart.min) - chart.min) / span)) * radius)))

    parts.push(
      `<g class="rise" ${riseDelay(k, 80, 120)}>`,
      `<polygon points="${points.map(point => point.join(',')).join(' ')}" fill="${color}" fill-opacity=".15" stroke="${color}" stroke-width="2" stroke-linejoin="round"/>`,
      ...points.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="3" fill="${color}"/>`),
      `</g>`,
    )
  })

  // The legend runs on one line when it fits, one curve to a row when it does not.
  const entries = chart.curves.map((curve, k) => ({ label: fitText(curve.label || curve.id, 200, false, 12), color: seriesColor(palette, k) }))
  const widths = entries.map(entry => measure(entry.label, false, 12) + 30)
  const inline = widths.reduce((sum, w) => sum + w, 0) <= width - PAD * 2
  // Clear of the bottom axis label, which sits just outside the outer ring.
  let y = cy + radius + 58

  if (entries.length > 1 || entries[0]?.label !== '') {
    if (inline) {
      let x = (width - widths.reduce((sum, w) => sum + w, 0)) / 2

      entries.forEach((entry, k) => {
        parts.push(`<rect x="${x}" y="${y - 9}" width="10" height="10" rx="2" fill="${entry.color}"/>`, text(x + 16, y, entry.label, 'font-size="12"'))
        x += widths[k] ?? 0
      })
      y += LEGEND_ROW
    } else {
      for (const entry of entries) {
        parts.push(`<rect x="${PAD}" y="${y - 9}" width="10" height="10" rx="2" fill="${entry.color}"/>`, text(PAD + 16, y, entry.label, 'font-size="12"'))
        y += LEGEND_ROW
      }
    }
  }

  return { body: parts.join(''), height: y + PAD - 14 }
}

// --- Sankey -------------------------------------------------------------------------

const NODE_W = 10
const NODE_GAP = 14
const SANKEY_MIN_H = 220

// Each node's column: one past the deepest node feeding it, so flows only run right.
function layersOf(chart: Sankey): Map<string, number> {
  const layer = new Map(chart.nodes.map(node => [node, 0]))

  for (let pass = 0; pass < chart.nodes.length; pass++) {
    let moved = false

    for (const link of chart.links) {
      const next = (layer.get(link.from) ?? 0) + 1

      if (next > (layer.get(link.to) ?? 0) && next < chart.nodes.length) {
        layer.set(link.to, next)
        moved = true
      }
    }

    if (!moved) {
      break
    }
  }

  return layer
}

export function sankeyBody(chart: Sankey, palette: Palette, width: number): Body | null {
  if (chart.links.length === 0) {
    return null
  }

  const layer = layersOf(chart)
  const columns = Math.max(...layer.values()) + 1
  const inflow = (node: string): number => chart.links.filter(link => link.to === node).reduce((sum, link) => sum + link.value, 0)
  const outflow = (node: string): number => chart.links.filter(link => link.from === node).reduce((sum, link) => sum + link.value, 0)
  const valueOf = (node: string): number => Math.max(inflow(node), outflow(node))
  const byColumn = Array.from({ length: columns }, (_, c) => chart.nodes.filter(node => layer.get(node) === c))
  const crowd = Math.max(...byColumn.map(column => column.length))
  const plotH = Math.max(SANKEY_MIN_H, crowd * 40)
  const scale = Math.min(...byColumn.map(column => (plotH - NODE_GAP * (column.length - 1)) / Math.max(1, column.reduce((sum, node) => sum + valueOf(node), 0))))
  const x0 = PAD
  const gapX = (width - PAD * 2 - NODE_W) / Math.max(1, columns - 1)

  if (columns < 2 || gapX < 120) {
    return null
  }

  const top = HEADER_H + PAD
  const box = new Map<string, { x: number; y: number; h: number; color: string }>()

  byColumn.forEach((column, c) => {
    const used = column.reduce((sum, node) => sum + Math.max(2, valueOf(node) * scale), 0) + NODE_GAP * (column.length - 1)
    let y = top + (plotH - used) / 2

    for (const node of column) {
      const h = Math.max(2, valueOf(node) * scale)
      box.set(node, { x: x0 + c * gapX, y, h, color: seriesColor(palette, chart.nodes.indexOf(node)) })
      y += h + NODE_GAP
    }
  })

  const outAt = new Map<string, number>()
  const inAt = new Map<string, number>()
  const order = [...chart.links].sort((a, b) => (box.get(a.to)?.y ?? 0) - (box.get(b.to)?.y ?? 0))
  const bands: string[] = []

  order.forEach((link, i) => {
    const from = box.get(link.from)
    const to = box.get(link.to)

    if (from === undefined || to === undefined) {
      return
    }

    const h = link.value * scale
    const sy = from.y + (outAt.get(link.from) ?? 0)
    const ty = to.y + (inAt.get(link.to) ?? 0)
    outAt.set(link.from, (outAt.get(link.from) ?? 0) + h)
    inAt.set(link.to, (inAt.get(link.to) ?? 0) + h)

    const sx = from.x + NODE_W
    const tx = to.x
    const mid = (sx + tx) / 2
    bands.push(
      `<path class="rise" ${riseDelay(i, 20, 120)} d="M${sx} ${sy}C${mid} ${sy} ${mid} ${ty} ${tx} ${ty}L${tx} ${ty + h}C${mid} ${ty + h} ${mid} ${sy + h} ${sx} ${sy + h}Z" fill="${from.color}" fill-opacity=".28"><title>${escape(`${link.from} → ${link.to}: ${formatValue(link.value)}`)}</title></path>`,
    )
  })

  const nodes: string[] = []

  for (const [node, { x, y, h, color }] of box) {
    const last = layer.get(node) === columns - 1
    const label = fitText(node, gapX - NODE_W - 70, false, 12)
    const lx = last ? x - 8 : x + NODE_W + 8

    nodes.push(
      `<rect x="${x}" y="${y}" width="${NODE_W}" height="${h}" rx="2" fill="${color}"/>`,
      `<text x="${lx}" y="${y + h / 2 + 4}"${last ? ' text-anchor="end"' : ''} font-size="12">${escape(label)}<tspan dx="6" style="fill:${palette.muted}">${escape(formatValue(valueOf(node)))}</tspan></text>`,
    )
  }

  return { body: [...bands, ...nodes].join(''), height: top + plotH + PAD }
}

// --- Git graph ----------------------------------------------------------------------

const LANE_H = 44
const COMMIT_STEP_MAX = 64
const COMMIT_STEP_MIN = 26

// Lanes stop short of each commit, so the hollow glyphs stay hollow on any page.
const GLYPH_R = 8
const LANE_GAP = GLYPH_R + 2

function glyph(commit: Commit, x: number, y: number, color: string): string {
  switch (commit.type) {
    case 'reverse':
      return `<circle cx="${x}" cy="${y}" r="7" fill="none" stroke="${color}" stroke-width="2"/><path d="M${x - 3.5} ${y - 3.5}L${x + 3.5} ${y + 3.5}M${x + 3.5} ${y - 3.5}L${x - 3.5} ${y + 3.5}" stroke="${color}" stroke-width="2"/>`
    case 'highlight':
      return `<rect x="${x - 7}" y="${y - 7}" width="14" height="14" rx="2" fill="${color}"/>`
    case 'merge':
      return `<circle cx="${x}" cy="${y}" r="${GLYPH_R}" fill="none" stroke="${color}" stroke-width="2"/><circle cx="${x}" cy="${y}" r="4" fill="${color}"/>`
    case 'cherry':
      return `<circle cx="${x}" cy="${y}" r="5" fill="${color}"/><circle cx="${x}" cy="${y}" r="${GLYPH_R}" fill="none" stroke="${color}" stroke-width="1.5" stroke-dasharray="3 2"/>`
    default:
      return `<circle cx="${x}" cy="${y}" r="7" fill="${color}"/>`
  }
}

export function gitBody(chart: GitGraph, palette: Palette, width: number, words: ChartWords): Body | null {
  const commits = chart.commits

  if (commits.length === 0) {
    return null
  }

  const branches = chart.branches.filter(branch => commits.some(commit => commit.branch === branch))
  const laneOf = (branch: string): number => Math.max(0, branches.indexOf(branch))
  const nameW = Math.min(110, Math.max(...branches.map(branch => measure(branch, false, 12))) + 12)
  const x0 = PAD + nameW + 18
  const step = Math.min(COMMIT_STEP_MAX, (width - x0 - PAD - 8) / Math.max(1, commits.length - 1))

  if (step < COMMIT_STEP_MIN) {
    return null
  }

  const hasTags = commits.some(commit => commit.tag !== '')
  const top = HEADER_H + PAD + (hasTags ? 30 : 10)
  const index = new Map(commits.map((commit, i) => [commit.id, i]))
  const xOf = (i: number): number => x0 + i * step
  const yOf = (branch: string): number => top + laneOf(branch) * LANE_H
  const parts: string[] = []

  branches.forEach((branch, lane) => {
    const own = commits.flatMap((commit, i) => (commit.branch === branch ? [i] : []))
    const y = yOf(branch)
    const color = seriesColor(palette, lane)

    parts.push(text(PAD, y + 4, fitText(branch, nameW, false, 12), `font-size="12" style="fill:${color};font-weight:600"`))

    own.slice(1).forEach((i, k) => {
      const from = xOf(own[k] ?? i) + LANE_GAP
      const to = xOf(i) - LANE_GAP

      if (to > from) {
        parts.push(`<line x1="${from}" y1="${y}" x2="${to}" y2="${y}" stroke="${color}" stroke-width="2.5" stroke-opacity=".7"/>`)
      }
    })
  })

  // Forks and merges: a curve from each parent on another lane into the commit.
  commits.forEach((commit, i) => {
    for (const parent of commit.parents) {
      const p = index.get(parent)
      const source = p === undefined ? undefined : commits[p]

      if (p === undefined || source === undefined || source.branch === commit.branch) {
        continue
      }

      const fx = xOf(p) + LANE_GAP
      const fy = yOf(source.branch)
      const tx = xOf(i) - LANE_GAP
      const ty = yOf(commit.branch)
      const color = seriesColor(palette, laneOf(ty > fy ? commit.branch : source.branch))
      const bend = Math.max(0, tx - fx)

      parts.push(`<path d="M${fx} ${fy}C${fx + bend * 0.6} ${fy} ${tx - bend * 0.6} ${ty} ${tx} ${ty}" fill="none" stroke="${color}" stroke-width="2.5" stroke-opacity=".7"/>`)
    }
  })

  commits.forEach((commit, i) => {
    const x = xOf(i)
    const y = yOf(commit.branch)
    const color = seriesColor(palette, laneOf(commit.branch))
    const label = commit.shown === '' ? '' : fitText(commit.shown, Math.max(step - 6, 40), false, 10)
    const tagW = measure(commit.tag, false, 10.5) + 14

    parts.push(
      `<g class="rise" ${riseDelay(i, 25, 100)}>`,
      glyph(commit, x, y, color),
      `<title>${escape([commit.shown || commit.id, commit.type === 'merge' ? words.merge(commit.from) : commit.type === 'cherry' ? words.cherryPick(commit.from) : ''].filter(part => part !== '').join(' · '))}</title>`,
      label === '' ? '' : text(x, y + 22, label, `text-anchor="middle" font-size="10" style="fill:${palette.muted}"`),
      commit.tag === ''
        ? ''
        : `<rect x="${x - tagW / 2}" y="${y - 32}" width="${tagW}" height="18" rx="5" fill="${palette.warn}" fill-opacity=".16"/>${text(x, y - 19, commit.tag, `text-anchor="middle" font-size="10.5" style="fill:${palette.warn};font-weight:600"`)}`,
      `</g>`,
    )
  })

  return { body: parts.join(''), height: top + (branches.length - 1) * LANE_H + 26 + PAD - 4 }
}
