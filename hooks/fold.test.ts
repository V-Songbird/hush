import { expect, test } from 'claude-code/testing'

import { NO_HEADS, fitted, foldOf, hasHead, isReprompt, kept, labelOf, looseOf, placeOf, textOf, withHeads } from './fold'
import type { Fold, Item } from './fold'
import { EN, ES } from './register'

const text = (words: string): Item => textOf(words)
const tool: Item = { kind: 'tool' }
const loose = (...heads: string[]) => withHeads(NO_HEADS, heads)

test('fold: the work before the final folds; the final stays out', () => {
  const fold = foldOf({ items: [text('Reading the config.'), tool, tool, text('**Done.**')], errors: 1 })

  expect(fold).toEqual({ head: 'Reading the config.', final: '**Done.**', texts: ['Reading the config.'], risky: [], errors: 1 })
  expect(labelOf(fold!, fold!.texts, EN.fold)).toEqual({ text: 'Show 1 progress message', errors: '1 failed' })
  expect(labelOf(fold!, fold!.texts, EN.fold, true).text).toBe('Hide 1 progress message')
})

// The line follows the conversation's language setting, not the texts it hides (owner, 2026-11-03).
test('label: the line speaks the catalog it is given, whatever language the hidden texts use', () => {
  const fold = foldOf({ items: [text('Now I check the store.'), tool, text('That is it.'), tool, text('**Done.**')], errors: 2 })!

  expect(labelOf(fold, fold.texts, ES.fold)).toEqual({ text: 'Ver 2 mensajes de avance', errors: '2 fallaron' })
  expect(labelOf(fold, fold.texts, ES.fold, true).text).toBe('Ocultar 2 mensajes de avance')
  expect(labelOf({ ...fold, errors: 1, risky: ['That is it.'] }, fold.texts, ES.fold)).toEqual({ text: 'Ver 2 mensajes de avance', errors: '1 falló', warnings: '1 aviso' })
  expect(labelOf(fold, fold.texts, EN.fold).text).toBe('Show 2 progress messages')
})

test('fold: a reply that ends on a tool call has no final message, so nothing folds; all its texts stay loose', () => {
  const stored = { items: [tool, text('Checking.'), tool], errors: 0 }

  expect(foldOf(stored)).toBeNull()
  expect(looseOf(stored, null)).toEqual(['Checking.'])
})

test('fold: a reply that is only its final message, or only tools before it, folds nothing', () => {
  expect(foldOf({ items: [text('Hi.')], errors: 0 })).toBeNull()
  expect(foldOf({ items: [tool], errors: 0 })).toBeNull()
  expect(foldOf({ items: [tool, tool, text('Final.')], errors: 0 })).toBeNull()
})

test('fold: a text that repeats the final’s first words, or another text’s, stays out of the fold and loose', () => {
  const final = 'All 212 tests pass and the release notes are updated.'
  const stored = { items: [text('Reading.'), tool, text('Again.'), tool, text('Again.'), tool, text(final), tool, text(final)], errors: 0 }
  const fold = foldOf(stored)!

  expect(fold.texts).toEqual(['Reading.'])
  expect(looseOf(stored, fold)).toEqual(['Again.', 'Again.', fold.final, fold.final])
})

test('place: a row joins by its first words, only when they name one text of one fold', () => {
  const a = foldOf({ items: [text('Found it.'), tool, text('Then this.'), tool, text('Final.')], errors: 0 })!
  const all = { folds: [a], loose: loose('Final.') }

  expect(placeOf(all, 'Found  it.')).toEqual({ fold: a, place: 'head', hidden: ['Found it.', 'Then this.'] })
  expect(placeOf(all, 'Then this.')?.place).toBe('member')
  expect(placeOf(all, 'Final.')).toBeUndefined()
  expect(placeOf({ folds: [a], loose: loose('Then this.') }, 'Then this.')).toBeUndefined()
  expect(placeOf({ folds: [a], loose: loose('Then this.') }, 'Found it.')?.hidden).toEqual(['Found it.'])
  expect(placeOf({ folds: [a], loose: loose('Found it.') }, 'Then this.')).toBeUndefined()
  expect(placeOf({ folds: [a, { ...a, final: 'Other.' }], loose: NO_HEADS }, 'Then this.')).toBeUndefined()
})

test('loose: a fixed size whatever it takes, and never forgets a head it took', () => {
  const heads = Array.from({ length: 20000 }, (_, i) => `Progress text number ${i}.`)
  const all = withHeads(NO_HEADS, heads)

  expect(all.length).toBe(NO_HEADS.length)
  expect(heads.every(head => hasHead(all, head))).toBe(true)
  expect(hasHead(NO_HEADS, heads[0]!)).toBe(false)
  expect(withHeads(all, [heads[5]!])).toBe(all)
  // A head it never took may read as loose, which only draws that row whole.
  const strangers = Array.from({ length: 1000 }, (_, i) => `Never written ${i}.`).filter(head => hasHead(all, head)).length
  expect(strangers).toBeLessThan(50)
})

const fold = (i: number, more: string[] = []): Fold => ({ head: `Step ${i}.`, final: `Final ${i}.`, texts: [`Step ${i}.`, ...more], risky: [], errors: 0 })

test('kept: the dropped folds’ texts turn loose, so a text they shared with a kept fold stays whole', () => {
  const all = kept({ folds: [fold(1, ['Shared.']), fold(2, ['Shared.'])], loose: NO_HEADS }, 1)

  expect(all.folds.map(f => f.head)).toEqual(['Step 2.'])
  expect(placeOf(all, 'Shared.')).toBeUndefined()
  expect(placeOf(all, 'Step 1.')).toBeUndefined()
  expect(placeOf(all, 'Step 2.')?.place).toBe('head')
})

test('fitted: the record fits its budget by dropping its oldest folds, whose texts turn loose', () => {
  const all = { folds: [fold(1), fold(2), fold(3)], loose: NO_HEADS }
  const size = new TextEncoder().encode(JSON.stringify(all)).length

  expect(fitted(all, size)).toEqual(all)
  const fit = fitted(all, size - 1)
  expect(fit.folds.map(f => f.head)).toEqual(['Step 2.', 'Step 3.'])
  expect(hasHead(fit.loose, 'Step 1.')).toBe(true)
  expect(fitted(all, 10).folds).toEqual([])
})

test('fitted: the budget counts bytes, so text outside ASCII cannot pass it', () => {
  const wide = (i: number): Fold => ({ head: `進捗 ${i} を確認します。`, final: `完了 ${i}。`, texts: [`進捗 ${i} を確認します。`], risky: [], errors: 0 })
  const all = { folds: [wide(1), wide(2)], loose: NO_HEADS }
  const json = JSON.stringify(all)

  expect(fitted(all, json.length).folds.length).toBeLessThan(2)
  expect(fitted(all, new TextEncoder().encode(json).length).folds.length).toBe(2)
})

test('label: a folded text naming a failure warns only while the line hides it', () => {
  const f = foldOf({ items: [text('The server failed with a 500.'), tool, text('Retrying.'), tool, text('Played 39 points.')], errors: 0 })!

  expect(f.risky).toEqual(['The server failed with a 500.'])
  expect(labelOf(f, f.texts, EN.fold)).toEqual({ text: 'Show 2 progress messages', warnings: '1 warning' })
  expect(labelOf(f, ['Retrying.'], EN.fold)).toEqual({ text: 'Show 1 progress message' })
})

test('re-prompt: a Stop hook feedback row ends a reply; a typed prompt does not', () => {
  expect(isReprompt('Stop hook feedback:\n[goal]: not yet')).toBe(true)
  expect(isReprompt('Stop the build please')).toBe(false)
})
