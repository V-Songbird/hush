// A silent check of Hush's final message: each answer is tested against the countable rules of
// the voice (`output-styles/hush.md`) and of the `modules/*.md` texts the reader's /hush:config
// settings swap in, and only numbers are kept. It never changes or draws anything in the reply,
// and it stores no text of one.
//
// A count that is wrong is worse than none: where a rule cannot tell whether a message follows
// the voice, it counts no miss. The word budget is not counted at all, since the voice leaves
// risks, blockers, unverified claims and pending approvals out of it and no mark sets them apart.
// Links are not counted either: a link to a file the turn deleted or renamed cannot be told from
// a wrong one.

export const RULES = [
  'result first',
  'rules where set',
  'next step where set',
  'sentences within limit',
  'blocks within limit',
  'no raw html',
  'markdown forms as set',
] as const

export type Rule = (typeof RULES)[number]

// Every /hush:config knob, with Hush's own defaults first: a copy of `hooks/style-settings.js`
// KNOBS, since a hooks module cannot require CommonJS; tests/desktop_mod.test.js keeps the two
// equal, so a new knob fails there until the check knows it. An unknown value is the default.
const KNOBS = {
  next: ['end', 'top', 'off'],
  rules: ['on', 'off'],
  detail: ['normal', 'short', 'full', 'bare'],
  why: ['on', 'off'],
  checks: ['line', 'each', 'off'],
  caveats: ['each', 'floor'],
  records: ['line', 'off'],
  terms: ['footnote', 'inline', 'none'],
  markdown: ['rich', 'basic', 'plain'],
  files: ['card', 'link'],
  sentences: ['12', '20'],
  emoji: ['off', 'on'],
  headers: ['off', 'on'],
  box: ['decisions', 'work', 'text'],
} as const

export type Settings = { -readonly [K in keyof typeof KNOBS]: (typeof KNOBS)[K][number] }

export function settingsOf(saved: unknown): Settings {
  const s = (typeof saved === 'object' && saved !== null ? saved : {}) as Record<string, unknown>

  return Object.fromEntries(Object.entries(KNOBS).map(([k, values]) => [k, (values as readonly unknown[]).includes(s[k]) ? s[k] : values[0]])) as Settings
}

// The knobs the rules read, in a fixed order. The others (detail, why, checks, caveats, records,
// terms, files, box) change what the message holds, not where its result, rules and next step
// sit, nor its sentence and block limits. A change to one of these starts a new count.
// style-settings.js keeps the same list as TALLY_KNOBS.
export const READ = ['next', 'rules', 'markdown', 'sentences', 'emoji', 'headers'] as const

/** The values of the knobs the rules read, such as `end-on-rich-12-off-off`: no text of a reply. */
export const settingsKey = (s: Settings): string => READ.map(k => s[k]).join('-')

// A message is read as parts: each line outside code, trimmed, and each fenced or `$$` block as
// one code part. Structure is read from these, so nothing inside code counts.
type Part = { kind: 'code'; info: string } | { kind: 'line'; text: string }

const FENCE = /^(`{3,}|~{3,})\s*([^\s`]*)/

function partsOf(text: string): Part[] {
  const parts: Part[] = []
  let fence = ''

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()

    if (fence !== '') {
      if (fence === '$$' ? line.endsWith('$$') : line.length >= fence.length && line === fence.charAt(0).repeat(line.length)) fence = ''

      continue
    }

    const open = FENCE.exec(line)
    const marks = open?.[1] ?? ''

    // A backtick fence's info string holds no backtick: "```x```" is inline code.
    if (open !== null && !(marks.startsWith('`') && line.slice(marks.length).includes('`'))) {
      parts.push({ kind: 'code', info: (open[2] ?? '').toLowerCase() })
      fence = marks
    } else if (line.startsWith('$$')) {
      parts.push({ kind: 'code', info: 'math' })

      if (line.length < 4 || !line.endsWith('$$')) fence = '$$'
    } else {
      parts.push({ kind: 'line', text: line })
    }
  }

  return parts
}

const RULE_LINE = /^(?:(?:-[ \t]*){3,}|(?:\*[ \t]*){3,}|(?:_[ \t]*){3,})$/
const EMOJI = '\\p{Extended_Pictographic}(?:\\uFE0F|\\u200D\\p{Extended_Pictographic})*\\s*'
// A sentence's end in any script (`\p{STerm}`: . ! ? 。 । ؟ ። and the like), and the ellipsis.
const STOP = '[\\p{STerm}…]'
// A bold line; its stop and a footnote mark may follow the bold, in either order.
const BOLD = `(?:\\*\\*(?=\\S)(?:.*\\S)?\\*\\*|__(?=\\S)(?:.*\\S)?__)(?:${STOP}|\\[\\^[^\\]\\s]+\\])*$`
// The bold result line; under emoji=on an emoji may open it ("before any bold").
const RESULT = [new RegExp(`^${BOLD}`, 'u'), new RegExp(`^(?:${EMOJI})?${BOLD}`, 'u')] as const
// The "Next:" line opens with its word in bold, in any language, with a colon or a full-width one,
// inside the bold or after it; French puts a space, U+00A0 or U+202F before it.
const COLON = '[ \\u00A0\\u202F]?[:：]'
const NEXT_WORD = `(?:\\*\\*[^*]{1,40}?[:：]\\*\\*|\\*\\*[^*]{1,40}\\*\\*${COLON}|__[^_]{1,40}?[:：]__|__[^_]{1,40}__${COLON})`
const NEXT = [new RegExp(`^${NEXT_WORD}`, 'u'), new RegExp(`^(?:${EMOJI})?${NEXT_WORD}`, 'u')] as const
// A section header (headers=on): a short bold line of its own; its emoji may sit in or before it.
const HEADER_WORD = `(?:\\*\\*[^*]{1,40}\\*\\*|__[^_]{1,40}__)(?:${COLON})?$`
const HEADER = [new RegExp(`^${HEADER_WORD}`, 'u'), new RegExp(`^(?:${EMOJI})?${HEADER_WORD}`, 'u')] as const
const HEADING = /^#{1,6}(?:\s|$)/
const QUOTE = /^>/
const LIST_ITEM = /^(?:[-*+]|\d+[.)])\s/
const FOOTNOTE = /^\[\^[^\]\s]+\]:/
const TABLE_SEP = /^\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?$/
const INLINE_CODE = /`+[^`]*`+/g
// A link or image, its target with balanced parentheses, as in `app/(group)/page.tsx`.
const LINK = /!?\[([^\]]*)\]\((<[^>]*>|(?:[^()\s]|\([^()\s]*\))+)(?:\s+"[^"]*")?\)/g
const TAG = /<(\/?)([A-Za-z][A-Za-z0-9]*)(?:\s[^<>]*)?\/?>/g
// HTML elements by name. One with content counts only when its closing tag is in the message
// too, so `x<b and c>d` in prose is no tag; an empty one counts by its tag alone.
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr'])
const ELEMENTS = new Set(
  (
    'a abbr address article aside audio b bdi bdo big blockquote body button canvas caption center cite code colgroup dd del details dfn dialog div dl dt em ' +
    'fieldset figcaption figure font footer form h1 h2 h3 h4 h5 h6 head header html i iframe ins kbd label legend li main mark nav noscript object ol optgroup ' +
    'option p picture pre q rp rt ruby s samp script section select small span strike strong style sub summary sup svg table tbody td template textarea tfoot ' +
    'th thead time title tr tt u ul var video'
  ).split(' '),
)
// Scripts written with no spaces between words: a whitespace count says nothing there.
const UNSPACED = /[\p{sc=Han}\p{sc=Hiragana}\p{sc=Katakana}\p{sc=Thai}\p{sc=Lao}\p{sc=Khmer}\p{sc=Myanmar}]/u

// A line as the reader reads its words: inline code, math, a link and an image are one name
// each; footnote marks, struck text and list marks are not read.
const readable = (line: string) =>
  line
    .replace(/^(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/, '')
    .replace(INLINE_CODE, ' x ')
    .replace(LINK, ' x ')
    .replace(/\[\^[^\]\s]+\]:?/g, ' ')
    .replace(/~~.*?~~/g, ' ')
    .replace(/\$[^$\s](?:[^$]*[^$\s])?\$/g, ' x ')
    .replace(/&nbsp;/g, ' ')

const wordsOf = (text: string) => text.split(/\s+/).filter(word => /[\p{L}\p{N}]/u.test(word)).length

// A sentence ends at a stop of any script before a space; 1.5 and a.js have none.
const sentencesOf = (text: string) => text.split(new RegExp(`(?<=${STOP}[\\]"'”’»)*_]*)\\s+`, 'u'))

const cellsOf = (row: string) =>
  row
    .replace(INLINE_CODE, ' x ')
    .replace(/^\||\|$/g, '')
    .split(/(?<!\\)\|/)

/**
 * Where the result, the rules and the Next step sit, by setting:
 * - rules on: next=end has a rule under the result, and the Next step "below a rule of its
 *   own": what follows the last rule opens with "Next:", and anything may follow that line;
 *   next=top has "Next:" right under the result, then the code its step needs, then a rule;
 *   next=off has a rule under the result.
 * - rules=off and markdown=plain have no rule outside code, and nothing marks where the Next step
 *   starts: only a message with no "Next:" line at all misses it.
 * - headers=on: a "Next step" header line, then the action, stands where "Next:" stands.
 * A message that would end on a footnote ends on a line holding only `&nbsp;`, which is skipped.
 * `block` is the Next step and what follows it, which the voice lets hold its closing sentence.
 */
function placement(lines: readonly Part[], s: Settings) {
  const emoji = s.emoji === 'on' ? 1 : 0
  const textAt = (i: number) => {
    const part = lines[i]

    return part?.kind === 'line' ? part.text : undefined
  }
  const isRule = (i: number) => RULE_LINE.test(textAt(i) ?? '\n')
  const isInline = (i: number) => NEXT[emoji].test(textAt(i) ?? '')
  const isHeader = (i: number) => HEADER[emoji].test(textAt(i) ?? '') && textAt(i + 1) !== undefined
  const isNext = (i: number) => i >= 1 && (s.headers === 'on' ? isHeader(i) : isInline(i))
  const ruled = s.rules === 'on' && s.markdown !== 'plain'
  const n = lines.length
  const indices = Array.from({ length: n }, (_, i) => i)
  const hasRule = indices.some(isRule)
  const from = (start: number) => indices.slice(Math.max(start, 0))

  if (s.next === 'off') {
    // No Next line "in any language": a count cannot tell the word, so only the shape the voice
    // gives "Next:", a rule of its own above a closing bold label, is a miss.
    const endAt = s.headers === 'on' ? (isHeader(n - 2) || !isInline(n - 1) ? n - 2 : n - 1) : isInline(n - 1) || !isHeader(n - 2) ? n - 1 : n - 2
    const isShape = ruled && endAt - 1 > 1 && isRule(endAt - 1) && (isInline(endAt) || isHeader(endAt))

    return { rules: ruled ? isRule(1) : !hasRule, next: !isShape, block: [] as number[] }
  }

  if (s.next === 'top') {
    const topSize = s.headers === 'on' ? (isHeader(1) || !isInline(1) ? 2 : 1) : isInline(1) || !isHeader(1) ? 1 : 2
    let i = 1 + topSize

    while (lines[i]?.kind === 'code') i++

    return { rules: ruled ? i >= n || isRule(i) : !hasRule, next: isNext(1), block: [1, topSize === 2 ? 2 : -1].filter(j => j >= 0) }
  }

  const lastRule = ruled ? indices.filter(isRule).pop() : undefined

  if (lastRule !== undefined && lastRule >= 1) return { rules: isRule(1), next: isNext(lastRule + 1), block: from(lastRule + 1) }

  // No rule to anchor the Next step: a miss only when no line after the result is one.
  const last = indices.filter(isNext).pop()

  return { rules: !ruled ? !hasRule : false, next: last !== undefined, block: last === undefined ? [] : from(last) }
}

// What markdown=basic and markdown=plain forbid where a count can tell for certain. Italics,
// `*` bullets and inline math stay out: their marks also appear in plain text.
function formsMet(parts: readonly Part[], s: Settings): boolean {
  if (s.markdown === 'rich') return true

  const isPlain = s.markdown === 'plain'

  return parts.every(part => {
    if (part.kind === 'code') return part.info !== 'search_tree' && part.info !== 'math'

    const t = part.text.replace(INLINE_CODE, ' ')
    const basic =
      FOOTNOTE.test(t) || /~~\S(?:.*?\S)?~~/.test(t) || /!\[[^\]]*\]\((?!<?https?:)/i.test(t) || /\]\(<?#(?:terminal\/|local_|trig_|project-settings\/)/.test(t)
    const plain = t.startsWith('|') || HEADING.test(t) || QUOTE.test(t) || /^[-*+]\s+\[[ xX]\]\s/.test(t) || /\[[^\]]*\]\([^)]*\)/.test(t)

    return !(basic || (isPlain && plain))
  })
}

/** The rules the answer misses. */
export function lintMessage(text: string, settings: Settings = settingsOf(undefined)): Rule[] {
  const parts = partsOf(text)
  // The parts a reader sees, blank lines out, with a closing `&nbsp;` line skipped.
  const at = parts.flatMap((part, i) => (part.kind === 'code' || part.text !== '' ? [i] : []))

  while (at.length > 0 && (parts[at[at.length - 1] ?? -1] as { text?: string } | undefined)?.text === '&nbsp;') at.pop()

  const lines = at.map(i => parts[i] as Part)
  const placed = placement(lines, settings)
  const nextLines = new Set(placed.block.map(i => at[i]))
  const sentenceLimit = settings.sentences === '20' ? 20 : 12
  const blockLimit = settings.sentences === '20' ? 60 : 40
  const emoji = settings.emoji === 'on' ? 1 : 0
  let isLongSentence = false
  let isLongBlock = false
  let isComment = false
  const opened = new Set<string>()
  const closed = new Set<string>()
  let block = 0
  let isUnspaced = false
  let isList = false

  // A list is not held to the block limit: the voice never cuts open items, risks or checks to
  // fit, and a count cannot tell such a list from another. Each item keeps the sentence limit.
  const close = () => {
    if (!isUnspaced && !isList && block > blockLimit) isLongBlock = true

    block = 0
    isUnspaced = false
    isList = false
  }
  const sentences = (t: string) => {
    if (!UNSPACED.test(t) && sentencesOf(t).some(x => wordsOf(x) > sentenceLimit)) isLongSentence = true
  }
  const html = (t: string) => {
    const prose = t.replace(INLINE_CODE, ' ').replace(LINK, ' ')

    isComment ||= /<!--.*?-->/.test(prose)

    for (const m of prose.matchAll(TAG)) {
      const name = (m[2] ?? '').toLowerCase()

      if (VOID.has(name) || ELEMENTS.has(name)) (m[1] === '/' ? closed : opened).add(name)
    }
  }

  // A table row opens with `|`, or has one in a run of lines that holds a `|---|` row.
  const tableAt = new Set<number>()
  let run: number[] = []

  for (let i = 0; i <= parts.length; i++) {
    const part = parts[i]

    if (part?.kind === 'line' && part.text !== '') {
      run.push(i)
      continue
    }

    const texts = run.map(j => (parts[j] as { text: string }).text)
    const hasSep = texts.some(t => t.includes('|') && TABLE_SEP.test(t))

    run.forEach((j, k) => {
      if (texts[k]?.startsWith('|') || (hasSep && texts[k]?.includes('|'))) tableAt.add(j)
    })
    run = []
  }

  // A block is the text between two blank lines, so a whole list is one block. A table is the
  // voice's way past the block limit, so its rows count only for their cells' sentences. Quote
  // blocks hold errors and words quoted word for word, and are not measured. A heading is no
  // sentence. The Next step's sentences are not measured, since the voice prescribes its closing
  // sentence; its blocks are.
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i] as Part

    if (part.kind === 'code' || part.text === '' || RULE_LINE.test(part.text)) {
      close()
      continue
    }

    const t = part.text

    if (QUOTE.test(t)) {
      close()
      continue
    }

    html(t)

    if (tableAt.has(i)) {
      close()

      if (!TABLE_SEP.test(t)) cellsOf(t).forEach(cell => sentences(readable(cell)))

      continue
    }

    if (HEADING.test(t)) {
      close()
      continue
    }

    // A section header names its block's kind; it is not a sentence of the block.
    if (settings.headers === 'on' && HEADER[emoji].test(t)) continue

    const words = readable(t)

    if (!nextLines.has(i)) sentences(words)

    isList ||= LIST_ITEM.test(t)
    block += wordsOf(words)
    isUnspaced ||= UNSPACED.test(words)
  }

  close()

  const paired = [...opened].filter(name => VOID.has(name) || closed.has(name))
  const first = lines[0]
  const checks: Record<Rule, boolean> = {
    'result first': first?.kind === 'line' && RESULT[emoji].test(first.text),
    'rules where set': placed.rules,
    'next step where set': placed.next,
    'sentences within limit': !isLongSentence,
    'blocks within limit': !isLongBlock,
    // The voice allows `<kbd>`; basic and plain Markdown forbid it among their forms.
    'no raw html': !isComment && paired.every(name => name === 'kbd'),
    'markdown forms as set': formsMet(parts, settings) && (settings.markdown === 'rich' || !paired.includes('kbd')),
  }

  return RULES.filter(rule => !checks[rule])
}

/**
 * The settings file and, beside it, the count, as `hooks/style-settings.js` names them: the
 * HUSH_CONFIG_FILE when it is set, else `config.json` in `<home>/.claude/hush`. Undefined
 * unless that is an absolute path to a file, so the count never lands in a project folder or the
 * folder above the one named. On Windows an absolute path has a drive or names a share; a path
 * rooted with no drive is left out, since it would follow whichever drive the process stands on.
 * A path that ends in a separator names a folder, not a file, and gets no count.
 */
export function countFiles(named: string | undefined, home: string | undefined, isWindows: boolean): { config: string; tally: string } | undefined {
  const sep = isWindows ? '\\' : '/'
  const config = named || (home ? `${home.replace(isWindows ? /[\\/]+$/ : /\/+$/, '')}${sep}.claude${sep}hush${sep}config.json` : '')
  const isAbsolute = isWindows ? /^(?:[A-Za-z]:[\\/]|[\\/]{2}[^\\/]+[\\/]+[^\\/]+[\\/]+[^\\/])/ : /^\//

  if (!isAbsolute.test(config) || (isWindows ? /[\\/]$/ : /\/$/).test(config)) return undefined

  const cut = isWindows ? Math.max(config.lastIndexOf('/'), config.lastIndexOf('\\')) : config.lastIndexOf('/')

  return { config, tally: `${config.slice(0, cut + 1)}tally.json` }
}

/**
 * The running count, kept as `tally.json` beside the settings file, which `/hush:config` reads.
 * Numbers, days and the settings key only: no word of a reply is stored.
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
  /** `settingsKey` of the settings the count was kept under. */
  settings: string
}

const FIELDS = ['last', 'messages', 'met', 'misses', 'settings', 'since']
// A count's file is a few hundred bytes; one past this is no count. style-settings.js agrees.
export const TALLY_MAX = 65536
const DAY = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/
const isCount = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0

/** A tally read back from the file for the settings `key`; anything else starts a new count. */
export function asTally(v: unknown, key: string): Tally | undefined {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return undefined

  const t = v as Record<string, unknown>
  const misses = t.misses

  if (
    Object.keys(t).some(k => !FIELDS.includes(k)) ||
    t.settings !== key ||
    !isCount(t.messages) ||
    t.messages === 0 ||
    !isCount(t.met) ||
    t.met > t.messages ||
    typeof t.since !== 'string' ||
    !DAY.test(t.since) ||
    typeof t.last !== 'string' ||
    !DAY.test(t.last) ||
    t.since > t.last ||
    typeof misses !== 'object' ||
    misses === null ||
    Array.isArray(misses)
  ) {
    return undefined
  }

  const messages = t.messages

  if (Object.entries(misses).some(([rule, n]) => !(RULES as readonly string[]).includes(rule) || !isCount(n) || n > messages)) return undefined

  return { messages, met: t.met, misses: { ...(misses as Tally['misses']) }, since: t.since, last: t.last, settings: key }
}

export function tally(prev: Tally | undefined, missed: readonly Rule[], day: string, key: string): Tally {
  const misses = { ...prev?.misses }

  for (const rule of missed) {
    misses[rule] = (misses[rule] ?? 0) + 1
  }

  return { messages: (prev?.messages ?? 0) + 1, met: (prev?.met ?? 0) + (missed.length === 0 ? 1 : 0), misses, since: prev?.since ?? day, last: day, settings: key }
}
