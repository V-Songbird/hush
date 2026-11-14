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
) => {
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine</Text>
  })
  on('env.get', (_, e) => ({ value: e.name === 'HUSH_DISABLE' ? disable : undefined }))

  return $.ui.mount({ plugin: 'hush', component: 'AssistantMessage', surface, props: { text, isFirstOfReply: true } } as never)
}

test('a reply with no chart or alert is the app’s whole', async ($, on) => {
  const ui = await mount($, on, '**Done.**\n\n```search_tree\nWhy?\n└── [p=1] Because\n```\n\nSee <kbd>Ctrl</kbd>.')

  expect((await ui.find({ type: 'Text', text: /engine/ }))?.text).toBe('engine')
  expect(await ui.find({ type: 'Svg' })).toBeUndefined()
  await ui.unmount()
})

test('a mermaid fence draws as a picture between markdown blocks', async ($, on) => {
  const ui = await mount($, on, `**Result.**\n\n${FLOW}\n\nAfter.`)

  expect(await ui.find({ type: 'Svg' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /engine/ })).toBeUndefined()
  await ui.unmount()
})

test('the terminal is never touched', async ($, on) => {
  const ui = await mount($, on, `**Result.**\n\n${FLOW}`, 'terminal')

  expect((await ui.find({ type: 'Text', text: /engine/ }))?.text).toBe('engine')
  await ui.unmount()
})

test('HUSH_DISABLE=1 leaves a mermaid reply to the app', async ($, on) => {
  const ui = await mount($, on, `**Result.**\n\n${FLOW}`, 'desktop', '1')

  expect((await ui.find({ type: 'Text', text: /engine/ }))?.text).toBe('engine')
  expect(await ui.find({ type: 'Svg' })).toBeUndefined()
  await ui.unmount()
})

// The tally is the mod's one write to disk; HUSH_DISABLE=1 must leave it alone.
const stores = async ($: Engine, on: On, disable?: string) => {
  const keys: string[] = []
  on('env.get', (_, e) => ({ value: e.name === 'HUSH_DISABLE' ? disable : undefined }))
  on('session.cwd', () => ({ value: '/work' }))
  on('store.get', () => ({ value: undefined }))
  on('store.set', (_, e) => {
    keys.push(e.key)

    return { value: undefined }
  })
  on('turn.complete', () => ({ text: '' }))
  await $.turn.complete({ answer: '**Done.**\n\n---\n\n**Next:** read it.', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })

  return keys
}

test('a final message adds to the tally', async ($, on) => {
  expect((await stores($, on)).length).toBeGreaterThan(0)
})

test('HUSH_DISABLE=1 writes no tally', async ($, on) => {
  expect(await stores($, on, '1')).toEqual([])
})

// The app's own banner shows an icon and no title text, so the box carries no "Warning" label.
test('an alert draws as a box with its icon and no title text', async ($, on) => {
  const ui = await mount($, on, '**Result.**\n\n> [!WARNING]\n> The cache is stale.')

  expect(await ui.find({ type: 'Text', text: /^Warning$/ })).toBeUndefined()
  expect(await ui.find({ type: 'Svg' })).toBeDefined()
  await ui.unmount()
})

// Every string the person reads comes from the catalog the `language` setting picks.
const SPANISH = () => ({ value: { language: 'Español' } })
const ALERTS = '**Result.**\n\n> [!TIP]\n> Another way.\n\nProse.\n\n> [!WARNING]\n> Not run.'
const RUN = { command: 'hush-lint', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } } as never

// The engine beneath, registered before the first `$` call: a session id, a store that holds
// nothing, and the registered command, whose description it keeps.
const beneath = (on: On) => {
  const described: string[] = []
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 's1' }))
  on('store.get', () => ({ value: undefined }))
  on('command.register', (_, e) => {
    described.push(e.description ?? '')

    return { value: { command: 'hush-lint' } }
  })

  return described
}

const commandText = async ($: Engine) => {
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work' } as never)

  return JSON.stringify(await $.command.run(RUN))
}

test('in a Spanish session every alert icon, the command and its report speak Spanish', async ($, on) => {
  on('settings.read', SPANISH)
  const described = beneath(on)
  const ui = await mount($, on, ALERTS)

  expect((await ui.findAll({ type: 'Svg' })).map(svg => svg.props.alt)).toEqual(['Consejo', 'Advertencia'])
  await ui.unmount()

  const text = await commandText($)
  expect(described).toEqual([ES.command])
  expect(text).toContain('El último prompt de Hush aún no se ha compuesto.')
  expect(text).toContain('Con la sección de escritorio: ninguno revisado aún.')
  expect(text).toContain('Sin ella: ninguno revisado aún.')
})

test('with no language set, the alerts, the command and its report speak English', async ($, on) => {
  const described = beneath(on)
  const ui = await mount($, on, ALERTS)

  expect((await ui.findAll({ type: 'Svg' })).map(svg => svg.props.alt)).toEqual(['Tip', 'Warning'])
  await ui.unmount()

  const text = await commandText($)
  expect(described).toEqual([EN.command])
  expect(text).toContain('The last Hush prompt has not been composed yet.')
  expect(text).toContain('With the desktop section: none checked yet.')
  expect(text).toContain('Without it: none checked yet.')
})

// A fold an earlier reply stored, found again at session start, and its first row drawn on
// the desktop: the folded line it gets.
const FOLD = { head: 'text:Now I check the store.', texts: ['Now I check the store.'], tools: ['toolu_a'], errors: 1, warnings: 1 }
const foldedLine = async ($: Engine, on: On) => {
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 's1' }))
  on('store.get', (_, e) => ({ value: e.key === 'folds-2:s1' ? [FOLD] : undefined }))
  on('command.register', () => ({ value: { command: 'hush-lint' } }))
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
