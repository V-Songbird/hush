import { linesOf, NUMBER, numbersOf, statementsOf, unquote } from './mermaid-lex'

// The kinds of Mermaid that draw a shape rather than a plan: mind maps, quadrant
// charts, radar charts, sankey flows and git graphs. Each reads as null where the
// source says something it cannot draw.

export type MindShape = 'plain' | 'square' | 'round' | 'circle' | 'bang' | 'cloud' | 'hexagon'

export type MindNode = { label: string; shape: MindShape; children: MindNode[] }

export type Mindmap = { kind: 'mindmap'; title: string; root: MindNode; count: number }

export type QuadrantPoint = { label: string; x: number; y: number }

// Quadrants as Mermaid numbers them: 1 top right, 2 top left, 3 bottom left, 4 bottom right.
export type Quadrant = {
  kind: 'quadrant'
  title: string
  x: [string, string]
  y: [string, string]
  quadrants: [string, string, string, string]
  points: QuadrantPoint[]
}

export type RadarAxis = { id: string; label: string }

export type RadarCurve = { id: string; label: string; values: number[] }

export type Radar = {
  kind: 'radar'
  title: string
  axes: RadarAxis[]
  curves: RadarCurve[]
  min: number
  max: number
  graticule: 'circle' | 'polygon'
  ticks: number
}

export type SankeyLink = { from: string; to: string; value: number }

export type Sankey = { kind: 'sankey'; title: string; nodes: string[]; links: SankeyLink[] }

export type CommitType = 'normal' | 'reverse' | 'highlight' | 'merge' | 'cherry'

export type Commit = { id: string; shown: string; branch: string; type: CommitType; tag: string; parents: string[]; from: string }

export type GitGraph = { kind: 'git'; title: string; branches: string[]; commits: Commit[] }

const MAX_MIND = 60
const MAX_POINTS = 40
const MAX_AXES = 12
const MAX_CURVES = 8
const MAX_LINKS = 80
const MAX_COMMITS = 60
const MAX_BRANCHES = 10

// --- Mind map -----------------------------------------------------------------------

// Bracket pairs from the most to the least specific, so `((x))` is a circle, not round.
const MIND_SHAPES: readonly (readonly [RegExp, MindShape])[] = [
  [/^\S*?\(\((.*)\)\)$/, 'circle'],
  [/^\S*?\)\)(.*)\(\($/, 'bang'],
  [/^\S*?\)(.*)\($/, 'cloud'],
  [/^\S*?\{\{(.*)\}\}$/, 'hexagon'],
  [/^\S*?\[(.*)\]$/, 'square'],
  [/^\S*?\((.*)\)$/, 'round'],
]

function mindNode(text: string): MindNode {
  const bare = text.replace(/:::.*$/, '').trim()

  for (const [pattern, shape] of MIND_SHAPES) {
    const match = pattern.exec(bare)

    if (match !== null) {
      return { label: unquote((match[1] ?? '').replace(/^"`?|`?"$/g, '')), shape, children: [] }
    }
  }

  return { label: unquote(bare.replace(/^"`?|`?"$/g, '')), shape: 'plain', children: [] }
}

export function parseMindmap(body: readonly string[]): Mindmap | null {
  const stack: { indent: number; node: MindNode }[] = []
  let root: MindNode | null = null
  let count = 0

  for (const line of linesOf(body)) {
    // An icon or class line decorates the node above it.
    if (/^\s*(::icon\(|:::)/.test(line)) {
      continue
    }

    const indent = line.length - line.trimStart().length
    const node = mindNode(line.trim())

    while (stack.length > 0 && (stack[stack.length - 1]?.indent ?? 0) >= indent) {
      stack.pop()
    }

    const parent = stack[stack.length - 1]

    if (parent === undefined) {
      // Mermaid draws one root; a second line as far left is a second root it refuses.
      if (root !== null) {
        return null
      }

      root = node
    } else {
      parent.node.children.push(node)
    }

    stack.push({ indent, node })
    count++
  }

  return root === null || count > MAX_MIND ? null : { kind: 'mindmap', title: '', root, count }
}

// --- Quadrant chart -----------------------------------------------------------------

const axisOf = (text: string): [string, string] => {
  const [low = '', high = ''] = text.split('-->')

  return [unquote(low), unquote(high)]
}

export function parseQuadrant(body: readonly string[]): Quadrant | null {
  let title = ''
  let x: [string, string] = ['', '']
  let y: [string, string] = ['', '']
  const quadrants: [string, string, string, string] = ['', '', '', '']
  const points: QuadrantPoint[] = []

  for (const statement of statementsOf(body)) {
    const setting = /^(title|x-axis|y-axis|quadrant-([1-4]))\s+(.*)$/.exec(statement)
    // A point may trail a style (`radius: 10`) or a class (`:::hot`).
    const point = /^(.+?)\s*(?::::\S+)?\s*:\s*\[\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\]/.exec(statement)

    if (setting?.[1] === 'title') {
      title = unquote(setting[3] ?? '')
    } else if (setting?.[1] === 'x-axis') {
      x = axisOf(setting[3] ?? '')
    } else if (setting?.[1] === 'y-axis') {
      y = axisOf(setting[3] ?? '')
    } else if (setting?.[2] !== undefined) {
      quadrants[Number(setting[2]) - 1] = unquote(setting[3] ?? '')
    } else if (point !== null) {
      const [px, py] = [Number(point[2]), Number(point[3])]

      if (!(px >= 0 && px <= 1 && py >= 0 && py <= 1)) {
        return null
      }

      points.push({ label: unquote(point[1] ?? ''), x: px, y: py })
    } else {
      return null
    }
  }

  return points.length > MAX_POINTS || (points.length === 0 && quadrants.every(name => name === ''))
    ? null
    : { kind: 'quadrant', title, x, y, quadrants, points }
}

// --- Radar --------------------------------------------------------------------------

// `id`, `id["Label"]`, comma-separated, as both axes and curves name themselves.
const NAMED = /([A-Za-z_][\w-]*)\s*(?:\[\s*"([^"]*)"\s*\])?/y

export function parseRadar(body: readonly string[]): Radar | null {
  let title = ''
  let min = 0
  let max: number | null = null
  let graticule: Radar['graticule'] = 'circle'
  let ticks = 5
  const axes: RadarAxis[] = []
  const pending: { id: string; label: string; values: string }[] = []

  for (const statement of linesOf(body).map(line => line.trim())) {
    const setting = /^(title|max|min|graticule|ticks|showLegend)\s+(.*)$/.exec(statement)

    if (setting !== null) {
      const value = (setting[2] ?? '').trim()

      if (setting[1] === 'title') {
        title = unquote(value)
      } else if (setting[1] === 'graticule') {
        graticule = value === 'polygon' ? 'polygon' : 'circle'
      } else if (setting[1] !== 'showLegend') {
        if (!NUMBER.test(value)) {
          return null
        }

        setting[1] === 'max' ? (max = Number(value)) : setting[1] === 'min' ? (min = Number(value)) : (ticks = Math.max(1, Math.min(10, Math.round(Number(value)))))
      }
    } else if (/^axis\s/.test(statement)) {
      const read = namedList(statement.slice(4))

      if (read === null) {
        return null
      }

      axes.push(...read.map(({ id, label }) => ({ id, label: label === '' ? id : label })))
    } else if (/^curve\s/.test(statement)) {
      const read = curveList(statement.slice(5))

      if (read === null) {
        return null
      }

      pending.push(...read)
    } else {
      return null
    }
  }

  if (axes.length < 3 || axes.length > MAX_AXES || pending.length === 0 || pending.length > MAX_CURVES) {
    return null
  }

  const curves: RadarCurve[] = []

  for (const curve of pending) {
    const values = curveValues(curve.values, axes, min)

    if (values === null) {
      return null
    }

    curves.push({ id: curve.id, label: curve.label === '' ? curve.id : curve.label, values })
  }

  const top = max ?? Math.max(...curves.flatMap(curve => curve.values))

  return top > min ? { kind: 'radar', title, axes, curves, min, max: top, graticule, ticks } : null
}

function namedList(text: string): { id: string; label: string }[] | null {
  const items: { id: string; label: string }[] = []

  for (const part of text.split(',')) {
    NAMED.lastIndex = 0
    const match = NAMED.exec(part.trim())

    if (match === null || match[0].length !== part.trim().length) {
      return null
    }

    items.push({ id: match[1] ?? '', label: unquote(match[2] ?? '') })
  }

  return items
}

// `a["A"]{1, 2, 3}, b{ x: 1, y: 2 }`: several curves to a line, each with its values.
function curveList(text: string): { id: string; label: string; values: string }[] | null {
  const curves: { id: string; label: string; values: string }[] = []
  const pattern = /\s*([A-Za-z_][\w-]*)\s*(?:\[\s*"([^"]*)"\s*\])?\s*\{([^}]*)\}\s*(,|$)/y
  let at = 0

  while (at < text.length) {
    pattern.lastIndex = at
    const match = pattern.exec(text)

    if (match === null) {
      return text.slice(at).trim() === '' ? curves : null
    }

    curves.push({ id: match[1] ?? '', label: unquote(match[2] ?? ''), values: match[3] ?? '' })
    at = pattern.lastIndex
  }

  return curves
}

function curveValues(text: string, axes: readonly RadarAxis[], min: number): number[] | null {
  if (text.includes(':')) {
    const keyed = new Map<string, number>()

    for (const pair of text.split(',')) {
      const match = /^\s*([\w-]+)\s*:\s*(-?\d+(?:\.\d+)?)\s*$/.exec(pair)

      if (match === null || !axes.some(axis => axis.id === match[1])) {
        return null
      }

      keyed.set(match[1] ?? '', Number(match[2]))
    }

    return axes.map(axis => keyed.get(axis.id) ?? min)
  }

  const values = numbersOf(text)

  return values === null || values.length !== axes.length ? null : values
}

// --- Sankey -------------------------------------------------------------------------

// One CSV record: fields split on commas outside quotes, `""` a quote inside them.
function csvOf(line: string): string[] {
  const fields: string[] = []
  let field = ''
  let quoted = false

  for (let i = 0; i < line.length; i++) {
    const char = line[i] ?? ''

    if (quoted && char === '"' && line[i + 1] === '"') {
      field += '"'
      i++
    } else if (char === '"') {
      quoted = !quoted
    } else if (char === ',' && !quoted) {
      fields.push(field)
      field = ''
    } else {
      field += char
    }
  }

  return [...fields, field].map(item => item.trim())
}

export function parseSankey(body: readonly string[]): Sankey | null {
  const links: SankeyLink[] = []
  const nodes: string[] = []

  for (const line of linesOf(body)) {
    const [from = '', to = '', value = '', ...rest] = csvOf(line.trim())

    if (rest.length > 0 || from === '' || to === '' || !NUMBER.test(value) || Number(value) <= 0) {
      return null
    }

    links.push({ from, to, value: Number(value) })

    for (const name of [from, to]) {
      if (!nodes.includes(name)) {
        nodes.push(name)
      }
    }
  }

  return links.length === 0 || links.length > MAX_LINKS || order(nodes, links) === null ? null : { kind: 'sankey', title: '', nodes: order(nodes, links) ?? nodes, links }
}

// The nodes upstream first, each ahead of every node it feeds; null for a cycle, which
// a sankey cannot draw.
function order(nodes: readonly string[], links: readonly SankeyLink[]): string[] | null {
  const into = new Map(nodes.map(node => [node, links.filter(link => link.to === node && link.from !== node).length]))
  const ready = nodes.filter(node => into.get(node) === 0)
  const sorted: string[] = []

  while (ready.length > 0) {
    const node = ready.shift() ?? ''
    sorted.push(node)

    for (const link of links.filter(link => link.from === node)) {
      const left = (into.get(link.to) ?? 0) - 1
      into.set(link.to, left)

      if (left === 0) {
        ready.push(link.to)
      }
    }
  }

  return sorted.length === nodes.length && links.every(link => link.from !== link.to) ? sorted : null
}

// --- Git graph ----------------------------------------------------------------------

// `id: "x"`, `tag: "v1"`, `type: HIGHLIGHT`, `order: 2`, in any order after the verb.
function optionsOf(text: string): Map<string, string> | null {
  const options = new Map<string, string>()
  const pattern = /\s*(id|tag|type|order|msg)\s*:\s*("[^"]*"|\S+)/y
  let at = 0

  while (at < text.length) {
    pattern.lastIndex = at
    const match = pattern.exec(text)

    if (match === null) {
      return text.slice(at).trim() === '' ? options : null
    }

    options.set(match[1] ?? '', unquote(match[2] ?? ''))
    at = pattern.lastIndex
  }

  return options
}

const TYPES: Readonly<Record<string, CommitType>> = { NORMAL: 'normal', REVERSE: 'reverse', HIGHLIGHT: 'highlight' }

export function parseGitGraph(body: readonly string[]): GitGraph | null {
  const heads = new Map<string, string | null>([['main', null]])
  const orders = new Map<string, number>([['main', 0]])
  const commits: Commit[] = []
  let current = 'main'

  const add = (options: Map<string, string>, type: CommitType, parents: string[], from = ''): boolean => {
    const id = options.get('id') ?? `#${commits.length}`

    if (commits.some(commit => commit.id === id) || (options.has('type') && TYPES[options.get('type') ?? ''] === undefined)) {
      return false
    }

    commits.push({
      id,
      shown: options.get('id') ?? '',
      branch: current,
      type: TYPES[options.get('type') ?? ''] ?? type,
      tag: options.get('tag') ?? '',
      parents,
      from,
    })
    heads.set(current, id)

    return true
  }

  for (const statement of statementsOf(body)) {
    const verb = /^(commit|branch|checkout|switch|merge|cherry-pick)\b\s*(\S*)\s*(.*)$/.exec(statement)
    const head = heads.get(current) ?? null

    if (verb === null) {
      return null
    }

    const [, action = '', first = '', rest = ''] = verb
    const options = optionsOf(action === 'commit' || action === 'cherry-pick' ? `${first} ${rest}` : rest)
    const name = unquote(first)

    if (options === null) {
      return null
    }

    if (action === 'commit') {
      if (!add(options, 'normal', head === null ? [] : [head])) {
        return null
      }
    } else if (action === 'branch') {
      if (name === '' || heads.has(name) || heads.size >= MAX_BRANCHES) {
        return null
      }

      heads.set(name, head)
      orders.set(name, Number(options.get('order') ?? orders.size))
      current = name
    } else if (action === 'checkout' || action === 'switch') {
      if (!heads.has(name)) {
        return null
      }

      current = name
    } else if (action === 'merge') {
      const other = heads.get(name)

      if (name === current || other === undefined || other === null || head === null || !add(options, 'merge', [head, other], name)) {
        return null
      }
    } else {
      const picked = commits.find(commit => commit.id === options.get('id'))

      if (picked === undefined || picked.branch === current) {
        return null
      }

      options.delete('id')

      if (!add(options, 'cherry', head === null ? [] : [head], picked.shown || picked.id)) {
        return null
      }
    }
  }

  const branches = [...heads.keys()]
    .filter(branch => commits.some(commit => commit.branch === branch))
    .sort((a, b) => (orders.get(a) ?? 0) - (orders.get(b) ?? 0))

  return commits.length === 0 || commits.length > MAX_COMMITS ? null : { kind: 'git', title: '', branches, commits }
}
