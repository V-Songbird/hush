// The final-only view: after Claude stops, everything it wrote before that reply's final message
// (text written between tool calls, the tool rows) folds into one line that opens with a press.
// A reply stops at a hook's re-prompt (`<Event> hook feedback:`) and at the end of a turn.
//
// The fold is built from what the conversation stored, in stored order, never from what the
// desktop drew: the app draws a hidden window's rows only when the person comes back, so draw
// order during the reply is incomplete. A drawn text row joins a fold by its first words; tool
// rows never join, the app's own header folds them.

import type { FoldState } from '../types'

export type Item = { kind: 'text'; head: string } | { kind: 'tool'; id: string }

/** What the conversation stored for the reply so far, in order. */
export type Stored = { items: Item[]; texts: string[]; errors: number }

export type Fold = FoldState

/** Words that name a failure or a blocker: the same list the H4 transcript count used. */
const RISK = /\b(fail(s|ed|ing)?|error|blocked|blocker|cannot|can't|denied|risk|unverified|falla|falló|fallan|bloque(o|ado)|riesgo|no pude|sin verificar)\b/i

const HEAD = 40
export const headOf = (text: string) => text.replace(/\s+/g, ' ').trim().slice(0, HEAD)

export const isReprompt = (text: string) => /^\w+ hook feedback:/.test(text)

/** The tool call a drawn tool row stands for: a group is named after its first call. */
export const callOf = (id: string) => id.replace(/^group:/, '')

const keyOf = (item: Item) => (item.kind === 'text' ? `text:${item.head}` : item.id)

/**
 * The fold for one finished reply, or null when nothing should fold: no final text, a tool
 * call after the last text (the reply ended without a final message), or nothing before it.
 */
export function foldOf(stored: Stored): Fold | null {
  const items = stored.items.filter(item => item.kind === 'tool' || item.head !== '')
  const last = items.map(item => item.kind).lastIndexOf('text')

  if (last < 0 || last < items.length - 1) {
    return null
  }

  // Tool rows stay the app's: it folds them under its own "Ran N commands" header, which a mod
  // cannot reach, so a line of ours there would be a second toggle inside the first.
  const members = items.slice(0, last).filter(item => item.kind === 'text')
  const first = members[0]

  if (first === undefined) {
    return null
  }

  const final = items[last]
  const folded = stored.texts.filter(text => final?.kind === 'text' && headOf(text) !== final.head)

  return {
    head: keyOf(first),
    texts: members.flatMap(item => (item.kind === 'text' ? [item.head] : [])),
    tools: stored.items.flatMap(item => (item.kind === 'tool' ? [item.id] : [])),
    errors: stored.errors,
    warnings: folded.filter(text => RISK.test(text)).length,
  }
}

/** Where a drawn row sits in a fold: the line, a hidden member, or outside it. */
export function placeOf(fold: Fold, row: { kind: 'text'; text: string } | { kind: 'tool'; id: string }): 'head' | 'member' | undefined {
  if (row.kind === 'tool') {
    return undefined
  }

  const head = headOf(row.text)

  return `text:${head}` === fold.head ? 'head' : fold.texts.includes(head) ? 'member' : undefined
}

/** The folded line's words in the person's language, from the catalogs in `register.tsx`. */
export type FoldWords = { show: (n: number) => string; hide: (n: number) => string; failed: (n: number) => string; warnings: (n: number) => string }

/**
 * The folded line's words, an action that says what a press does; what failed or warns comes
 * last, so it is never cut off first.
 */
export function labelOf(fold: Fold, w: FoldWords, isOpen = false): { text: string; errors?: string; warnings?: string } {
  return {
    text: (isOpen ? w.hide : w.show)(fold.texts.length),
    ...(fold.errors > 0 && { errors: w.failed(fold.errors) }),
    ...(fold.warnings > 0 && { warnings: w.warnings(fold.warnings) }),
  }
}
