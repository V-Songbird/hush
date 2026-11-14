// A silent check of Hush's final message: each answer is tested against the countable rules of
// the voice (`output-styles/hush.md`), under the reader's /hush:config settings, and only
// numbers are kept. It never changes or draws anything in the reply, and it stores no text of one.

export const RULES = [
  'result first',
  'rules where set',
  'next step where set',
  'sentences within limit',
  'blocks within limit',
  'words within limit',
  'no raw html',
  'links resolve',
] as const

export type Rule = (typeof RULES)[number]

// The /hush:config knobs these rules read, with Hush's own defaults first: a copy of
// `hooks/style-settings.js` KNOBS, since a hooks module cannot require CommonJS;
// tests/desktop_mod.test.js keeps the two equal. An unknown value falls back to the default
// there too.
const KNOBS = {
  next: ['end', 'top', 'off'],
  rules: ['on', 'off'],
  detail: ['normal', 'short', 'full', 'bare'],
  markdown: ['rich', 'basic', 'plain'],
  sentences: ['12', '20'],
} as const

export type Settings = { [K in keyof typeof KNOBS]: (typeof KNOBS)[K][number] }

export function settingsOf(saved: unknown): Settings {
  const get = <K extends keyof typeof KNOBS>(k: K): Settings[K] => {
    const value = typeof saved === 'object' && saved !== null ? (saved as Record<string, unknown>)[k] : undefined

    return ((KNOBS[k] as readonly string[]).includes(value as string) ? value : KNOBS[k][0]) as Settings[K]
  }

  return { next: get('next'), rules: get('rules'), detail: get('detail'), markdown: get('markdown'), sentences: get('sentences') }
}

// Words outside code by the detail setting ("Most messages fit in 250 words outside code";
// 80, 400); bare names no number. The voice leaves risks and blockers out of the budget, but
// they are prose with no mark to find, so every prose word counts here.
const WORDS: Record<Settings['detail'], number> = { normal: 250, short: 80, full: 400, bare: Infinity }

const NEXT = /^\*\*[^*]{2,40}:\*\*\s/
const RULE_LINE = /^\s*(---|\*\*\*|___)\s*$/
const FENCE = /^\s*(`{3,}|~{3,})/
// The voice allows only <kbd>; the app draws any other tag as raw text.
const HTML = /<\/?(?!kbd\b)[a-z][a-z0-9-]*(\s[^>]*)?>/i

const wordsOf = (text: string) => text.split(/\s+/).filter(word => /[\p{L}\p{N}]/u.test(word)).length

// The prose a reader reads as sentences: no code, no table rows, no headings, no rules, and
// no Markdown marks around them.
function proseBlocks(text: string): string[] {
  const blocks: string[] = []
  let block: string[] = []
  let fence: string | null = null

  const flush = () => {
    if (block.length > 0) {
      blocks.push(block.join(' '))
    }

    block = []
  }

  for (const line of text.split('\n')) {
    const open = FENCE.exec(line)?.[1]

    if (fence !== null) {
      if (open !== undefined && open[0] === fence[0] && open.length >= fence.length) {
        fence = null
      }

      continue
    }

    if (open !== undefined) {
      flush()
      fence = open
      continue
    }

    if (line.trim() === '' || RULE_LINE.test(line) || /^\s*\|/.test(line) || /^\s*#/.test(line)) {
      flush()
      continue
    }

    // A list item is a block of its own, as the voice counts it a sentence of its own.
    if (/^\s*([-*+]|\d+[.)])\s/.test(line)) {
      flush()
    }

    if (line.replace(/^\s*>\s?/, '').trim() === '') {
      continue
    }

    block.push(line.replace(/`[^`]*`/g, 'x').replace(/^\s*(([-*+]|\d+[.)])\s+|>\s?)(\[[ x]\]\s*)?/, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1'))
  }

  flush()

  return blocks
}

// A sentence ends at . ! ? before a space or the end; numbers like 1.5 and file names like
// a.js have no space after the point.
const sentencesOf = (block: string) => block.split(/(?<=[.!?…])\s+/).filter(sentence => sentence.trim() !== '')

// Where the voice puts its horizontal rules and its "Next:" line, by setting. With rules on:
// next=end has one under the result and one above "Next:"; next=top has "Next:" right under
// the result and one rule after it; next=off has one under the result. Plain Markdown and
// rules=off have none. A message that would end on a footnote ends on a line holding only
// `&nbsp;`, which these skip.
function layout(lines: readonly string[], s: Settings): { rules: boolean; next: boolean } {
  const isRule = (i: number) => RULE_LINE.test(lines.at(i) ?? '')
  const nextAt = lines.findIndex(line => NEXT.test(line))
  const ruled = s.rules === 'on' && s.markdown !== 'plain'

  if (!ruled) {
    return {
      rules: !lines.some(line => RULE_LINE.test(line)),
      next: s.next === 'off' ? nextAt === -1 : s.next === 'top' ? nextAt === 1 : nextAt === lines.length - 1,
    }
  }

  if (s.next === 'top') {
    return { rules: isRule(2), next: nextAt === 1 }
  }

  if (s.next === 'off') {
    return { rules: isRule(1), next: nextAt === -1 }
  }

  return { rules: isRule(1) && isRule(-2), next: nextAt === lines.length - 1 }
}

// The local places a message links: no web page, no anchor, the `:line` suffix dropped.
export function localLinks(text: string): string[] {
  const targets = [...text.matchAll(/\]\(([^)\s]+)\)/g)].map(m => m[1] ?? '')

  return targets
    .filter(t => t !== '' && !t.startsWith('#') && !/^[a-z][a-z0-9+.-]*:\/\//i.test(t) && !/^mailto:/i.test(t))
    .map(t => {
      try {
        return decodeURIComponent(t.replace(/:\d+(-\d+)?$/, ''))
      } catch {
        return t
      }
    })
}

/**
 * The rules the answer misses. `missing` is how many of `localLinks(text)` name no file; the
 * caller reads the disk.
 */
export function lintMessage(text: string, settings: Settings = settingsOf(undefined), missing = 0): Rule[] {
  const all = text.split('\n').map(line => line.trim()).filter(line => line !== '')
  const lines = all.at(-1) === '&nbsp;' ? all.slice(0, -1) : all
  const blocks = proseBlocks(text)
  const wide = settings.sentences === '20'
  const placed = layout(lines, settings)
  // Only rich Markdown allows <kbd>; basic and plain forbid it like any other tag.
  const html = settings.markdown === 'rich' ? HTML : /<\/?[a-z][a-z0-9-]*(\s[^>]*)?>/i

  const checks: Record<Rule, boolean> = {
    'result first': /^\*\*[^*].*\*\*$/.test(lines[0] ?? ''),
    'rules where set': placed.rules,
    'next step where set': placed.next,
    'sentences within limit': Math.max(0, ...blocks.flatMap(sentencesOf).map(wordsOf)) <= (wide ? 20 : 12),
    'blocks within limit': Math.max(0, ...blocks.map(wordsOf)) <= (wide ? 60 : 40),
    'words within limit': blocks.reduce((sum, b) => sum + wordsOf(b), 0) <= WORDS[settings.detail],
    'no raw html': !html.test(blocks.join('\n')),
    'links resolve': missing === 0,
  }

  return RULES.filter(rule => !checks[rule])
}

/**
 * The running count, kept as `tally.json` beside the settings file, which `/hush:config` reads.
 * Numbers and days only: no word of a reply is stored.
 */
export type Tally = {
  /** Final messages checked. */
  messages: number
  /** How many of them met every rule. */
  met: number
  /** How many missed each rule. */
  misses: Partial<Record<Rule, number>>
  /** The days of the first and the last message, as `YYYY-MM-DD`. */
  since: string
  last: string
}

const DAY = /^\d{4}-\d{2}-\d{2}$/
const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0

/** A tally read back from the file; anything that is not one starts a new count. */
export function asTally(v: unknown): Tally | undefined {
  const t = (typeof v === 'object' && v !== null ? v : {}) as Partial<Tally>

  if (!isCount(t.messages) || !isCount(t.met) || t.met > t.messages || typeof t.since !== 'string' || !DAY.test(t.since) || typeof t.last !== 'string' || !DAY.test(t.last)) {
    return undefined
  }

  const misses: Tally['misses'] = {}

  for (const rule of RULES) {
    const n = (t.misses as Record<string, unknown> | undefined)?.[rule]

    if (isCount(n)) {
      misses[rule] = n
    }
  }

  return { messages: t.messages, met: t.met, misses, since: t.since, last: t.last }
}

export function tally(prev: Tally | undefined, missed: readonly Rule[], day: string): Tally {
  const misses = { ...prev?.misses }

  for (const rule of missed) {
    misses[rule] = (misses[rule] ?? 0) + 1
  }

  return { messages: (prev?.messages ?? 0) + 1, met: (prev?.met ?? 0) + (missed.length === 0 ? 1 : 0), misses, since: prev?.since ?? day, last: day }
}
