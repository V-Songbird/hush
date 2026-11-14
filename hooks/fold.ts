// The final-only view: after Claude stops, the texts it wrote between tool calls before that
// reply's final message fold into one line that opens with a press. Tool rows never join; the
// app's own header folds them. A reply stops at a hook's re-prompt (`<Event> hook feedback:`), at
// a prompt queued during the turn and at the end of a turn.
//
// The fold is built from what the conversation stored, in stored order, never from what the
// desktop drew: the app draws a hidden window's rows only when the person comes back, so draw
// order during the reply is incomplete. A drawn row carries no id the stored row also carries, so
// it joins a fold by its first words, and only when those words name one text: when in doubt,
// the row is drawn whole.

import type { FoldState, FoldsState } from '../types'

export type Item = { kind: 'text'; head: string } | { kind: 'tool' }

/** What the conversation stored for the reply so far, in order. */
export type Stored = { items: Item[]; texts: string[]; errors: number }

export type Fold = FoldState
export type Folds = FoldsState

/** Words that name a failure or a blocker. */
const RISK = /\b(fail(s|ed|ing)?|error|blocked|blocker|cannot|can't|denied|risk|unverified|falla|falló|fallan|bloque(o|ado)|riesgo|no pude|sin verificar)\b/i

const HEAD = 40
export const headOf = (text: string) => text.replace(/\s+/g, ' ').trim().slice(0, HEAD)

export const isReprompt = (text: string) => /^\w+ hook feedback:/.test(text)

/**
 * The fold for one finished reply, or null when nothing should fold: no final text, a tool
 * call after the last text (the reply ended without a final message), or no text before it.
 * A text that repeats the final's first words stays out, so the final is never hidden.
 */
export function foldOf(stored: Stored): Fold | null {
  const items = stored.items.filter(item => item.kind === 'tool' || item.head !== '')
  const final = items.at(-1)

  if (final?.kind !== 'text') {
    return null
  }

  const texts = items.flatMap(item => (item.kind === 'text' && item.head !== final.head ? [item.head] : []))
  const first = texts[0]

  // Tool rows stay the app's: it folds them under its own "Ran N commands" header, which a mod
  // cannot reach, so a line of ours there would be a second toggle inside the first.
  if (first === undefined) {
    return null
  }

  return {
    head: first,
    final: final.head,
    texts,
    errors: stored.errors,
    warnings: stored.texts.filter(text => headOf(text) !== final.head && RISK.test(text)).length,
  }
}

/** The heads of a finished reply's texts that no fold hides: its final, or every text when it made no fold. */
export const looseOf = (stored: Stored, fold: Fold | null) =>
  fold === null ? stored.items.flatMap(item => (item.kind === 'text' && item.head !== '' ? [item.head] : [])) : [fold.final]

/**
 * Where a drawn text row sits: its fold's line, a hidden member, or outside every fold. A row
 * joins only when its words name a text of exactly one fold, no reply kept them loose, and the
 * same holds for that fold's first text, so its line is drawn and opens what it hides.
 */
export function placeOf(all: Folds, text: string): { fold: Fold; place: 'head' | 'member'; hidden: string[] } | undefined {
  const isSure = (head: string) => !all.loose.includes(head) && all.folds.filter(fold => fold.texts.includes(head)).length === 1
  const head = headOf(text)
  const fold = all.folds.find(fold => fold.texts.includes(head))

  if (fold === undefined || !isSure(head) || !isSure(fold.head)) {
    return undefined
  }

  return { fold, place: head === fold.head ? 'head' : 'member', hidden: fold.texts.filter(isSure) }
}

/** The per-session record as stored: under its JSON size budget, the oldest folds dropped first. */
export function fitted(all: Folds, budget: number): Folds {
  let folds = all.folds

  while (folds.length > 0 && JSON.stringify({ folds, loose: all.loose }).length > budget) {
    folds = folds.slice(1)
  }

  // With no fold left, nothing reads the loose heads.
  return folds.length === 0 ? { folds, loose: [] } : { folds, loose: all.loose }
}

/** The folded line's words in the person's language, from the catalogs in `register.tsx`. */
export type FoldWords = { show: (n: number) => string; hide: (n: number) => string; failed: (n: number) => string; warnings: (n: number) => string }

/**
 * The folded line's words, an action that says what a press does; what failed or warns comes
 * last, so it is never cut off first. `n` counts the texts the line hides.
 */
export function labelOf(fold: Fold, n: number, w: FoldWords, isOpen = false): { text: string; errors?: string; warnings?: string } {
  return {
    text: (isOpen ? w.hide : w.show)(n),
    ...(fold.errors > 0 && { errors: w.failed(fold.errors) }),
    ...(fold.warnings > 0 && { warnings: w.warnings(fold.warnings) }),
  }
}
