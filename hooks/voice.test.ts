import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

import { SECTION_ALERTS, settingsOf } from './lint'
import { DESKTOP_HEADING, DESKTOP_SECTION, teachesDesktop } from './voice'

const HUSH = { name: 'hush:Hush', isKeepingCodingInstructions: true }
// The desktop app's sessions carry `print`, as the runtime probe logged.
const DESKTOP = { surfaces: ['desktop'] as const, traits: ['lean', 'print', 'skills'] as never, outputStyle: HUSH }
const RICH = settingsOf(undefined)

test('Hush on the desktop alone, with rich Markdown, takes the section', () => {
  expect(teachesDesktop(DESKTOP, RICH)).toBe(true)
})

test('anywhere else, or with another Markdown setting, the ban stays', () => {
  expect(teachesDesktop({ ...DESKTOP, surfaces: ['terminal', 'desktop'] }, RICH)).toBe(false)
  expect(teachesDesktop({ ...DESKTOP, surfaces: [] }, RICH)).toBe(false)
  expect(teachesDesktop({ ...DESKTOP, outputStyle: null }, RICH)).toBe(false)
  expect(teachesDesktop({ ...DESKTOP, traits: ['bare'] as never }, RICH)).toBe(false)
  expect(teachesDesktop(DESKTOP, settingsOf({ markdown: 'basic' }))).toBe(false)
})

// The rule lives in output-styles/hush.md; tests/desktop_mod.test.js checks that it names
// SECTION_ALERTS and this heading. The section itself is only the marker.
test('the section is a marker that names no rule of its own', () => {
  expect(DESKTOP_SECTION.startsWith(DESKTOP_HEADING)).toBe(true)
  expect(DESKTOP_SECTION).not.toContain('[!')
  expect(SECTION_ALERTS.length).toBe(2)
})

// The hook beneath stands for the engine's own prompt.
const ids = async ($: Engine, on: On, surfaces: ('terminal' | 'desktop')[], disable?: string) => {
  on('prompt.compose', () => ({ sections: [{ id: 'lean_body', text: 'body', scope: 'shared' as const }] }))
  // The mod records the decision for the lint; the store beneath keeps nothing here.
  on('store.set', () => ({ value: undefined }))
  on('env.get', (_, e) => ({ value: e.name === 'HUSH_DISABLE' ? disable : undefined }))
  const result = await $.prompt.compose({ model: 'claude-opus-5-5', promptModel: 'claude-opus-5-5', tools: [], surfaces, traits: DESKTOP.traits, outputStyle: HUSH })

  return result.sections.map(s => s.id)
}

test('the section comes last, on the desktop only', async ($, on) => {
  expect(await ids($, on, ['desktop'])).toEqual(['lean_body', 'hush:desktop'])
})

test('a terminal keeps the prompt as it was', async ($, on) => {
  expect(await ids($, on, ['terminal'])).toEqual(['lean_body'])
})

test('HUSH_DISABLE=1 keeps the prompt as it was on the desktop too', async ($, on) => {
  expect(await ids($, on, ['desktop'], ' 1 ')).toEqual(['lean_body'])
})
