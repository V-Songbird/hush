import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

import { parseMermaid } from './mermaid/mermaid'
import { DARK, EN, ES, LIGHT, isSpanish, themedChart } from './register'
import { cite, splitReply } from './reply'

const FLOW = '```mermaid\nflowchart LR\n  A[Ask] --> B[Answer]\n```'

// Each hook here stands for the engine beneath the mod: its theme setting and its own row.
const mount = async (
  $: Engine,
  on: On,
  text: string,
  surface: 'desktop' | 'terminal' = 'desktop',
  disable?: string,
  calls: string[] = [],
) => {
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    calls.push(e.props.text)

    return <Text>{`engine: ${e.props.text}`}</Text>
  })
  on('env.get', (_, e) => ({ value: e.name === 'HUSH_DISABLE' ? disable : undefined }))

  return $.ui.mount({ plugin: 'hush', component: 'AssistantMessage', surface, props: { text, isFirstOfReply: true } } as never)
}

test('a reply with no chart or alert is the app’s whole', async ($, on) => {
  const ui = await mount($, on, '**Done.**\n\n```search_tree\nWhy?\n└── [p=1] Because\n```\n\nSee <kbd>Ctrl</kbd>.')

  expect((await ui.find({ type: 'Text', text: /engine/ }))?.text).toMatch(/^engine: \*\*Done\.\*\*/)
  expect(await ui.find({ type: 'Svg' })).toBeUndefined()
  await ui.unmount()
})

// A message holds one engine drawing, and the first `next` call wins: the drawings come first,
// in authored order, then all the prose in one call to the app's own renderer.
const SPLIT = `**Result.**\n\nP0.\n\n> [!WARNING]\n> Risk.\n\nP1.\n\n${FLOW}\n\nP2 is the last line.`

test('a split reply draws its drawings first, then all its prose in one app drawing', async ($, on) => {
  const calls: string[] = []
  const ui = await mount($, on, SPLIT, 'desktop', undefined, calls)
  const tree = (await ui.find({ type: 'Box' })) as unknown as { children: { type: string; props?: { key?: string } }[] }

  // Exactly one call reaches the app, with every prose part in authored order.
  expect(calls).toEqual(['**Result.**\n\nP0.\n\nP1.\n\nP2 is the last line.'])
  expect(await ui.find({ type: 'Markdown', text: /P0/ })).toBeUndefined()
  // The warning, then the chart, then the prose.
  expect(tree.children.map(child => `${child.type}:${child.props?.key ?? ''}`)).toEqual(['Box:alert1', 'Svg:', 'Box:prose'])
  // The blocks sit apart by a named step, not a count of cells.
  const outer = (await ui.findAll({ type: 'Box' }))[0]
  expect(outer?.props.gap).toBe('md')
  expect(outer?.props.rowGap).toBeUndefined()
  await ui.unmount()
})

test('nothing is dropped: the prose is the reply without its drawn blocks', async ($, on) => {
  const calls: string[] = []
  const ui = await mount($, on, SPLIT, 'desktop', undefined, calls)
  const words = (text: string) => text.split(/\s+/).filter(Boolean)
  const withoutDrawn = SPLIT.replace(FLOW, '').replace('> [!WARNING]\n> Risk.', '')

  expect(words(calls.join('\n'))).toEqual(words(withoutDrawn))
  await ui.unmount()
})

test('a footnote reference and its note reach the app in the same drawing', async ($, on) => {
  const calls: string[] = []
  const ui = await mount($, on, `See this[^1].\n\n${FLOW}\n\n[^1]: The note.\n\n---\n\n**Next:** read it.`, 'desktop', undefined, calls)

  expect(calls).toEqual(['See this¹.\n\n[1] The note.\n\n---\n\n**Next:** read it.'])
  await ui.unmount()
})

test('the terminal is never touched', async ($, on) => {
  const ui = await mount($, on, `**Result.**\n\n${FLOW}`, 'terminal')

  // The whole reply, fence included, reaches the app in one piece.
  expect((await ui.find({ type: 'Text', text: /engine/ }))?.text).toContain('```mermaid')
  await ui.unmount()
})

test('HUSH_DISABLE=1 leaves a mermaid reply to the app', async ($, on) => {
  const ui = await mount($, on, `**Result.**\n\n${FLOW}`, 'desktop', '1')

  expect((await ui.find({ type: 'Text', text: /engine/ }))?.text).toContain('```mermaid')
  expect(await ui.find({ type: 'Svg' })).toBeUndefined()
  await ui.unmount()
})

// The mod adds nothing to the person's command list, and a plain final message writes nothing.
test('a session start registers no command, and a final message writes nothing', async ($, on) => {
  const registered: string[] = []
  const written: string[] = []
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 's1' }))
  on('store.get', () => ({ value: undefined }))
  on('store.set', (_, e) => {
    written.push(e.key)

    return { value: undefined }
  })
  on('command.register', (_, e) => {
    registered.push(e.name)

    return { value: { command: e.name } }
  })
  on('turn.complete', () => ({ text: '' }))
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work' } as never)
  await $.turn.complete({ answer: '**Done.**\n\n---\n\n**Next:** read it.', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })

  expect(registered).toEqual([])
  expect(written).toEqual([])
})

// The app's own banner shows an icon and no title text, so the box carries no "Warning" label.
test('an alert draws as a box with its icon and no title text', async ($, on) => {
  const ui = await mount($, on, '**Result.**\n\n> [!WARNING]\n> The cache is stale.')

  expect(await ui.find({ type: 'Text', text: /^Warning$/ })).toBeUndefined()
  expect(await ui.find({ type: 'Svg' })).toBeDefined()
  await ui.unmount()
})

// The icon keeps its alert's own colour, light and dark; the box takes the alert's theme key.
test('an alert icon draws in its alert colour, its box in the alert theme key', async ($, on) => {
  const ui = await mount($, on, '**Result.**\n\n> [!WARNING]\n> The cache is stale.')
  const icon = await ui.find({ type: 'Svg' })

  expect(icon?.props.source).toContain('path{fill:#734500}')
  expect(icon?.props.source).toContain('path{fill:#db9300}')
  expect((await ui.findAll({ type: 'Box' })).some(box => box.props.borderColor === 'warning')).toBe(true)
  await ui.unmount()
})

// Every string the person reads comes from the catalog the `language` setting picks.
const SPANISH = () => ({ value: { language: 'Español' } })
const ALERTS = '**Result.**\n\n> [!TIP]\n> Another way.\n\nProse.\n\n> [!WARNING]\n> Not run.'

test('in a Spanish session every alert icon speaks Spanish', async ($, on) => {
  on('settings.read', SPANISH)
  const ui = await mount($, on, ALERTS)

  expect((await ui.findAll({ type: 'Svg' })).map(svg => svg.props.alt)).toEqual(['Consejo', 'Advertencia'])
  await ui.unmount()
})

test('with no language set, the alert icons speak English', async ($, on) => {
  const ui = await mount($, on, ALERTS)

  expect((await ui.findAll({ type: 'Svg' })).map(svg => svg.props.alt)).toEqual(['Tip', 'Warning'])
  await ui.unmount()
})

// A fold an earlier reply stored, found again at session start, and its first row drawn on
// the desktop: the folded line it gets.
const FOLD = { head: 'text:Now I check the store.', texts: ['Now I check the store.'], tools: ['toolu_a'], errors: 1, warnings: 1 }
const foldedLine = async ($: Engine, on: On) => {
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 's1' }))
  on('store.get', (_, e) => ({ value: e.key === 'folds-2:s1' ? [FOLD] : undefined }))
  on('ui.render', ($, e) => $.ui.resolve(e).Text({ children: 'engine' }))
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work' } as never)
  const ui = await $.ui.mount({ plugin: 'hush', component: 'AssistantMessage', surface: 'desktop', props: { text: 'Now I check the store.', isFirstOfReply: true } } as never)
  const all = JSON.stringify(await ui.find({ type: 'Box' }))
  await ui.unmount()

  return all
}

test('the folded line speaks Spanish in a Spanish session', async ($, on) => {
  on('settings.read', SPANISH)
  const line = await foldedLine($, on)

  expect(line).toContain('Ver 1 mensaje de avance')
  expect(line).toContain('1 falló')
  expect(line).toContain('1 aviso')
})

test('the folded line speaks English when no language is set', async ($, on) => {
  const line = await foldedLine($, on)

  expect(line).toContain('Show 1 progress message')
  expect(line).toContain('1 failed')
  expect(line).toContain('1 warning')
})

test('the language setting names Spanish in its own words, in English or as a tag; both catalogs have the same keys', () => {
  for (const v of ['Español', 'español (México)', 'Spanish', 'es', 'es-MX', 'es_419']) expect(isSpanish(v)).toBe(true)
  for (const v of [undefined, '', 'English', 'Estonian', 'Deutsch', 42]) expect(isSpanish(v)).toBe(false)

  const keys = (o: object): string[] =>
    Object.entries(o).flatMap(([k, v]) => (typeof v === 'object' && v !== null ? keys(v).map(sub => `${k}.${sub}`) : [k])).sort()

  expect(keys(ES)).toEqual(keys(EN))
  for (const v of Object.values(ES.alerts)) expect(v).not.toBe('')
})

test('both chart catalogs have the same keys: every kind, level, unit and month', () => {
  const keys = (o: object): string[] =>
    Object.entries(o).flatMap(([k, v]) => (typeof v === 'object' && v !== null ? keys(v).map(sub => `${k}.${sub}`) : [k])).sort()

  expect(keys(ES.chart)).toEqual(keys(EN.chart))
  expect(keys(EN.chart)).toContain('months.11')
  expect(keys(EN.chart)).toContain('kinds.architecture')
})

const PIE = '```mermaid\npie title Pets\n  "Dogs" : 3\n  "Cats" : 1\n```'

test('in a Spanish session a chart picture draws and says Spanish', async ($, on) => {
  on('settings.read', SPANISH)
  const ui = await mount($, on, `**Result.**\n\n${PIE}`)
  const svg = await ui.find({ type: 'Svg' })

  expect(svg?.props.alt).toBe('Gráfico circular: Pets\nDogs: 3 (75%)\nCats: 1 (25%)')
  expect(svg?.props.source).toContain('>Gráfico circular<')
  expect(svg?.props.source).toContain('2 sectores')
  await ui.unmount()
})

test('with no language set, a chart picture draws and says English', async ($, on) => {
  const ui = await mount($, on, `**Result.**\n\n${PIE}`)
  const svg = await ui.find({ type: 'Svg' })

  expect(svg?.props.alt).toBe('Pie: Pets\nDogs: 3 (75%)\nCats: 1 (25%)')
  expect(svg?.props.source).toContain('>Pie<')
  expect(svg?.props.source).toContain('2 slices')
  await ui.unmount()
})

test('a note or a tip is a line led by its icon, with no box', async ($, on) => {
  const ui = await mount($, on, '**Result.**\n\n> [!TIP]\n> Another way.\n\nProse.\n\n> [!NOTE]\n> It assumes Claude Code.\n\nProse.\n\n> [!WARNING]\n> Not run.')
  const boxes = (await ui.findAll({ type: 'Box' })).filter(box => box.props.borderStyle !== undefined)

  // Three alerts, three icons, and only the warning boxed.
  expect((await ui.findAll({ type: 'Svg' })).length).toBe(3)
  expect(boxes.map(box => box.props.borderColor)).toEqual(['warning'])
  await ui.unmount()
})

test('one chart picture carries both themes, each shown only under its own scheme', () => {
  const chart = parseMermaid('flowchart LR\n  A[Ask] --> B[Answer]')
  const built = chart === null ? null : themedChart(chart, 600, EN.chart)
  const source = built?.source ?? ''

  expect(source).toContain('@media (prefers-color-scheme:dark){.hl{display:none}}')
  // Text and neutral marks take the app's text ink in both drawings, as attributes: no sheet
  // rule paints text, and no neutral grey is copied in.
  expect(LIGHT.fg).toBe('currentColor')
  expect(DARK.muted).toBe('currentColor')
  expect(source.match(/<g class="card" fill="currentColor">/g)?.length).toBe(2)
  expect(source).toContain('fill="currentColor" fill-opacity="0.6"')
  expect(source).not.toMatch(/text\{fill:/)
  expect(source).not.toMatch(/#0b0b0b|#f0efec|#52514e|#c3c2b7/i)
  // Each drawing points only at its own arrowhead and corners.
  expect(source).toContain('id="hd-arrow-')
  expect(source).not.toMatch(/url\(#(?!h[ld]-)/)
})

test('split: only mermaid fences the parser reads and alerts leave the markdown', () => {
  expect(splitReply('Plain.\n\n```js\nx()\n```')).toBeNull()
  expect(splitReply('```mermaid\nnot a chart at all\n```')).toBeNull()
  // A fence still streaming stays markdown.
  expect(splitReply('```mermaid\nflowchart LR\n  A --> B')).toBeNull()
  // A mermaid fence inside another fence is code, not a chart.
  expect(splitReply('````md\n```mermaid\nflowchart LR\n  A --> B\n```\n````')).toBeNull()

  const parts = splitReply(`One.\n\n${FLOW}\n\n> [!TIP]\n> Body.\n\nTwo.`) ?? []
  expect(parts.map(part => part.kind)).toEqual(['markdown', 'chart', 'alert', 'markdown'])
})

test('split: footnotes stay where the reply put them, as plain marked lines', () => {
  const parts = splitReply(`See this[^1].\n\n${FLOW}\n\n---\n\n[^1]: The note.\n\n[^a]: Another.\n\n---\n\nNext.`) ?? []

  expect(parts.map(part => part.kind)).toEqual(['markdown', 'chart', 'markdown', 'notes', 'markdown'])
  expect(parts[3]).toEqual({ kind: 'notes', text: '[1] The note.\n[a] Another.' })
})

test('cite: a reference becomes a mark that links nowhere', () => {
  expect(cite('See this[^12] and that[^a].')).toBe('See this¹² and that[a].')
})

test('cite: a key tag becomes inline code, which the engine draws', () => {
  expect(cite('<kbd>Ctrl</kbd> + <kbd>C</kbd> opens it.')).toBe('`Ctrl` + `C` opens it.')
})
