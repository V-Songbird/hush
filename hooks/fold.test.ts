import { expect, test } from 'claude-code/testing'

import { fitted, foldOf, isReprompt, labelOf, looseOf, placeOf } from './fold'
import type { Item } from './fold'
import { EN, ES } from './register'

const text = (head: string): Item => ({ kind: 'text', head })
const tool: Item = { kind: 'tool' }

test('fold: the work before the final folds; the final stays out', () => {
  const items = [text('Reading the config.'), tool, tool, text('**Done.**')]
  const fold = foldOf({ items, texts: ['Reading the config.', '**Done.**'], errors: 1 })

  expect(fold).toEqual({ head: 'Reading the config.', final: '**Done.**', texts: ['Reading the config.'], errors: 1, warnings: 0 })
  expect(labelOf(fold!, 1, EN.fold)).toEqual({ text: 'Show 1 progress message', errors: '1 failed' })
  expect(labelOf(fold!, 1, EN.fold, true).text).toBe('Hide 1 progress message')
})

// The line follows the conversation's language setting, not the texts it hides (owner, 2026-11-03).
test('label: the line speaks the catalog it is given, whatever language the hidden texts use', () => {
  const items = [text('Now I check the store.'), tool, text('That is it.'), tool, text('**Done.**')]
  const fold = foldOf({ items, texts: ['Now I check the store.', 'That is it.', '**Done.**'], errors: 2 })!

  expect(labelOf(fold, 2, ES.fold)).toEqual({ text: 'Ver 2 mensajes de avance', errors: '2 fallaron' })
  expect(labelOf(fold, 2, ES.fold, true).text).toBe('Ocultar 2 mensajes de avance')
  expect(labelOf({ ...fold, errors: 1, warnings: 1 }, 2, ES.fold)).toEqual({ text: 'Ver 2 mensajes de avance', errors: '1 falló', warnings: '1 aviso' })
  expect(labelOf(fold, 2, EN.fold).text).toBe('Show 2 progress messages')
})

test('fold: a reply that ends on a tool call has no final message, so nothing folds; all its texts stay loose', () => {
  const stored = { items: [tool, text('Checking.'), tool], texts: ['Checking.'], errors: 0 }

  expect(foldOf(stored)).toBeNull()
  expect(looseOf(stored, null)).toEqual(['Checking.'])
})

test('fold: a reply that is only its final message, or only tools before it, folds nothing', () => {
  expect(foldOf({ items: [text('Hi.')], texts: ['Hi.'], errors: 0 })).toBeNull()
  expect(foldOf({ items: [tool], texts: [], errors: 0 })).toBeNull()
  expect(foldOf({ items: [tool, tool, text('Final.')], texts: ['Final.'], errors: 0 })).toBeNull()
})

test('fold: a text that repeats the final’s first words stays out of the fold', () => {
  const final = 'All 212 tests pass and the release notes are updated.'
  const stored = { items: [text('Reading.'), tool, text(final.slice(0, 40)), tool, text(final.slice(0, 40))], texts: ['Reading.', final, final], errors: 0 }
  const fold = foldOf(stored)!

  expect(fold.texts).toEqual(['Reading.'])
  expect(looseOf(stored, fold)).toEqual([fold.final])
})

test('place: a row joins by its first words, only when they name one text of one fold', () => {
  const a = foldOf({ items: [text('Found it.'), tool, text('Then this.'), tool, text('Final.')], texts: ['Found it.', 'Then this.', 'Final.'], errors: 0 })!
  const all = { folds: [a], loose: ['Final.'] }

  expect(placeOf(all, 'Found  it.')).toEqual({ fold: a, place: 'head', hidden: ['Found it.', 'Then this.'] })
  expect(placeOf(all, 'Then this.')?.place).toBe('member')
  expect(placeOf(all, 'Final.')).toBeUndefined()
  expect(placeOf({ folds: [a], loose: ['Then this.'] }, 'Then this.')).toBeUndefined()
  expect(placeOf({ folds: [a], loose: ['Then this.'] }, 'Found it.')?.hidden).toEqual(['Found it.'])
  expect(placeOf({ folds: [a], loose: ['Found it.'] }, 'Then this.')).toBeUndefined()
  expect(placeOf({ folds: [a, { ...a, final: 'Other.' }], loose: [] }, 'Then this.')).toBeUndefined()
})

test('fitted: the record fits its budget by dropping its oldest folds; with none left, no loose heads', () => {
  const fold = (i: number) => ({ head: `Step ${i}.`, final: `Final ${i}.`, texts: [`Step ${i}.`], errors: 0, warnings: 0 })
  const all = { folds: [fold(1), fold(2), fold(3)], loose: ['Final 1.', 'Final 2.', 'Final 3.'] }
  const size = JSON.stringify(all).length

  expect(fitted(all, size)).toEqual(all)
  expect(fitted(all, size - 1).folds.map(f => f.head)).toEqual(['Step 2.', 'Step 3.'])
  expect(fitted(all, 10)).toEqual({ folds: [], loose: [] })
})

test('fold: folded text naming a failure the final does not counts as a warning', () => {
  const fold = foldOf({ items: [text('The server failed with a 500.'), tool, text('Played 39 points.')], texts: ['The server failed with a 500.', 'Played 39 points.'], errors: 0 })

  expect(fold?.warnings).toBe(1)
  expect(labelOf(fold!, 1, EN.fold)).toEqual({ text: 'Show 1 progress message', warnings: '1 warning' })
})

test('re-prompt: a Stop hook feedback row ends a reply; a typed prompt does not', () => {
  expect(isReprompt('Stop hook feedback:\n[goal]: not yet')).toBe(true)
  expect(isReprompt('Stop the build please')).toBe(false)
})
