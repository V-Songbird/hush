import { expect, test } from 'claude-code/testing'

import { foldOf, isReprompt, labelOf, placeOf } from './fold'
import type { Item } from './fold'
import { EN, ES } from './register'

const text = (head: string): Item => ({ kind: 'text', head })
const tool = (id: string): Item => ({ kind: 'tool', id })

test('fold: the work before the final folds; the final stays out', () => {
  const items = [text('Reading the config.'), tool('toolu_a'), tool('toolu_b'), text('**Done.**')]
  const fold = foldOf({ items, texts: ['Reading the config.', '**Done.**'], errors: 1 })

  expect(fold).toEqual({ head: 'text:Reading the config.', texts: ['Reading the config.'], tools: ['toolu_a', 'toolu_b'], errors: 1, warnings: 0 })
  expect(labelOf(fold!, EN.fold)).toEqual({ text: 'Show 1 progress message', errors: '1 failed' })
  expect(labelOf(fold!, EN.fold, true).text).toBe('Hide 1 progress message')
})

// The line follows the conversation's language setting, not the texts it hides (owner, 2026-11-03).
test('label: the line speaks the catalog it is given, whatever language the hidden texts use', () => {
  const items = [text('Now I check the store.'), tool('toolu_a'), text('That is it.'), tool('toolu_b'), text('**Done.**')]
  const fold = foldOf({ items, texts: ['Now I check the store.', 'That is it.', '**Done.**'], errors: 2 })!

  expect(labelOf(fold, ES.fold)).toEqual({ text: 'Ver 2 mensajes de avance', errors: '2 fallaron' })
  expect(labelOf(fold, ES.fold, true).text).toBe('Ocultar 2 mensajes de avance')
  expect(labelOf({ ...fold, errors: 1, warnings: 1 }, ES.fold)).toEqual({ text: 'Ver 2 mensajes de avance', errors: '1 falló', warnings: '1 aviso' })
  expect(labelOf(fold, EN.fold).text).toBe('Show 2 progress messages')
})

test('fold: a reply that ends on a tool call has no final message, so nothing folds', () => {
  expect(foldOf({ items: [tool('toolu_a'), text('Checking.'), tool('toolu_b')], texts: ['Checking.'], errors: 0 })).toBeNull()
})

test('fold: a reply that is only its final message folds nothing', () => {
  expect(foldOf({ items: [text('Hi.')], texts: ['Hi.'], errors: 0 })).toBeNull()
  expect(foldOf({ items: [tool('toolu_a')], texts: [], errors: 0 })).toBeNull()
})

test('place: text rows join by content; tool rows stay under the app header', () => {
  const fold = foldOf({ items: [tool('toolu_a'), text('Found it.'), tool('toolu_b'), text('Then this.'), text('Final.')], texts: ['Found it.', 'Then this.', 'Final.'], errors: 0 })!

  expect(placeOf(fold, { kind: 'text', text: 'Found  it.' })).toBe('head')
  expect(placeOf(fold, { kind: 'text', text: 'Then this.' })).toBe('member')
  expect(placeOf(fold, { kind: 'tool', id: 'group:toolu_a' })).toBeUndefined()
  expect(placeOf(fold, { kind: 'text', text: 'Final.' })).toBeUndefined()
})

test('fold: a reply with only tools before its final folds nothing; the app header covers it', () => {
  expect(foldOf({ items: [tool('toolu_a'), tool('toolu_b'), text('Final.')], texts: ['Final.'], errors: 0 })).toBeNull()
})

test('fold: folded text naming a failure the final does not counts as a warning', () => {
  const fold = foldOf({ items: [text('The server failed with a 500.'), tool('toolu_a'), text('Played 39 points.')], texts: ['The server failed with a 500.', 'Played 39 points.'], errors: 0 })

  expect(fold?.warnings).toBe(1)
  expect(labelOf(fold!, EN.fold)).toEqual({ text: 'Show 1 progress message', warnings: '1 warning' })
})

test('re-prompt: a Stop hook feedback row ends a reply; a typed prompt does not', () => {
  expect(isReprompt('Stop hook feedback:\n[goal]: not yet')).toBe(true)
  expect(isReprompt('Stop the build please')).toBe(false)
})
