import { expect, test } from 'claude-code/testing'

import { chartHeading, formatPercent, niceStep, parseMermaid, seriesName } from './mermaid/mermaid'
import type { Architecture, Block, C4, Chart, Flow, Gantt, GitGraph, Journey, Kanban, Mindmap, Packet, Pie, Quadrant, Radar, Sankey, Timeline, Treemap, XyChart } from './mermaid/mermaid'
import { chartSvg } from './mermaid/svg-chart'
import { seriesColor } from './mermaid/svg-chart-kit'
import { DARK as PALETTE, EN, ES } from './register'

// Ported from skins 0.5.16 tests/logic.test.ts (MIT, see mermaid/LICENSE-skins): the Mermaid
// parser and SVG chart tests, run against Hush's dark palette instead of skins' themes.
test('a Mermaid flowchart parses into ranked nodes, shapes and labelled edges', async () => {
  const flow = parseMermaid('flowchart TD\n  A[Start] --> B{Ok?}\n  B -->|yes| C([Done])\n  B -. no .-> A\n  %% a comment\n  classDef x fill:#f00') as Flow

  expect(flow.kind).toBe('flow')
  expect(flow.direction).toBe('down')
  expect(flow.nodes.map(node => [node.id, node.label, node.shape])).toEqual([
    ['A', 'Start', 'box'],
    ['B', 'Ok?', 'diamond'],
    ['C', 'Done', 'round'],
  ])
  expect(flow.ranks).toEqual([['A'], ['B'], ['C']])
  expect(flow.edges[1]?.label).toBe('yes')
  expect(flow.back.map(edge => [edge.from, edge.to, edge.line, edge.label])).toEqual([['B', 'A', 'dotted', 'no']])
  expect((parseMermaid('graph LR; a-->b; b==>c') as Flow).direction).toBe('right')
})

test('Mermaid the cards cannot draw faithfully parses to nothing', async () => {
  expect(parseMermaid('sequenceDiagram\n  A->>B: hi')).toBeNull()
  expect(parseMermaid('flowchart TD\n  subgraph one\n  A --> B\n  end')).toBeNull()
  expect(parseMermaid('flowchart TD\n  A --> B\n  this is not mermaid')).toBeNull()
  expect(parseMermaid('flowchart TD')).toBeNull()
})

test('an xychart parses its axes and series, and picks a y range when none is given', async () => {
  const chart = parseMermaid('xychart-beta\n  title "Sales"\n  x-axis [jan, feb, mar]\n  y-axis "Revenue"\n  bar [5, 12, 7]\n  line "Trend" [4, 9, 10]') as XyChart

  expect(chart.title).toBe('Sales')
  expect(chart.labels).toEqual(['jan', 'feb', 'mar'])
  expect(chart.yLabel).toBe('Revenue')
  expect(chart.series.map(series => [series.kind, series.name, series.values])).toEqual([
    ['bar', '', [5, 12, 7]],
    ['line', 'Trend', [4, 9, 10]],
  ])
  expect(chart.min).toBe(0)
  expect(chart.max).toBeGreaterThanOrEqual(12)
  expect(chartHeading(chart, EN.chart)).toEqual({ kind: 'Chart', count: '2 series' })
  expect(niceStep(100)).toBe(25)
})

test('a pie parses its slices, and its heading counts them', async () => {
  const pie = parseMermaid('pie title Pets\n  "Dogs" : 386\n  "Cats" : 85.5') as Pie

  expect(pie.title).toBe('Pets')
  expect(pie.slices).toEqual([
    { label: 'Dogs', value: 386 },
    { label: 'Cats', value: 85.5 },
  ])
  expect(chartHeading(pie, EN.chart)).toEqual({ kind: 'Pie', count: '2 slices' })
})

test('chart cards draw in the skin, and a flowchart too wide for its card is left to the code card', async () => {
  const palette = PALETTE
  const flow = chartSvg(parseMermaid('flowchart TD\n  A[Plan] --> B[Build]\n  B --> A') as Flow, palette, 640, EN.chart)
  const pie = chartSvg(parseMermaid('pie\n  "a" : 1') as Pie, palette, 640, EN.chart)
  const wide = parseMermaid(`flowchart TD\n${Array.from({ length: 12 }, (_, i) => `  R --> N${i}[Node ${i}]`).join('\n')}`) as Flow

  expect(flow?.source).toContain('Plan')
  expect(flow?.source).toContain('marker-end')
  // Hush draws flowchart shapes in the neutral grey; skins checked its accent here.
  expect(flow?.source).toContain(palette.muted)
  expect(flow?.alt).toContain('Build → Plan')
  expect(pie?.source).toContain('<circle')
  expect(chartSvg(wide, palette, 480, EN.chart)).toBeNull()
})

test('percents drop a trailing zero, and unnamed series are named by kind', async () => {
  expect(formatPercent(0.09)).toBe('9%')
  expect(formatPercent(0.095)).toBe('9.5%')
  expect(formatPercent(0.65)).toBe('65%')

  const chart = parseMermaid('xychart-beta\n  x-axis [a]\n  bar [1]\n  line [2]\n  line "Goal" [3]\n  line [4]') as XyChart
  expect(chart.series.map((_, i) => seriesName(chart, i, EN.chart))).toEqual(['bar', 'line 1', 'Goal', 'line 2'])
})

const DAY = 86_400_000

test('a gantt chains tasks with after, counts days and keeps its flags', async () => {
  const gantt = parseMermaid([
    'gantt',
    '  title Launch',
    '  dateFormat YYYY-MM-DD',
    '  section Build',
    '  Parser :done, p1, 2026-10-01, 4d',
    '  Cards  :active, p2, after p1, 2w',
    '  section Ship',
    '  Tests  :crit, after p2, 1d',
    '  Release :milestone, after p2, 0d',
  ].join('\n')) as Gantt

  expect(gantt.title).toBe('Launch')
  expect(gantt.sections).toEqual(['Build', 'Ship'])
  expect(gantt.tasks.map(task => [task.label, task.section, (task.end - task.start) / DAY])).toEqual([
    ['Parser', 'Build', 4],
    ['Cards', 'Build', 14],
    ['Tests', 'Ship', 1],
    ['Release', 'Ship', 0],
  ])
  expect(gantt.tasks[1]?.start).toBe(gantt.tasks[0]?.end)
  expect(gantt.tasks.map(task => [task.done, task.active, task.crit, task.milestone])).toEqual([
    [true, false, false, false],
    [false, true, false, false],
    [false, false, true, false],
    [false, false, false, true],
  ])
  expect(chartHeading(gantt, EN.chart)).toEqual({ kind: 'Gantt', count: '4 tasks' })
})

test('a timeline groups events by period and section', async () => {
  const timeline = parseMermaid('timeline\n  title Social\n  section Early\n  2002 : LinkedIn\n  2004 : Facebook : Google\n  section Video\n  2005 : YouTube') as Timeline

  expect(timeline.title).toBe('Social')
  expect(timeline.periods).toEqual([
    { label: '2002', section: 'Early', events: ['LinkedIn'] },
    { label: '2004', section: 'Early', events: ['Facebook', 'Google'] },
    { label: '2005', section: 'Video', events: ['YouTube'] },
  ])
  expect(chartHeading(timeline, EN.chart)).toEqual({ kind: 'Timeline', count: '3 periods' })
})

test('a journey scores each step and gathers its actors', async () => {
  const journey = parseMermaid('journey\n  title Day\n  section Work\n    Make tea: 5: Me\n    Do work: 1: Me, Cat') as Journey

  expect(journey.actors).toEqual(['Me', 'Cat'])
  expect(journey.steps.map(step => [step.label, step.score, step.actors])).toEqual([
    ['Make tea', 5, ['Me']],
    ['Do work', 1, ['Me', 'Cat']],
  ])
  expect(chartHeading(journey, EN.chart)).toEqual({ kind: 'Journey', count: '2 steps' })
})

test('a kanban reads columns, cards and their metadata', async () => {
  const kanban = parseMermaid("kanban\n  Todo\n    [Write docs]\n    id2[Ship it]@{ assigned: 'sverre', priority: 'High' }\n  Done\n    [Pie]@{ ticket: 'SK-1' }") as Kanban

  expect(kanban.columns.map(column => [column.label, column.cards.map(card => card.label)])).toEqual([
    ['Todo', ['Write docs', 'Ship it']],
    ['Done', ['Pie']],
  ])
  expect(kanban.columns[0]?.cards[1]).toEqual({ label: 'Ship it', assigned: 'sverre', priority: 'High', ticket: '' })
  expect(kanban.columns[1]?.cards[0]?.ticket).toBe('SK-1')
  expect(chartHeading(kanban, EN.chart)).toEqual({ kind: 'Kanban', count: '3 cards' })
})

test('a mindmap nests by indent and reads node shapes', async () => {
  const mindmap = parseMermaid('mindmap\n  root((Skins))\n    Charts\n      Pie\n    [Themes]\n      Dark') as Mindmap

  expect(mindmap.root.label).toBe('Skins')
  expect(mindmap.root.shape).toBe('circle')
  expect(mindmap.root.children.map(child => [child.label, child.shape, child.children.map(leaf => leaf.label)])).toEqual([
    ['Charts', 'plain', ['Pie']],
    ['Themes', 'square', ['Dark']],
  ])
  expect(mindmap.count).toBe(5)
})

test('a quadrant chart reads axes, quadrant names and points', async () => {
  const chart = parseMermaid('quadrantChart\n  title Reach\n  x-axis Low --> High\n  y-axis Cold --> Hot\n  quadrant-1 Expand\n  A: [0.3, 0.6]\n  B: [0.9, 0.1]') as Quadrant

  expect(chart.x).toEqual(['Low', 'High'])
  expect(chart.y).toEqual(['Cold', 'Hot'])
  expect(chart.quadrants[0]).toBe('Expand')
  expect(chart.points).toEqual([
    { label: 'A', x: 0.3, y: 0.6 },
    { label: 'B', x: 0.9, y: 0.1 },
  ])
  expect(chartHeading(chart, EN.chart)).toEqual({ kind: 'Quadrant', count: '2 points' })
})

test('a radar reads axes across lines, its curves and range', async () => {
  const radar = parseMermaid('radar-beta\n  title Grades\n  axis m["Math"], s["Science"]\n  axis e["English"]\n  curve a["Alice"]{85, 90, 80}\n  max 100\n  min 0') as Radar

  expect(radar.axes.map(axis => axis.label)).toEqual(['Math', 'Science', 'English'])
  expect(radar.curves).toEqual([{ id: 'a', label: 'Alice', values: [85, 90, 80] }])
  expect([radar.min, radar.max]).toEqual([0, 100])
  expect(chartHeading(radar, EN.chart)).toEqual({ kind: 'Radar', count: '1 curve' })
})

test('a sankey reads CSV flows and orders nodes from sources to sinks', async () => {
  const sankey = parseMermaid('sankey-beta\nFarm,Mill,120\nMill,Bread,80\nMill,Waste,40\n"Imports, raw",Mill,10') as Sankey

  expect(sankey.links.map(link => [link.from, link.to, link.value])).toEqual([
    ['Farm', 'Mill', 120],
    ['Mill', 'Bread', 80],
    ['Mill', 'Waste', 40],
    ['Imports, raw', 'Mill', 10],
  ])
  expect(sankey.nodes.indexOf('Farm')).toBeLessThan(sankey.nodes.indexOf('Mill'))
  expect(sankey.nodes.indexOf('Mill')).toBeLessThan(sankey.nodes.indexOf('Bread'))
  expect(chartHeading(sankey, EN.chart)).toEqual({ kind: 'Sankey', count: '4 flows' })
})

test('a git graph tracks branches, merges and cherry-picks', async () => {
  const git = parseMermaid([
    'gitGraph',
    '  commit id: "init"',
    '  branch dev',
    '  checkout dev',
    '  commit id: "feat" type: HIGHLIGHT',
    '  checkout main',
    '  commit type: REVERSE',
    '  merge dev tag: "v1"',
    '  cherry-pick id: "feat"',
  ].join('\n')) as GitGraph

  expect(git.branches).toEqual(['main', 'dev'])
  expect(git.commits.map(commit => [commit.branch, commit.type])).toEqual([
    ['main', 'normal'],
    ['dev', 'highlight'],
    ['main', 'reverse'],
    ['main', 'merge'],
    ['main', 'cherry'],
  ])
  const merge = git.commits[3]
  expect(merge?.tag).toBe('v1')
  expect(merge?.parents).toEqual([git.commits[2]?.id, 'feat'])
  expect(git.commits[4]?.from).toBe('feat')
  expect(chartHeading(git, EN.chart)).toEqual({ kind: 'Git graph', count: '5 commits' })
})

test('a treemap nests by indent and sums each section from its leaves', async () => {
  const treemap = parseMermaid([
    '---',
    'title: Spend',
    '---',
    'treemap-beta',
    '"Compute"',
    '    "EC2": 420',
    '    "Lambda" :::hot',
    '        "Edge": 30',
    '        "Core": 10.5',
    '"Network": 75',
  ].join('\n')) as Treemap

  expect(treemap.title).toBe('Spend')
  expect(treemap.roots.map(root => [root.label, root.value])).toEqual([
    ['Compute', 460.5],
    ['Network', 75],
  ])
  expect(treemap.roots[0]?.children[1]?.children.map(leaf => leaf.label)).toEqual(['Edge', 'Core'])
  expect(chartHeading(treemap, EN.chart)).toEqual({ kind: 'Treemap', count: '4 items' })
})

test('a packet reads ranges, single bits and +n fields end to end', async () => {
  const packet = parseMermaid('packet-beta\n  title UDP\n  0-15: "Source Port"\n  16-31: "Destination Port"\n  32: "Flag"\n  +7: "Rest"') as Packet

  expect(packet.title).toBe('UDP')
  expect(packet.fields).toEqual([
    { start: 0, end: 15, label: 'Source Port' },
    { start: 16, end: 31, label: 'Destination Port' },
    { start: 32, end: 32, label: 'Flag' },
    { start: 33, end: 39, label: 'Rest' },
  ])
  expect(chartHeading(packet, EN.chart)).toEqual({ kind: 'Packet', count: '40 bits' })
})

// skins' two series-colour tests assert facts of its noir and rose-pine themes (two slots
// sharing a colour); Hush ships one palette, so this checks that palette instead.
test('the first series colours are all distinct', async () => {
  const colors = [0, 1, 2, 3, 4].map(i => seriesColor(PALETTE, i))

  expect(new Set(colors).size).toBe(5)
})

test('a block diagram reads columns, spans, shapes, nested blocks and labelled links', async () => {
  const block = parseMermaid([
    'block-beta',
    '  columns 3',
    '  frontend["Web app"]:2 cdn(("CDN"))',
    '  space:3',
    '  block:backend:3',
    '    columns 2',
    '    api["API"] worker[["Worker"]]',
    '    db[("Postgres")] cache{"Cache"}',
    '  end',
    '  api -- "jobs" --> worker',
    '  a --> b',
  ].join('\n')) as Block
  const backend = block.parts[3]

  expect(block.columns).toBe(3)
  expect(block.parts.slice(0, 3).map(part => (part.type === 'box' ? [part.id, part.shape, part.span] : [part.type, part.span]))).toEqual([
    ['frontend', 'box', 2],
    ['cdn', 'circle', 1],
    ['gap', 3],
  ])
  expect(backend?.type === 'frame' && backend.parts.map(part => part.type === 'box' && part.shape)).toEqual(['box', 'subroutine', 'cylinder', 'diamond'])
  expect(block.links[0]).toEqual({ from: 'api', to: 'worker', label: 'jobs', arrow: 'to', line: 'solid' })
  // A link line declares the blocks it names, as Mermaid does.
  expect(block.boxes).toBe(8)
  expect(chartHeading(block, EN.chart)).toEqual({ kind: 'Block diagram', count: '8 blocks' })
})

test('an architecture places services on a grid from the sides their edges join', async () => {
  const architecture = parseMermaid([
    'architecture-beta',
    '  group cloud(cloud)[Cloud]',
    '  group data(database)[Data] in cloud',
    '  service gateway(internet)[Gateway] in cloud',
    '  service api(server)[API] in cloud',
    '  service db(database)[Database] in data',
    '  service browser(internet)[Browser]',
    '  junction mid in cloud',
    '  browser:R --> L:gateway',
    '  gateway:R --> L:api',
    '  api:B --> T:mid',
    '  mid:L -- R:db',
  ].join('\n')) as Architecture
  const at = (id: string) => architecture.services.find(service => service.id === id)

  expect(architecture.groups.map(group => [group.id, group.parent])).toEqual([
    ['cloud', null],
    ['data', 'cloud'],
  ])
  expect([at('browser'), at('gateway'), at('api'), at('mid'), at('db')].map(service => [service?.col, service?.row])).toEqual([
    [0, 0],
    [1, 0],
    [2, 0],
    [2, 1],
    [1, 1],
  ])
  expect(at('mid')?.isJunction).toBe(true)
  expect(architecture.edges[3]).toEqual({ from: 'mid', fromSide: 'L', to: 'db', toSide: 'R', label: '', arrow: 'none' })
  expect(chartHeading(architecture, EN.chart)).toEqual({ kind: 'Architecture', count: '4 services' })
})

test('a C4 diagram reads people, systems, boundaries and relations', async () => {
  const c4 = parseMermaid([
    'C4Context',
    '  title Banking',
    '  Person(customer, "Customer", "Has accounts")',
    '  Enterprise_Boundary(bank, "Big bank") {',
    '    System_Ext(mainframe, "Mainframe", "Core data")',
    '    SystemDb(email, "E-mail")',
    '  }',
    '  Rel(customer, mainframe, "Reads", "HTTPS")',
    '  BiRel(mainframe, email, "Syncs")',
  ].join('\n')) as C4
  const bank = c4.parts[1]

  expect(c4.title).toBe('Banking')
  // The kind and the boundary's fixed type stay data; the drawing names them in the reader's language.
  expect(c4.parts[0]).toMatchObject({ type: 'box', id: 'customer', shape: 'person', notes: ['Has accounts'], c4: { base: 'person', store: null, tech: '' } })
  expect(bank?.type === 'frame' && [bank.label, bank.boundary]).toEqual(['Big bank', 'enterprise'])
  expect(bank?.type === 'frame' && bank.parts.map(part => part.type === 'box' && [part.id, part.shape, part.isExternal])).toEqual([
    ['mainframe', 'box', true],
    ['email', 'cylinder', false],
  ])
  expect(c4.links.map(link => [link.label, link.arrow])).toEqual([
    ['Reads [HTTPS]', 'to'],
    ['Syncs', 'both'],
  ])
  expect(chartHeading(c4, EN.chart)).toEqual({ kind: 'C4 context', count: '3 elements' })
})

test('a C4 link through another box goes round it in a lane on narrow cards', async () => {
  const c4 = parseMermaid('C4Context\n  System(a, "Top")\n  System(b, "Middle")\n  System(c, "Bottom")\n  Rel(a, c, "Skips")') as C4
  const card = chartSvg(c4, PALETTE, 300, EN.chart)

  expect(card?.source).toMatch(/<path d="M[\d.]+ [\d.]+H[\d.]+V[\d.]+H[\d.]+"/)
  expect(card?.source).toContain('rotate(-90')
})

test('broken plans and shapes parse to nothing rather than half a chart; a score out of range clamps', async () => {
  expect(parseMermaid('gantt\n  title Empty')).toBeNull()
  expect(parseMermaid('gantt\n  dateFormat YYYY-MM-DD\n  Task :a1, after nowhere, 2d')).toBeNull()
  expect((parseMermaid('journey\n  section Work\n    Make tea: 9: Me') as Journey).steps[0]?.score).toBe(5)
  expect(parseMermaid('radar-beta\n  axis a, b, c\n  curve x{1, 2}')).toBeNull()
  expect(parseMermaid('sankey-beta\nA,B,lots')).toBeNull()
  expect(parseMermaid('gitGraph\n  commit\n  checkout nowhere')).toBeNull()
  expect(parseMermaid('quadrantChart\n  A: [1.5, 0.2]')).toBeNull()
  expect(parseMermaid('treemap-beta\n"Leaf": 5\n    "Child": 2')).toBeNull()
  expect(parseMermaid('treemap-beta\n"Empty"')).toBeNull()
  expect(parseMermaid('packet-beta\n  0-7: "A"\n  10-15: "B"')).toBeNull()
  expect(parseMermaid('block-beta\n' + Array.from({ length: 41 }, (_, i) => `  b${i}`).join('\n'))).toBeNull()
  expect(parseMermaid('architecture-beta\n  group a[A] in b\n  group b[B] in a\n  service s(server)[S] in a')).toBeNull()
  expect(parseMermaid('architecture-beta\n  service a(server)[A]\n  a:R --> L:nowhere')).toBeNull()
  expect(parseMermaid('C4Context\n  Person(a, "A")\n  Rel(a, nowhere, "x")')).toBeNull()
})

const SAMPLES = [
  'gantt\n  dateFormat YYYY-MM-DD\n  Parser :p1, 2026-10-01, 4d\n  Cards :after p1, 3d',
  'timeline\n  2002 : LinkedIn\n  2004 : Facebook',
  'journey\n  section Work\n    Make tea: 5: Me\n    Do work: 1: Me',
  "kanban\n  Todo\n    [Write docs]@{ assigned: 'sverre', priority: 'High' }\n  Done\n    [Pie]",
  'mindmap\n  root((Skins))\n    Charts\n    Themes',
  'quadrantChart\n  x-axis Low --> High\n  y-axis Cold --> Hot\n  A: [0.3, 0.6]',
  'radar-beta\n  axis a["Speed"], b["Power"], c["Range"]\n  curve x["Ship"]{3, 4, 5}',
  'sankey-beta\nFarm,Mill,120\nMill,Bread,80',
  'gitGraph\n  commit\n  branch dev\n  commit\n  checkout main\n  merge dev',
  'treemap-beta\n"Compute"\n    "EC2": 420\n    "Lambda": 160\n"Storage"\n    "S3": 210\n"Network": 75',
  'packet-beta\n  0-15: "Source Port"\n  16-31: "Destination Port"\n  32: "URG"\n  33: "ACK"\n  34-63: "Rest"',
  'block-beta\n  columns 3\n  a["Web"]:2 b(("CDN"))\n  block:back:3\n    c[("DB")] d{"Cache"}\n  end\n  a --> c\n  b -- "push" --> a',
  'architecture-beta\n  group cloud(cloud)[Cloud]\n  service api(server)[API] in cloud\n  service db(database)[Database] in cloud\n  junction mid\n  api:R --> L:db\n  api:B -- T:mid',
  'C4Context\n  Person(u, "User", "Signs in")\n  System_Boundary(s, "Shop") {\n    System(web, "Web", "Sells things")\n  }\n  Rel(u, web, "Buys", "HTTPS")',
]

// One chart of every kind, its own text in Spanish, holding each word the card adds: an
// external database and a boundary in C4, a merge and a cherry-pick, an empty kanban column
// and an empty group, a journey's actors, unnamed series, done and active tasks, day and
// month ticks.
const SPANISH_CHARTS = [
  'flowchart TD\n  A[Plan] --> B[Obra]\n  B -->|sí| A',
  'xychart-beta\n  x-axis [lun, mié]\n  bar [1, 2]\n  line [2, 3]\n  line [3, 1]',
  'pie title Mascotas\n  "Perros" : 3\n  "Gatos" : 1',
  'gantt\n  dateFormat YYYY-MM-DD\n  Análisis :done, a1, 2026-10-01, 4d\n  Cartas :active, after a1, 3d',
  'gantt\n  dateFormat YYYY-MM-DD\n  Largo :l1, 2026-01-01, 300d',
  'timeline\n  2002 : Inicio\n  2004 : Fin',
  'journey\n  section Trabajo\n    Hacer té: 5: Yo\n    Trabajar: 1: Yo, Gato',
  'kanban\n  Pendiente\n    [Escribir]\n  Hecho',
  'mindmap\n  root((Raíz))\n    Uno\n    Dos',
  'quadrantChart\n  x-axis Bajo --> Alto\n  y-axis Frío --> Caliente\n  A: [0.3, 0.6]',
  'radar-beta\n  axis a["Velocidad"], b["Fuerza"], c["Alcance"]\n  curve x["Nave"]{3, 4, 5}',
  'sankey-beta\nGranja,Molino,120\nMolino,Pan,80',
  'gitGraph\n  commit id: "inicio"\n  branch dev\n  checkout dev\n  commit id: "rasgo"\n  checkout main\n  merge dev\n  cherry-pick id: "rasgo"',
  'treemap-beta\n"Cómputo"\n    "Uno": 4\n"Red": 2',
  'packet-beta\n  0-15: "Origen"\n  16-31: "Destino"',
  'block-beta\n  columns 2\n  a["Web"] b(("CDN"))\n  a --> b',
  'architecture-beta\n  group nube(cloud)[Nube]\n  group hueco(cloud)[Hueco]\n  service api(server)[API] in nube\n  service bd(database)[Datos] in nube\n  api:R --> L:bd',
  'C4Container\n  title Banco\n  Person_Ext(c, "Cliente")\n  Enterprise_Boundary(b, "Banco grande") {\n    ContainerDb_Ext(d, "Datos", "SQL", "Guarda")\n    System(s, "Núcleo")\n  }\n  Rel(c, s, "Lee")',
]

// Every word a card shows or says: its texts, its tooltips and its alt.
const said = (words: typeof EN.chart): string =>
  SPANISH_CHARTS.map(source => {
    const card = chartSvg(parseMermaid(source) as Chart, PALETTE, 640, words)

    expect(card).not.toBeNull()

    const texts = [...(card?.source ?? '').matchAll(/<(text|title)\b[^>]*>([\s\S]*?)<\/\1>/g)].map(match => (match[2] ?? '').replace(/<[^>]*>/g, ' '))

    return [...texts, card?.alt ?? ''].join('\n')
  }).join('\n')

test('in Spanish no chart draws or says an English word', async () => {
  const text = said(ES.chart)
  const english = /\b(flowchart|chart|pie|timeline|journey|mindmap|quadrant|graph|treemap|packet|diagram|architecture|context|container|component|person|system|external|database|queue|enterprise|steps?|points?|slices?|tasks?|periods?|cards?|nodes?|curves?|flows?|items?|services?|elements?|blocks?|bar|line|empty|with|to|done|active|merge)\b/i
  const months = /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/

  expect(text.match(english)?.[0] ?? null).toBeNull()
  expect(text.match(months)?.[0] ?? null).toBeNull()
  // The words each kind adds, in Spanish.
  for (const word of ['DIAGRAMA DE FLUJO', 'Gráfico circular: Mascotas', '2 sectores', 'barras', 'línea 1', 'del 2026-10-01 al 2026-10-05 (terminada)', '(en curso)', 'ene 2026', 'con Yo, Gato', 'sin elementos', 'Hueco: sin elementos', 'fusión de', 'cherry-pick de rasgo', 'Persona externa', 'Contenedor de base de datos externo · SQL', 'empresa', 'C4 DE CONTENEDORES', 'total']) {
    expect(text).toContain(word)
  }
  expect(text).toMatch(/\b\d{1,2} oct\b/)
})

test('with English words the same charts speak English', async () => {
  const text = said(EN.chart)

  for (const word of ['FLOWCHART', 'Pie: Mascotas', '2 slices', 'bar', 'line 1', '2026-10-01 to 2026-10-05 (done)', '(active)', 'Jan 2026', 'with Yo, Gato', 'Hueco: empty', 'merge ', 'cherry-pick rasgo', 'External person', 'External container database · SQL', 'enterprise', 'C4 CONTAINER', 'total']) {
    expect(text).toContain(word)
  }
  expect(text).toMatch(/\bOct \d{1,2}\b/)
})

test('the gantt card lays tasks on dates, and the alt reads them back', async () => {
  const gantt = parseMermaid('gantt\n  title Plan\n  dateFormat YYYY-MM-DD\n  Parser :done, p1, 2026-10-01, 4d\n  Cards :after p1, 3d') as Gantt
  const card = chartSvg(gantt, PALETTE, 640, EN.chart)

  expect(card?.source).toContain('Parser')
  expect(card?.alt).toContain('Parser: 2026-10-01 to 2026-10-05 (done)')
  expect(card?.alt).toContain('Cards: 2026-10-05 to 2026-10-08')
})
