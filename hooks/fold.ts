// The final-only view: while Claude works, the texts it wrote between tool calls fold into one
// line that opens with a press, all but the newest; after it stops, the texts before that reply's
// final message fold. Tool rows never join; the app's own header folds them. A reply stops at a
// hook's re-prompt (`<Event> hook feedback:`), at a prompt queued during the turn, at a compaction
// and at the end of a turn. A re-prompt, or a turn the harness opens on a task notification, a
// scheduled trigger or a subagent's hand-back, continues the reply before it: the two fold as one,
// so the earlier part's last text, a status line, folds too (`register.tsx`).
//
// The fold is built from what the conversation stored, in stored order, never from what the
// desktop drew: the app draws a hidden window's rows only when the person comes back, so draw
// order during the reply is incomplete. A drawn row carries no id the stored row also carries, so
// it joins a fold by its first words, and only when those words name one text: when in doubt,
// the row is drawn whole.

import type { FoldState, FoldsState } from '../types'

export type Item = { kind: 'text'; head: string; isRisky: boolean } | { kind: 'tool' }

/** What the conversation stored for the reply so far, in order. */
export type Stored = { items: Item[]; errors: number }

export type Fold = FoldState
export type Folds = FoldsState

/** Words that name a failure or a blocker. */
const RISK = /\b(fail(s|ed|ing)?|error|blocked|blocker|cannot|can't|denied|risk|unverified|falla|falló|fallan|bloque(o|ado)|riesgo|no pude|sin verificar)\b/i

const HEAD = 40
export const headOf = (text: string) => text.replace(/\s+/g, ' ').trim().slice(0, HEAD)

export const textOf = (text: string): Item => ({ kind: 'text', head: headOf(text), isRisky: RISK.test(text) })

export const isReprompt = (text: string) => /^\w+ hook feedback:/.test(text)

const headsOf = (stored: Stored) => stored.items.flatMap(item => (item.kind === 'text' && item.head !== '' ? [item.head] : []))

/**
 * The fold for one finished reply, or null when nothing should fold: no final text, a tool
 * call after the last text (the reply ended without a final message), or no text before it.
 * A text that repeats the final's first words, or another text's, stays out: drawn whole.
 */
export function foldOf(stored: Stored): Fold | null {
  const items = stored.items.filter(item => item.kind === 'tool' || item.head !== '')
  const final = items.at(-1)

  if (final?.kind !== 'text') {
    return null
  }

  const heads = headsOf(stored)
  const members = items.flatMap(item => (item.kind === 'text' && heads.indexOf(item.head) === heads.lastIndexOf(item.head) && item.head !== final.head ? [item] : []))
  const first = members[0]

  // Tool rows stay the app's: it folds them under its own "Ran N commands" header, which a mod
  // cannot reach, so a line of ours there would be a second toggle inside the first.
  if (first === undefined) {
    return null
  }

  return {
    head: first.head,
    final: final.head,
    texts: members.map(item => item.head),
    risky: members.flatMap(item => (item.isRisky ? [item.head] : [])),
    errors: stored.errors,
  }
}

/** The heads of a finished reply's texts that its fold does not hide: all of them when it made none. */
export const looseOf = (stored: Stored, fold: Fold | null) => headsOf(stored).filter(head => !fold?.texts.includes(head))

// The loose heads: a fixed-size set of bits, base64 digits, each head setting four of them. It
// answers "maybe" for a head it never took, which draws that row whole, and never "no" for one it
// took, so a long session neither forgets a loose head nor grows.
const DIGITS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const SIZE = 32768
export const NO_HEADS = 'A'.repeat(SIZE)

function spotsOf(head: string) {
  let a = 0x811c9dc5
  let b = 0x9747b28c

  for (let i = 0; i < head.length; i++) {
    a = Math.imul(a ^ head.charCodeAt(i), 16777619)
    b = Math.imul(b ^ head.charCodeAt(i), 0x5bd1e995)
  }

  return [0, 1, 2, 3].map(i => ((a + i * (b | 1)) >>> 0) % (SIZE * 6))
}

export const hasHead = (loose: string, head: string) => spotsOf(head).every(spot => (DIGITS.indexOf(loose[Math.floor(spot / 6)] ?? 'A') >> spot % 6) & 1)

export function withHeads(loose: string, heads: string[]): string {
  if (heads.every(head => hasHead(loose, head))) return loose
  const digits = Array.from(loose.length === SIZE ? loose : NO_HEADS, digit => DIGITS.indexOf(digit))

  for (const spot of heads.flatMap(spotsOf)) {
    digits[Math.floor(spot / 6)] |= 1 << spot % 6
  }

  return digits.map(digit => DIGITS[digit]).join('')
}

/** The newest `n` folds; the texts of the dropped ones turn loose, so none of their rows starts hiding. */
export function kept(all: Folds, n: number): Folds {
  const dropped = all.folds.slice(0, Math.max(0, all.folds.length - n))

  return dropped.length === 0 ? all : { folds: all.folds.slice(dropped.length), loose: withHeads(all.loose, dropped.flatMap(fold => fold.texts)) }
}

/**
 * Where a drawn text row sits: its fold's line, a hidden member, or outside every fold. A row
 * joins only when its words name a text of exactly one fold and are not loose, and the same holds
 * for that fold's first text, so its line is drawn and opens what it hides.
 */
export function placeOf(all: Folds, text: string): { fold: Fold; place: 'head' | 'member'; hidden: string[] } | undefined {
  const isSure = (head: string) => !hasHead(all.loose, head) && all.folds.filter(fold => fold.texts.includes(head)).length === 1
  const head = headOf(text)
  const fold = all.folds.find(fold => fold.texts.includes(head))

  if (fold === undefined || !isSure(head) || !isSure(fold.head)) {
    return undefined
  }

  return { fold, place: head === fold.head ? 'head' : 'member', hidden: fold.texts.filter(isSure) }
}

/** The per-session record as stored: under its budget in UTF-8 bytes, the oldest folds dropped first. */
export function fitted(all: Folds, budget: number): Folds {
  const bytes = (folds: Folds) => new TextEncoder().encode(JSON.stringify(folds)).length
  let fit = all

  while (fit.folds.length > 0 && bytes(fit) > budget) {
    fit = kept(fit, fit.folds.length - 1)
  }

  return fit
}

/** The folded line's words in the person's language, from the catalogs in `register.tsx`. */
export type FoldWords = { show: (n: number) => string; hide: (n: number) => string; failed: (n: number) => string; warnings: (n: number) => string }

/**
 * The folded line's words, an action that says what a press does; what failed or warns comes
 * last, so it is never cut off first. `hidden` is the texts the line hides; only they can warn.
 */
export function labelOf(fold: Fold, hidden: string[], w: FoldWords, isOpen = false): { text: string; errors?: string; warnings?: string } {
  const warnings = hidden.filter(head => fold.risky.includes(head)).length

  return {
    text: (isOpen ? w.hide : w.show)(hidden.length),
    ...(fold.errors > 0 && { errors: w.failed(fold.errors) }),
    ...(warnings > 0 && { warnings: w.warnings(warnings) }),
  }
}
