// A silent check of Hush's final message: each answer is tested for the structure the voice
// (`output-styles/hush.md`) and the `modules/*.md` texts of the reader's /hush:config settings ask
// for, and only numbers are kept. It never changes or draws anything in the reply, and it stores
// no text of one.
//
// A count that is wrong is worse than none: where a rule cannot tell whether a message follows
// the voice, it counts no miss. So nothing about the text itself is counted: no length, sentence,
// block, HTML, Markdown form or link. Those depend on the language and on what the message is
// about, and a count cannot tell them for certain.

export const RULES = ['result first', 'rules where set', 'next step where set'] as const

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

/** Whether every knob is at its default, so Hush's SessionStart hook sends the model nothing. */
export const isDefault = (s: Settings): boolean => Object.entries(KNOBS).every(([k, values]) => s[k as keyof Settings] === values[0])

// The knobs the rules read, in a fixed order. The others change what the message holds, not where
// its result, rules and next step sit; markdown counts only as far as `plain` has no rules. A
// change to one of these starts a new count. style-settings.js keeps the same list as TALLY_KNOBS.
export const READ = ['next', 'rules', 'markdown', 'emoji', 'headers'] as const

/** The values of the knobs the rules read, such as `end-on-rich-off-off`: no text of a reply. */
export const settingsKey = (s: Settings): string => READ.map(k => s[k]).join('-')

// A message is read as parts: each line outside code, trimmed, with every direction mark dropped
// (Unicode's Bidi_Control set: U+061C, U+200E, U+200F, U+202A-U+202E, U+2066-U+2069, which draw
// nothing) and the zero-width space, word joiner and byte order mark dropped, and each fenced or
// `$$` block as one code part. A hyphen line right under a line of text may be that text's setext
// heading: it is `loose`, a rule only where its absence would miss. Structure is read from these, so
// nothing inside code counts, and a quote block's `>` keeps its lines from reading as a rule or a
// Next line. A `$$` block still open at the end may not be math on every renderer, so its lines
// are read as prose: what follows it is never hidden.
//
// A fence opens after list markers, a task box or a footnote label, as CommonMark nests it. A line
// with less indent than the list item's text leaves the item and ends its fence. A fence inside a
// quote is left alone: every line of it opens with `>`, so it reads as no rule and no Next line, and
// the first line without `>` is read as it stands. A backtick or tilde fence still open at the end
// leaves the count unable to tell what it hid (`open`).
type Part = { kind: 'code' } | { kind: 'line'; text: string; loose?: true } | { kind: 'open' }

const FENCE = /^(`{3,}|~{3,})/
const ITEM = /^[ \t]*(?:(?:[-*+]|\d{1,9}[.)])[ \t]+)+/
const BOX = /^(?:\[[ xX]\][ \t]+|\[\^[^\]\s]+\]:[ \t]*)/
const BIDI = new RegExp('[\\p{Bidi_Control}\\u200B\\u2060\\uFEFF]', 'gu')
const clean = (raw: string) => raw.replace(BIDI, '').trim()

function partsOf(lines: readonly string[]): Part[] {
  const parts: Part[] = []
  let fence = ''
  // The column the open fence's list item text starts at: a line needs that indent to stay in it.
  let column = 0
  // Where the open `$$` block starts: its line, and its place among the parts.
  let math = { line: 0, part: 0 }

  for (const [i, raw] of lines.entries()) {
    const line = clean(raw)

    if (fence === '$$') {
      if (line.endsWith('$$')) fence = ''

      continue
    }

    const bare = raw.replace(BIDI, '')

    if (fence !== '') {
      if (line === '' || bare.length - bare.trimStart().length >= column) {
        if (line.length >= fence.length && line === fence.charAt(0).repeat(line.length)) fence = ''

        continue
      }

      fence = ''
    }

    const item = ITEM.exec(bare)?.[0].length ?? 0
    const opener = clean(bare.slice(item).replace(BOX, ''))
    const marks = FENCE.exec(opener)?.[1] ?? ''

    // A backtick fence's info string holds no backtick: "```x```" is inline code.
    if (marks !== '' && !(marks.startsWith('`') && opener.slice(marks.length).includes('`'))) {
      parts.push({ kind: 'code' })
      fence = marks
      column = item
    } else if (line.startsWith('$$')) {
      if (line.length < 4 || !line.endsWith('$$')) {
        fence = '$$'
        math = { line: i, part: parts.length }
      }

      parts.push({ kind: 'code' })
    } else if (/^-{3,}$/.test(line) && i > 0 && clean(lines[i - 1]) !== '') {
      parts.push({ kind: 'line', text: line, loose: true })
    } else {
      parts.push({ kind: 'line', text: line })
    }
  }

  if (fence === '$$') return [...parts.slice(0, math.part), { kind: 'line', text: clean(lines[math.line]) }, ...partsOf(lines.slice(math.line + 1))]

  return fence === '' ? parts : [...parts, { kind: 'open' }]
}

const RULE_LINE = /^(?:(?:-[ \t]*){3,}|(?:\*[ \t]*){3,}|(?:_[ \t]*){3,})$/
const EMOJI = '\\p{Extended_Pictographic}\\p{Emoji_Modifier}?(?:\\uFE0F|\\u200D\\p{Extended_Pictographic}\\p{Emoji_Modifier}?)*\\s*'
// The colons of living scripts, from Unicode's punctuation named COLON: full-width (Japanese,
// Chinese), the Ethiopic colon and preface colon, the Mongolian and Bamum colons, and the small and
// vertical forms. French puts a space, U+00A0 or U+202F before a colon.
const COLONS = '[:\\uFF1A\\u1365\\u1366\\u1804\\uA6F4\\uFE55\\uFE13]'
const COLON = `[ \\u00A0\\u202F]?${COLONS}`
// A sentence's end in any script (`\p{STerm}`: . ! ? 。 । ؟ ። and the like), the Greek question
// mark and the semicolon it normalises to, and the ellipsis, which may follow the bold result.
const STOP = '[\\p{STerm};\\u037E…]'
// A bold line; its stop, a colon, a closing quote and a footnote mark may follow the bold, in any
// order, and a backslash hard break may end it.
const BOLD = `(?:\\*\\*(?=\\S)(?:.*\\S)?\\*\\*|__(?=\\S)(?:.*\\S)?__)(?:${STOP}|${COLON}|\\p{Pf}|["']|\\[\\^[^\\]\\s]+\\])*\\\\?$`
// The bold result line; under emoji=on an emoji may open it ("before any bold").
const RESULT = [new RegExp(`^${BOLD}`, 'u'), new RegExp(`^(?:${EMOJI})?${BOLD}`, 'u')] as const
// The "Next:" line opens with its word in bold, in any language, with its colon inside the bold
// or after it.
const NEXT_WORD = `(?:\\*\\*[^*]{1,40}?${COLONS}\\*\\*|\\*\\*[^*]{1,40}\\*\\*${COLON}|__[^_]{1,40}?${COLONS}__|__[^_]{1,40}__${COLON})`
const NEXT = [new RegExp(`^${NEXT_WORD}`, 'u'), new RegExp(`^(?:${EMOJI})?${NEXT_WORD}`, 'u')] as const
// A section header (headers=on): a short bold line of its own; its emoji may sit in or before it.
const HEADER_WORD = `(?:\\*\\*[^*]{1,40}\\*\\*|__[^_]{1,40}__)(?:${COLON})?$`
const HEADER = [new RegExp(`^${HEADER_WORD}`, 'u'), new RegExp(`^(?:${EMOJI})?${HEADER_WORD}`, 'u')] as const

/**
 * Whether the rules and the Next step sit where the settings put them, one miss for each missing
 * piece:
 * - The result is the first line. When it is not, and the line under it is a bold line, that
 *   line is read as the result for the rule under it, so one line too many above the result
 *   misses result first alone.
 * - next=end, rules on: a rule under the result, and a "Next:" line, or a header under
 *   headers=on, somewhere after it. A bold label with no rule above it may be a Next line that
 *   lost its rule or a landmark of the body with the step missing; a count cannot tell which, so
 *   it misses neither. Anything may follow the Next line. A Next line right under the result,
 *   above every rule, is next=top's shape: the step's miss alone.
 * - next=top: the Next step is every line from the one under the result to the first rule, so a
 *   soft break, the closing sentence as its own paragraph, a header's lines and the code the step
 *   needs all sit in it. With rules on, a rule ends it; a message with no rule at all is no miss,
 *   since nothing tells whether a body follows the step.
 * - next=off, rules on: a rule under the result.
 * - rules=off and markdown=plain have no rule outside code, and nothing marks where the Next step
 *   starts: only a message with no "Next:" line at all misses it.
 * - headers=on: a "Next step" header line, then the action or the code it needs, stands where
 *   "Next:" stands. The header's word cannot be told from another block's, so under next=end only
 *   a message with no header after the result misses the step.
 */
function placement(lines: readonly Part[], s: Settings): { rules: boolean; next: boolean } {
  const emoji = s.emoji === 'on' ? 1 : 0
  const textAt = (i: number) => {
    const part = lines[i]

    return part?.kind === 'line' ? part.text : undefined
  }
  const isRule = (i: number) => RULE_LINE.test(textAt(i) ?? '\n')
  // A rule that is no heading's underline: where a rule makes a miss, only such a rule counts.
  const isFirm = (i: number) => isRule(i) && !(lines[i] as { loose?: true }).loose
  // A bold footnote label, `**[^a]:**`, is no Next line.
  const isInline = (i: number) => NEXT[emoji].test(textAt(i) ?? '') && !/^(?:\*\*|__)\[\^/.test(textAt(i) ?? '')
  const isHeader = (i: number) => HEADER[emoji].test(textAt(i) ?? '') && lines[i + 1] !== undefined
  const isNext = (i: number) => i >= 1 && (s.headers === 'on' ? isHeader(i) : isInline(i))
  const ruled = s.rules === 'on' && s.markdown !== 'plain'
  const n = lines.length
  const indices = Array.from({ length: n }, (_, i) => i)
  const hasRule = indices.some(isFirm)
  // The result's place: the second line when the first is not one and the second is.
  const r = !RESULT[emoji].test(textAt(0) ?? '') && RESULT[emoji].test(textAt(1) ?? '') ? 1 : 0
  const isUnder = isRule(1) || isRule(r + 1)

  if (s.next === 'off') {
    // No Next line "in any language": a count cannot tell the word, so only the shape the voice
    // gives "Next:", a rule of its own above a closing bold label, is a miss.
    const endAt = s.headers === 'on' ? (isHeader(n - 2) || !isInline(n - 1) ? n - 2 : n - 1) : isInline(n - 1) || !isHeader(n - 2) ? n - 1 : n - 2
    // A header over a footnote heads notes, not a step.
    const isShape = ruled && endAt - 1 > 1 && isFirm(endAt - 1) && (isInline(endAt) || isHeader(endAt)) && !textAt(endAt + 1)?.startsWith('[^')

    return { rules: ruled ? isUnder : !hasRule, next: !isShape }
  }

  if (s.next === 'top') return { rules: ruled || !hasRule, next: isNext(1) || isNext(r + 1) }

  // next=top's shape: a Next line under the result, a rule after it, and no Next line below that
  // rule. Above every rule the step is out of its place, whether it is the step or a landmark with
  // the step missing; the rule sits where that shape puts it.
  const below = indices.find(i => i > r + 1 && isFirm(i))

  if (ruled && !isUnder && isNext(r + 1) && below !== undefined && !indices.some(i => i > below && isNext(i))) return { rules: true, next: false }

  return { rules: ruled ? isUnder : !hasRule, next: indices.some(isNext) }
}

/** The rules the answer misses. */
export function lintMessage(text: string, settings: Settings = settingsOf(undefined)): Rule[] {
  // The parts a reader sees, blank lines out, with a closing `&nbsp;` line skipped.
  const lines = partsOf(text.split(/\r?\n/)).filter(part => part.kind !== 'line' || part.text !== '')
  const isOpen = lines[lines.length - 1]?.kind === 'open'

  if (isOpen) lines.pop()

  while ((lines[lines.length - 1] as { text?: string } | undefined)?.text === '&nbsp;') lines.pop()

  const placed = isOpen ? { rules: true, next: true } : placement(lines, settings)
  const first = lines[0]
  const checks: Record<Rule, boolean> = {
    'result first': first?.kind === 'line' && RESULT[settings.emoji === 'on' ? 1 : 0].test(first.text),
    'rules where set': placed.rules,
    'next step where set': placed.next,
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

/**
 * A tally read back from the file for the settings `key`; anything else starts a new count, one
 * an earlier version kept under other rules or another key included.
 */
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
  const missed = messages - t.met

  // A message that met every rule missed none, and one that did not missed at least one.
  if (
    Object.entries(misses).some(([rule, n]) => !(RULES as readonly string[]).includes(rule) || !isCount(n) || n > missed) ||
    Object.values(misses as Record<string, number>).reduce((sum, n) => sum + n, 0) < missed
  ) {
    return undefined
  }

  return { messages, met: t.met, misses: { ...(misses as Tally['misses']) }, since: t.since, last: t.last, settings: key }
}

export function tally(prev: Tally | undefined, missed: readonly Rule[], day: string, key: string): Tally {
  const misses = { ...prev?.misses }

  for (const rule of missed) {
    misses[rule] = (misses[rule] ?? 0) + 1
  }

  return { messages: (prev?.messages ?? 0) + 1, met: (prev?.met ?? 0) + (missed.length === 0 ? 1 : 0), misses, since: prev?.since ?? day, last: day, settings: key }
}
