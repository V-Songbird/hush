import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

import { EN, ES, isSpanish } from './register'

// Each hook here stands for the engine beneath the mod: its own row.
const mount = async ($: Engine, on: On, text: string, surface: 'desktop' | 'terminal' = 'desktop', disable?: string) => {
  on('ui.render', ($, e) => $.ui.resolve(e).Text({ children: `engine: ${e.props.text}` }))
  on('env.get', (_, e) => ({ value: e.name === 'HUSH_DISABLE' ? disable : undefined }))

  return $.ui.mount({ plugin: 'hush', component: 'AssistantMessage', surface, props: { text, isFirstOfReply: true } } as never)
}

const REPLY = '**Result.**\n\nAfter.'

test('a reply outside every fold is the app’s whole on the desktop', async ($, on) => {
  const ui = await mount($, on, REPLY)

  expect((await ui.find({ type: 'Text', text: /engine/ }))?.text).toBe(`engine: ${REPLY}`)
  await ui.unmount()
})

test('the terminal is never touched', async ($, on) => {
  const ui = await mount($, on, REPLY, 'terminal')

  expect((await ui.find({ type: 'Text', text: /engine/ }))?.text).toBe(`engine: ${REPLY}`)
  await ui.unmount()
})

test('HUSH_DISABLE=1 leaves a reply to the app', async ($, on) => {
  const ui = await mount($, on, REPLY, 'desktop', '1')

  expect((await ui.find({ type: 'Text', text: /engine/ }))?.text).toBe(`engine: ${REPLY}`)
  await ui.unmount()
})

// The mod adds nothing to the person's command list (what it writes: `flow.test.tsx`).
test('a session start registers no command', async ($, on) => {
  const registered: string[] = []
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 's1' }))
  on('store.get', () => ({ value: undefined }))
  on('command.register', (_, e) => {
    registered.push(e.name)

    return { value: { command: e.name } }
  })
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work' } as never)

  expect(registered).toEqual([])
})

// Every string the person reads comes from the catalog the `language` setting picks.
const SPANISH = () => ({ value: { language: 'Español' } })

// A fold an earlier reply stored, found again at session start, and its first row drawn on
// the desktop: the folded line it gets.
const FOLD = { head: 'Now I check the store.', final: 'Done.', texts: ['Now I check the store.'], errors: 1, warnings: 1 }
const foldedLine = async ($: Engine, on: On) => {
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 's1' }))
  on('store.get', (_, e) => ({ value: e.key === 'folds-3:s1' ? { folds: [FOLD], loose: ['Done.'] } : undefined }))
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
})
