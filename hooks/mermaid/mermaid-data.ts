import { linesOf, unquote } from './mermaid-lex'

// The kinds of Mermaid that lay out data rather than steps: treemaps, which nest values
// by indentation, and packet diagrams, which lay fields along a run of bits. Both read
// as null where the source says something they cannot draw. The layouts both drawings
// share (the squarified treemap, a packet's rows) live here too.

export type TreeNode = { label: string; value: number; children: TreeNode[] }

export type Treemap = { kind: 'treemap'; title: string; roots: TreeNode[]; leaves: number }

export type PacketField = { start: number; end: number; label: string }

export type Packet = { kind: 'packet'; title: string; fields: PacketField[]; bits: number }

const MAX_LEAVES = 60
const MAX_FIELDS = 64
const MAX_BITS = 1024

// --- Treemap ------------------------------------------------------------------------

// `"Name"` for a section, `"Name": 12` for a leaf, either with a `:::class` after it.
const TREE_LINE = /^(["'])(.*?)\1\s*(?::::[\w-]+)?\s*(?::?\s*(\d+(?:\.\d+)?))?\s*(?::::[\w-]+)?$/

type Read = { label: string; value: number | null; children: Read[] }

export function parseTreemap(body: readonly string[]): Treemap | null {
  const stack: { indent: number; node: Read }[] = []
  const roots: Read[] = []

  for (const line of linesOf(body)) {
    const match = TREE_LINE.exec(line.trim())

    if (match === null) {
      return null
    }

    const indent = line.length - line.trimStart().length
    const node: Read = { label: unquote(match[2] ?? ''), value: match[3] === undefined ? null : Number(match[3]), children: [] }

    while (stack.length > 0 && (stack[stack.length - 1]?.indent ?? 0) >= indent) {
      stack.pop()
    }

    const parent = stack[stack.length - 1]

    // A leaf has a value and nothing under it; a line under a valued one is a mistake.
    if (parent?.node.value !== null && parent !== undefined) {
      return null
    }

    ;(parent === undefined ? roots : parent.node.children).push(node)
    stack.push({ indent, node })
  }

  const summed = roots.map(sumOf)
  const leaves = summed.reduce((sum, root) => sum + leafCount(root), 0)
  const total = summed.reduce((sum, root) => sum + root.value, 0)

  return leaves === 0 || leaves > MAX_LEAVES || total <= 0 ? null : { kind: 'treemap', title: '', roots: summed, leaves }
}

// A section's value is what its leaves add up to; an empty section is worth nothing.
const sumOf = (node: Read): TreeNode => {
  const children = node.children.map(sumOf)

  return { label: node.label, value: node.value ?? children.reduce((sum, child) => sum + child.value, 0), children }
}

export const leafCount = (node: TreeNode): number =>
  node.children.length === 0 ? (node.value > 0 ? 1 : 0) : node.children.reduce((sum, child) => sum + leafCount(child), 0)

export type Rect = { x: number; y: number; w: number; h: number }

// The squarified treemap: `values` cut out of `rect` largest first, each row of cuts
// kept as close to square as the next one allows. Rects come back in the order of
// `values`; a value of nothing gets an empty rect.
export function squarify(values: readonly number[], rect: Rect): Rect[] {
  const total = values.reduce((sum, value) => sum + Math.max(0, value), 0)
  const out: Rect[] = values.map(() => ({ x: rect.x, y: rect.y, w: 0, h: 0 }))

  if (total <= 0 || rect.w <= 0 || rect.h <= 0) {
    return out
  }

  const scale = (rect.w * rect.h) / total
  const order = values
    .map((value, i) => ({ i, area: Math.max(0, value) * scale }))
    .filter(item => item.area > 0)
    .sort((a, b) => b.area - a.area)
  let { x, y, w, h } = rect
  let row: typeof order = []

  const worst = (items: typeof order, side: number): number => {
    const sum = items.reduce((total, item) => total + item.area, 0)
    const most = Math.max(...items.map(item => item.area))
    const least = Math.min(...items.map(item => item.area))

    return Math.max((side * side * most) / (sum * sum), (sum * sum) / (side * side * least))
  }

  const lay = (items: typeof order, last: boolean) => {
    const sum = items.reduce((total, item) => total + item.area, 0)
    let at = 0

    if (w >= h) {
      // A column down the left, as wide as its share of the height.
      const across = last ? w : sum / h

      for (const item of items) {
        const down = (item.area / sum) * h
        out[item.i] = { x, y: y + at, w: across, h: down }
        at += down
      }

      x += across
      w -= across
    } else {
      const down = last ? h : sum / w

      for (const item of items) {
        const across = (item.area / sum) * w
        out[item.i] = { x: x + at, y, w: across, h: down }
        at += across
      }

      y += down
      h -= down
    }
  }

  for (const item of order) {
    const side = Math.min(w, h)

    if (row.length === 0 || worst([...row, item], side) <= worst(row, side)) {
      row.push(item)
    } else {
      lay(row, false)
      row = [item]
    }
  }

  lay(row, true)

  return out
}

// --- Packet -------------------------------------------------------------------------

export function parsePacket(body: readonly string[]): Packet | null {
  let title = ''
  const fields: PacketField[] = []
  let next = 0

  for (const statement of linesOf(body).map(line => line.trim())) {
    const titled = /^title\s+(.*)$/.exec(statement)
    const ranged = /^(\d+)(?:\s*-\s*(\d+))?\s*:\s*"([^"]*)"$/.exec(statement)
    const counted = /^\+(\d+)\s*:\s*"([^"]*)"$/.exec(statement)

    if (titled !== null) {
      title = unquote(titled[1] ?? '')
      continue
    }

    const start = ranged !== null ? Number(ranged[1]) : next
    const end = ranged !== null ? Number(ranged[2] ?? ranged[1]) : next + Number(counted?.[1] ?? 0) - 1

    // Mermaid wants each field to start where the last one ended, as the bits do.
    if ((ranged === null && counted === null) || start !== next || end < start) {
      return null
    }

    fields.push({ start, end, label: unquote(ranged?.[3] ?? counted?.[2] ?? '') })
    next = end + 1
  }

  return fields.length === 0 || fields.length > MAX_FIELDS || next > MAX_BITS ? null : { kind: 'packet', title, fields, bits: next }
}

// A piece of a field on one row; `field` is its index, `cut` marks a field that carries
// on from the row above.
export type PacketCell = { field: number; start: number; end: number; label: string; cut: boolean }

// The fields cut into rows of `perRow` bits, a field that crosses a row's end split.
export function packetRows(packet: Packet, perRow: number): PacketCell[][] {
  const rows: PacketCell[][] = []

  for (const [field, { start, end, label }] of packet.fields.entries()) {
    for (let at = start; at <= end; at = (Math.floor(at / perRow) + 1) * perRow) {
      const r = Math.floor(at / perRow)
      rows[r] = [...(rows[r] ?? []), { field, start: at, end: Math.min(end, (r + 1) * perRow - 1), label, cut: at !== start }]
    }
  }

  return rows
}
