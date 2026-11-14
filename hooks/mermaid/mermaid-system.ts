import { statementsOf, unquote } from './mermaid-lex'

// The kinds of Mermaid that draw how a system is put together: block diagrams on the
// author's own grid, architecture diagrams placed by the sides their edges name, and C4,
// people and systems nested in boundaries. Block and C4 both come down to boxes and
// frames flowed in rows, and that flow, which the card and the terminal drawing each run
// in their own units, lives here too. All three read as null where the source says
// something they cannot draw.

export type BoxShape =
  | 'box'
  | 'round'
  | 'stadium'
  | 'subroutine'
  | 'cylinder'
  | 'circle'
  | 'diamond'
  | 'hexagon'
  | 'slant'
  | 'asymmetric'
  | 'arrow-right'
  | 'arrow-left'
  | 'arrow-up'
  | 'arrow-down'
  | 'arrow-x'
  | 'arrow-y'
  | 'person'
  | 'queue'

// A box carries a label and lines of small print under it; a frame holds more parts on a
// grid of its own; a gap is the room `space` leaves. A C4 element's kind and a C4 boundary's
// fixed type stay data here, so the drawing names them in the reader's language.
export type BoxPart = { type: 'box'; id: string; label: string; notes: string[]; c4?: C4Kind; shape: BoxShape; tone: number; isExternal: boolean; span: number }

export type FramePart = { type: 'frame'; id: string; label: string; boundary?: C4Boundary; tone: number; span: number; columns: Columns; parts: Part[] }

export type C4Base = 'person' | 'system' | 'container' | 'component'

export type C4Store = 'database' | 'queue'

export type C4Kind = { base: C4Base; store: C4Store | null; tech: string }

export type C4Boundary = 'enterprise' | 'system' | 'container'

export type GapPart = { type: 'gap'; span: number }

export type Part = BoxPart | FramePart | GapPart

// A count of columns, every part on one row, or as many columns as the width fits.
export type Columns = number | 'row' | 'fit'

export type Link = { from: string; to: string; label: string; arrow: 'to' | 'both' | 'none'; line: 'solid' | 'dotted' | 'thick' }

export type Block = { kind: 'block'; title: string; columns: Columns; parts: Part[]; links: Link[]; boxes: number }

export type C4Level = 'Context' | 'Container' | 'Component' | 'Dynamic' | 'Deployment'

export type C4 = { kind: 'c4'; title: string; level: C4Level; parts: Part[]; links: Link[]; boxes: number }

export type Side = 'T' | 'B' | 'L' | 'R'

export type ArchIcon = 'cloud' | 'database' | 'disk' | 'internet' | 'server' | 'generic'

// A service or a junction, at its cell on the architecture grid.
export type ArchService = { id: string; label: string; icon: ArchIcon; group: string | null; isJunction: boolean; col: number; row: number }

export type ArchGroup = { id: string; label: string; icon: ArchIcon; parent: string | null }

export type ArchEdge = { from: string; fromSide: Side; to: string; toSide: Side; label: string; arrow: 'to' | 'from' | 'both' | 'none' }

export type Architecture = { kind: 'architecture'; title: string; groups: ArchGroup[]; services: ArchService[]; edges: ArchEdge[]; columns: number; rows: number }

const MAX_BOXES = 40
const MAX_DEPTH = 4
const MAX_COLUMNS = 12
const MAX_GRID = 8

const cleanLabel = (text: string): string => unquote(text).replace(/&nbsp;/gi, ' ').trim()

// --- Block --------------------------------------------------------------------------

// A label inside a shape's brackets: quoted, so it can hold brackets, or bare.
const LABEL = '("[^"]*"|[^"]*?)'

const BLOCK_SHAPES: readonly (readonly [BoxShape | 'arrow', RegExp])[] = (
  [
    ['circle', `\\(\\(\\(${LABEL}\\)\\)\\)`],
    ['circle', `\\(\\(${LABEL}\\)\\)`],
    ['stadium', `\\(\\[${LABEL}\\]\\)`],
    ['subroutine', `\\[\\[${LABEL}\\]\\]`],
    ['cylinder', `\\[\\(${LABEL}\\)\\]`],
    ['hexagon', `\\{\\{${LABEL}\\}\\}`],
    ['slant', `\\[[/\\\\]${LABEL}[/\\\\]\\]`],
    ['arrow', `<\\[${LABEL}\\]>\\(\\s*([a-z]+)[^)]*\\)`],
    ['asymmetric', `>${LABEL}\\]`],
    ['box', `\\[${LABEL}\\]`],
    ['round', `\\(${LABEL}\\)`],
    ['diamond', `\\{${LABEL}\\}`],
  ] as const
).map(([shape, pattern]) => [shape, new RegExp(`^${pattern}`)] as const)

const ARROWS: Readonly<Record<string, BoxShape>> = { right: 'arrow-right', left: 'arrow-left', up: 'arrow-up', down: 'arrow-down', x: 'arrow-x', y: 'arrow-y' }

// The edges flowcharts know, the label either between pipes or between the dashes.
const BLOCK_EDGE =
  /^(?:(-->|---|-\.->|-\.-|==>|===)\s*(?:\|([^|]*)\|)?|(--|-\.|==)\s*("[^"]*"|[^|>\-\s"][^>]*?)\s*(-->|---|\.->|\.-|==>|===))\s*/

type BlockNode = { id: string; label: string | null; shape: BoxShape; span: number; rest: string }

function readBlockNode(text: string): BlockNode | null {
  const id = /^[A-Za-z0-9_]+/.exec(text)?.[0]

  if (id === undefined || id === 'end' || id === 'space' || id === 'block' || id === 'columns') {
    return null
  }

  let rest = text.slice(id.length)
  let label: string | null = null
  let shape: BoxShape = 'box'

  for (const [kind, pattern] of BLOCK_SHAPES) {
    const match = pattern.exec(rest)

    if (match !== null) {
      label = cleanLabel(match[1] ?? '')
      shape = kind === 'arrow' ? (ARROWS[match[2] ?? ''] ?? 'arrow-right') : kind
      rest = rest.slice(match[0].length)
      break
    }
  }

  const span = /^:(\d+)/.exec(rest)

  return { id, label, shape, span: Math.max(1, Number(span?.[1] ?? 1)), rest: rest.slice(span?.[0].length ?? 0) }
}

// Blocks are coloured by the family of their shape, as flowchart nodes are.
const SHAPE_TONE: Readonly<Record<BoxShape, number>> = {
  box: 0,
  person: 0,
  round: 1,
  stadium: 1,
  circle: 1,
  cylinder: 2,
  subroutine: 2,
  queue: 2,
  diamond: 3,
  hexagon: 3,
  slant: 4,
  asymmetric: 4,
  'arrow-right': 5,
  'arrow-left': 5,
  'arrow-up': 5,
  'arrow-down': 5,
  'arrow-x': 5,
  'arrow-y': 5,
}

const lineOf = (op: string): Link['line'] => (op.includes('.') ? 'dotted' : op.includes('=') ? 'thick' : 'solid')

export function parseBlock(body: readonly string[]): Block | null {
  const root: FramePart = { type: 'frame', id: '', label: '', tone: 0, span: 1, columns: 'row', parts: [] }
  const stack: FramePart[] = [root]
  const ids = new Set<string>()
  const links: Link[] = []
  let boxes = 0
  let frames = 0

  // A name seen for the first time is a block where it stands, even inside an edge.
  const meet = (node: BlockNode, into: FramePart) => {
    if (!ids.has(node.id)) {
      ids.add(node.id)
      boxes++
      into.parts.push({ type: 'box', id: node.id, label: node.label ?? node.id, notes: [], shape: node.shape, tone: SHAPE_TONE[node.shape], isExternal: false, span: node.span })
    }
  }

  for (const statement of statementsOf(body)) {
    const top = stack[stack.length - 1] as FramePart
    const columns = /^columns\s+(\d+|auto)$/.exec(statement)
    const open = /^block(?::(\w+))?(?::(\d+))?$/.exec(statement)

    if (columns !== null) {
      const count = columns[1] === 'auto' ? 'row' : Number(columns[1])

      if (count !== 'row' && (count < 1 || count > MAX_COLUMNS)) {
        return null
      }

      top.columns = count
      continue
    }

    if (statement === 'end') {
      if (stack.length === 1) {
        return null
      }

      stack.pop()
      continue
    }

    if (open !== null) {
      const id = open[1] ?? `block ${frames + 1}`

      if (stack.length > MAX_DEPTH || ids.has(id)) {
        return null
      }

      const frame: FramePart = { type: 'frame', id, label: '', tone: frames++, span: Math.max(1, Number(open[2] ?? 1)), columns: 'row', parts: [] }
      ids.add(id)
      top.parts.push(frame)
      stack.push(frame)
      continue
    }

    let rest = statement

    while (rest !== '') {
      const space = /^space(?::(\d+))?(?=\s|$)/.exec(rest)

      if (space !== null) {
        top.parts.push({ type: 'gap', span: Math.max(1, Number(space[1] ?? 1)) })
        rest = rest.slice(space[0].length).trim()
        continue
      }

      const node = readBlockNode(rest)

      if (node === null) {
        return null
      }

      meet(node, top)
      rest = node.rest.trim()

      // `a --> b --> c`: each edge reads the next block along.
      for (let from = node.id, edge = BLOCK_EDGE.exec(rest); edge !== null; edge = BLOCK_EDGE.exec(rest)) {
        const target = readBlockNode(rest.slice(edge[0].length))
        const op = edge[1] ?? edge[5] ?? ''

        if (target === null) {
          return null
        }

        meet(target, top)
        links.push({ from, to: target.id, label: cleanLabel(edge[2] ?? edge[4] ?? ''), arrow: op.endsWith('>') ? 'to' : 'none', line: lineOf(op) })
        from = target.id
        rest = target.rest.trim()
      }
    }
  }

  if (boxes === 0 || boxes > MAX_BOXES || links.some(link => !ids.has(link.from) || !ids.has(link.to))) {
    return null
  }

  return { kind: 'block', title: '', columns: root.columns, parts: root.parts, links, boxes }
}

// --- Architecture -------------------------------------------------------------------

const ICONS: readonly ArchIcon[] = ['cloud', 'database', 'disk', 'internet', 'server']

const iconOf = (name: string | undefined): ArchIcon => ICONS.find(icon => icon === name) ?? 'generic'

const DECLARE = /^(group|service)\s+([\w-]+)\s*(?:\(([\w:.-]+)\))?\s*(?:\[([^\]]*)\])?\s*(?:in\s+([\w-]+))?$/
const JUNCTION = /^junction\s+([\w-]+)\s*(?:in\s+([\w-]+))?$/
const ARCH_EDGE = /^([\w-]+)(?:\{group\})?\s*:\s*([TBLR])\s*(<)?\s*(?:--|-\[([^\]]*)\]-)\s*(>)?\s*([TBLR])\s*:\s*([\w-]+)(?:\{group\})?$/

// Which way a side faces, as a step on the grid.
const STEP: Readonly<Record<Side, readonly [number, number]>> = { T: [0, -1], B: [0, 1], L: [-1, 0], R: [1, 0] }

export function parseArchitecture(body: readonly string[]): Architecture | null {
  const groups: ArchGroup[] = []
  const services: Omit<ArchService, 'col' | 'row'>[] = []
  const edges: ArchEdge[] = []
  let title = ''

  for (const statement of statementsOf(body)) {
    const declare = DECLARE.exec(statement)
    const junction = JUNCTION.exec(statement)
    const edge = ARCH_EDGE.exec(statement)
    const titled = /^title\s+(.+)$/.exec(statement)

    if (declare !== null) {
      const [, what, id = '', icon, label, parent] = declare
      const named = { id, label: cleanLabel(label ?? '') || id, icon: iconOf(icon) }

      if (what === 'group') {
        groups.push({ ...named, parent: parent ?? null })
      } else {
        services.push({ ...named, group: parent ?? null, isJunction: false })
      }
    } else if (junction !== null) {
      services.push({ id: junction[1] ?? '', label: '', icon: 'generic', group: junction[2] ?? null, isJunction: true })
    } else if (edge !== null) {
      const [, from = '', fromSide, into, label, out, toSide, to = ''] = edge
      edges.push({
        from,
        fromSide: fromSide as Side,
        to,
        toSide: toSide as Side,
        label: cleanLabel(label ?? ''),
        arrow: into !== undefined && out !== undefined ? 'both' : into !== undefined ? 'from' : out !== undefined ? 'to' : 'none',
      })
    } else if (titled !== null) {
      title = cleanLabel(titled[1] ?? '')
    } else if (!/^align\s/.test(statement)) {
      return null
    }
  }

  const ids = new Set(services.map(service => service.id))
  const groupIds = new Set(groups.map(group => group.id))
  // Each group's chain of parents ends, so no group sits inside itself.
  const isNested = (group: ArchGroup): boolean => {
    let parent = group.parent

    for (let step = 0; parent !== null && step <= groups.length; step++) {
      parent = groups.find(other => other.id === parent)?.parent ?? null
    }

    return parent === null
  }
  const known =
    groups.every(isNested) &&
    ids.size === services.length &&
    groupIds.size === groups.length &&
    groups.every(group => group.parent === null || (groupIds.has(group.parent) && group.parent !== group.id)) &&
    services.every(service => service.group === null || groupIds.has(service.group)) &&
    edges.every(edge => ids.has(edge.from) && ids.has(edge.to) && edge.from !== edge.to)

  if (!known || services.filter(service => !service.isJunction).length === 0 || services.length > MAX_BOXES) {
    return null
  }

  const cells = archGrid(
    services.map(service => service.id),
    edges,
  )
  const columns = Math.max(...[...cells.values()].map(cell => cell.col)) + 1
  const rows = Math.max(...[...cells.values()].map(cell => cell.row)) + 1

  if (columns > MAX_GRID || rows > MAX_GRID) {
    return null
  }

  return {
    kind: 'architecture',
    title,
    groups,
    services: services.map(service => ({ ...service, ...(cells.get(service.id) ?? { col: 0, row: 0 }) })),
    edges,
    columns,
    rows,
  }
}

// Each connected run of services walked out from its first one, every neighbour placed a
// step off the side its edge leaves by (further along if that cell is taken), and the
// runs set side by side in the order the source named them.
function archGrid(ids: readonly string[], edges: readonly ArchEdge[]): Map<string, { col: number; row: number }> {
  const cells = new Map<string, { col: number; row: number }>()
  let offset = 0

  for (const seed of ids) {
    if (cells.has(seed)) {
      continue
    }

    const local = new Map([[seed, { col: 0, row: 0 }]])
    const taken = new Set(['0,0'])
    const queue = [seed]

    for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
      const here = local.get(id) ?? { col: 0, row: 0 }

      for (const edge of edges) {
        const [other, side] = edge.from === id ? [edge.to, edge.fromSide] : edge.to === id ? [edge.from, edge.toSide] : [null, null]

        if (other === null || local.has(other)) {
          continue
        }

        const [dc, dr] = STEP[side]
        let col = here.col + dc
        let row = here.row + dr

        while (taken.has(`${col},${row}`)) {
          col += dc
          row += dr
        }

        local.set(other, { col, row })
        taken.add(`${col},${row}`)
        queue.push(other)
      }
    }

    const minCol = Math.min(...[...local.values()].map(cell => cell.col))
    const minRow = Math.min(...[...local.values()].map(cell => cell.row))

    for (const [id, cell] of local) {
      cells.set(id, { col: cell.col - minCol + offset, row: cell.row - minRow })
    }

    offset = Math.max(...[...cells.values()].map(cell => cell.col)) + 1
  }

  return cells
}

// --- C4 -----------------------------------------------------------------------------

const ELEMENT = /^(Person|System|Container|Component)(Db|Queue)?(_Ext)?$/
const BOUNDARY = /^(Boundary|Enterprise_Boundary|System_Boundary|Container_Boundary|Deployment_Node|Node|Node_L|Node_R)$/
const REL = /^(Bi)?Rel(?:_(U|D|L|R|Up|Down|Left|Right|Back|Neighbor))?$/
// Calls that only style or nudge the drawing Mermaid makes.
const C4_STYLE = /^(Update\w+|Lay_\w+|SHOW_LEGEND|SHOW_FLOATING_LEGEND|HIDE_STEREOTYPE|ShowLegend)$/

const BOUNDARY_TYPE: Readonly<Record<string, C4Boundary>> ={ Enterprise_Boundary: 'enterprise', System_Boundary: 'system', Container_Boundary: 'container' }

const ELEMENT_TONE: Readonly<Record<string, number>> = { Person: 0, System: 1, Container: 2, Component: 3 }

// A call's arguments: the positional ones in order, and the `$name="..."` ones by name.
function argsOf(text: string): { at: (i: number) => string; named: (name: string) => string } {
  const args: string[] = []
  let current = ''
  let quoted = false

  for (const char of text) {
    if (char === '"') {
      quoted = !quoted
    }

    if (char === ',' && !quoted) {
      args.push(current)
      current = ''
    } else {
      current += char
    }
  }

  args.push(current)

  const positional = args.map(arg => arg.trim()).filter(arg => !arg.startsWith('$'))
  const named = new Map(
    args
      .map(arg => /^\s*\$(\w+)\s*=\s*(.*)$/.exec(arg))
      .filter(match => match !== null)
      .map(match => [match[1] ?? '', cleanLabel(match[2] ?? '')]),
  )

  return { at: i => cleanLabel(positional[i] ?? ''), named: name => named.get(name) ?? '' }
}

export function parseC4(head: string, body: readonly string[]): C4 | null {
  const level = (/^C4(Context|Container|Component|Dynamic|Deployment)\b/.exec(head)?.[1] ?? 'Context') as C4Level
  const root: FramePart = { type: 'frame', id: '', label: '', tone: 0, span: 1, columns: 'fit', parts: [] }
  const stack: FramePart[] = [root]
  const ids = new Set<string>()
  const links: Link[] = []
  let title = ''
  let boxes = 0

  for (const statement of statementsOf(body)) {
    const top = stack[stack.length - 1] as FramePart
    const titled = /^title\s+(.+)$/.exec(statement)
    const call = /^(\w+)\s*\((.*)\)\s*(\{)?$/.exec(statement)

    if (titled !== null) {
      title = cleanLabel(titled[1] ?? '')
      continue
    }

    if (statement === '{') {
      continue
    }

    if (statement === '}') {
      if (stack.length === 1) {
        return null
      }

      stack.pop()
      continue
    }

    if (call === null) {
      return null
    }

    const [, name = '', inside = ''] = call
    const args = argsOf(inside)
    const element = ELEMENT.exec(name)
    const rel = REL.exec(name)

    if (element !== null) {
      const [, base = '', store, external] = element
      const id = args.at(0)
      const tech = base === 'Container' || base === 'Component' ? args.at(2) || args.named('techn') : args.named('techn')
      const descr = (base === 'Container' || base === 'Component' ? args.at(3) : args.at(2)) || args.named('descr')

      if (id === '' || ids.has(id) || (base === 'Person' && store !== undefined)) {
        return null
      }

      ids.add(id)
      boxes++
      top.parts.push({
        type: 'box',
        id,
        label: args.at(1) || id,
        notes: descr === '' ? [] : [descr],
        c4: { base: base.toLowerCase() as C4Base, store: store === undefined ? null : store === 'Db' ? 'database' : 'queue', tech },
        shape: base === 'Person' ? 'person' : store === 'Db' ? 'cylinder' : store === 'Queue' ? 'queue' : 'box',
        tone: ELEMENT_TONE[base] ?? 0,
        isExternal: external !== undefined,
        span: 1,
      })
    } else if (BOUNDARY.test(name)) {
      const id = args.at(0)
      const boundary = BOUNDARY_TYPE[name]
      const type = boundary === undefined ? args.at(2) : ''

      if (id === '' || ids.has(id) || stack.length > MAX_DEPTH) {
        return null
      }

      const frame: FramePart = { type: 'frame', id, label: `${args.at(1) || id}${type === '' ? '' : ` · ${type}`}`, ...(boundary === undefined ? {} : { boundary }), tone: stack.length - 1, span: 1, columns: 'fit', parts: [] }
      ids.add(id)
      top.parts.push(frame)
      stack.push(frame)
    } else if (rel !== null || name === 'RelIndex') {
      // `RelIndex` numbers its relationship first; `Rel_Back` points the other way.
      const shift = name === 'RelIndex' ? 1 : 0
      const [from, to] = rel?.[2] === 'Back' ? [args.at(shift + 1), args.at(shift)] : [args.at(shift), args.at(shift + 1)]
      const label = args.at(shift + 2) || args.named('label')
      const tech = args.at(shift + 3) || args.named('techn')

      links.push({ from, to, label: `${label}${tech === '' ? '' : ` [${tech}]`}`, arrow: rel?.[1] === 'Bi' ? 'both' : 'to', line: 'solid' })
    } else if (!C4_STYLE.test(name)) {
      return null
    }
  }

  if (boxes === 0 || boxes > MAX_BOXES || links.some(link => !ids.has(link.from) || !ids.has(link.to))) {
    return null
  }

  return { kind: 'c4', title, level, parts: root.parts, links, boxes }
}

// --- Flowing parts into rows --------------------------------------------------------

// The sizes a drawing lays parts out with, in its own units: pixels on a card, cells in
// the terminal.
export type Metrics = {
  gap: number
  rowGap: number
  // A frame's inside: from its left and right edges, under its top edge, over its bottom.
  side: number
  head: number
  foot: number
  // The narrowest a column may be, and how many `fit` columns there can be at most.
  least: number
  most: number
  boxHeight: (box: BoxPart, width: number) => number
}

export type Placed = { part: BoxPart | FramePart; x: number; y: number; w: number; h: number; depth: number }

const columnsFor = (parts: readonly Part[], columns: Columns, width: number, metrics: Metrics): number => {
  const fit = Math.max(1, Math.min(metrics.most, Math.floor((width + metrics.gap) / (metrics.least + metrics.gap))))

  if (columns === 'fit') {
    return fit
  }

  if (columns === 'row') {
    const total = parts.reduce((sum, part) => sum + part.span, 0)

    // A row too long for the width wraps rather than squeezing every part.
    return Math.max(1, (width - metrics.gap * (total - 1)) / total >= metrics.least ? total : fit)
  }

  return columns
}

// The parts left to right across `columns`, wrapping to a new row when the next one's
// span runs past the end. Frames come before what they hold, so a drawing taken in order
// paints them underneath. Null when a column would come out narrower than `least`.
export function placeParts(parts: readonly Part[], columns: Columns, x: number, y: number, width: number, metrics: Metrics, depth = 0): { height: number; placed: Placed[] } | null {
  const count = columnsFor(parts, columns, width, metrics)
  const column = (width - metrics.gap * (count - 1)) / count
  const placed: Placed[] = []
  const rows: { part: Part; at: number; span: number }[][] = [[]]
  let at = 0

  if (column < metrics.least) {
    return null
  }

  for (const part of parts) {
    // In a `fit` grid, frames sit two to a row when there are four columns, else alone.
    const span = Math.min(count, columns === 'fit' && part.type === 'frame' ? (count >= 4 ? 2 : count) : part.span)

    if (at + span > count) {
      rows.push([])
      at = 0
    }

    rows[rows.length - 1]?.push({ part, at, span })
    at += span
  }

  let top = y

  for (const row of rows.filter(row => row.length > 0)) {
    const boxes: { part: BoxPart; x: number; w: number; h: number }[] = []
    let tallest = 0

    for (const { part, at: start, span } of row) {
      const left = x + start * (column + metrics.gap)
      const w = column * span + metrics.gap * (span - 1)

      if (part.type === 'box') {
        const h = metrics.boxHeight(part, w)
        boxes.push({ part, x: left, w, h })
        tallest = Math.max(tallest, h)
      } else if (part.type === 'frame') {
        const inner = placeParts(part.parts, part.columns, left + metrics.side, top + metrics.head, w - metrics.side * 2, metrics, depth + 1)

        if (inner === null) {
          return null
        }

        const h = metrics.head + inner.height + metrics.foot
        placed.push({ part, x: left, y: top, w, h, depth }, ...inner.placed)
        tallest = Math.max(tallest, h)
      }
    }

    // Boxes on a row share the tallest box's height, so their edges line up.
    const boxHeight = Math.max(0, ...boxes.map(box => box.h))
    placed.push(...boxes.map(box => ({ part: box.part, x: box.x, y: top, w: box.w, h: boxHeight, depth })))
    top += tallest + metrics.rowGap
  }

  return { height: Math.max(0, top - y - metrics.rowGap), placed }
}
