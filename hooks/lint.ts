import type { AlertType } from './reply'

// A free judge of Hush's final message: each turn's answer checked against the voice's
// countable rules, kept as running totals. It shows the reader nothing; the owner reads the
// totals with /hush-lint, so a change to the voice can be judged on real sessions
// before a paid run. Each rule follows the reader's /hush:config settings, as the voice does.

export const RULES = [
  'result first',
  'rules where set',
  'next step where set',
  'sentences within limit',
  'blocks within limit',
  'words within limit',
  'no raw html',
  'links resolve',
  'alerts within limit',
  'alerts apart',
  'alert types allowed',
  'alerts hold a risk (proxy)',
  'next stands alone (proxy)',
] as const

// Names an earlier version of this mod stored, and the rule each became.
export const RENAMED: Readonly<Record<string, Rule>> = {
  'sentences ≤ 12 words': 'sentences within limit',
  'blocks ≤ 40 words': 'blocks within limit',
}

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

// Words outside code by the detail setting; bare names no number.
const WORDS: Record<Settings['detail'], number> = { normal: 250, short: 80, full: 400, bare: Infinity }

export type Rule = (typeof RULES)[number]

export type Lint = {
  failed: Rule[]
  words: number
  longestSentence: number
  longestBlock: number
  // The longest sentence itself, so a failure can be checked by hand.
  sentence: string
}

const NEXT = /^\*\*[^*]{2,40}:\*\*\s/
// A next step that points back by place instead of naming the thing. "arriba" and "above"
// may mean this same message, so the rule only flags candidates for review.
const POINTS_BACK = /mensaje anterior|respuesta anterior|previous (message|reply)|earlier (message|reply)|\barriba\b|\babove\b/i
const RULE_LINE = /^\s*(---|\*\*\*|___)\s*$/
const FENCE = /^\s*(`{3,}|~{3,})/
// The voice allows only <kbd>; the app draws any other tag as raw text.
const HTML = /<\/?(?!kbd\b)[a-z][a-z0-9-]*(\s[^>]*)?>/i

const wordsOf = (text: string) => text.split(/\s+/).filter(word => /[\p{L}\p{N}]/u.test(word)).length

const ALERT = /^\s*>\s*\[!(note|tip|important|warning|caution)\]\s*/i
// The two alerts the desktop section gives risks and blockers; any other alert counts.
const FLOOR = /^\s*>\s*\[!(warning|caution)\]/i

type Block = { text: string; floor: boolean }

// The prose a reader reads as sentences: no code, no table rows, no headings, no rules, and
// no Markdown marks around them. An alert's body is `floor`: on the desktop, the voice puts
// risks and blockers there, and those never count toward the word budget.
function proseBlocks(text: string): Block[] {
  const blocks: Block[] = []
  let block: string[] = []
  let fence: string | null = null
  let floor = false

  const flush = () => {
    if (block.length > 0) {
      blocks.push({ text: block.join(' '), floor })
    }

    block = []
    floor = false
  }

  for (const raw of text.split('\n')) {
    let line = raw

    if (ALERT.test(line)) {
      flush()
      floor = FLOOR.test(line)
      line = line.replace(ALERT, '> ')
    } else if (floor && !/^\s*>/.test(line)) {
      flush()
    }

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
      const isFloor = floor
      flush()
      floor = isFloor
    }

    if (line.replace(/^\s*>\s?/, '').trim() === '') {
      continue
    }

    block.push(line.replace(/`[^`]*`/g, 'x').replace(/^\s*(([-*+]|\d+[.)])\s+|>\s?)(\[[ x]\]\s*)?/, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1'))
  }

  flush()

  return blocks
}

// The alerts outside code, each with its body and whether only blank lines part it from the
// alert before.
function alertsOf(text: string): { type: AlertType; body: string[]; adjacent: boolean }[] {
  const found: { type: AlertType; body: string[]; adjacent: boolean }[] = []
  let fence: string | null = null
  let open = false
  let gap = true

  for (const line of text.split('\n')) {
    const marker = FENCE.exec(line)?.[1]

    if (fence !== null || marker !== undefined) {
      fence = fence === null ? (marker ?? null) : marker !== undefined && marker[0] === fence[0] && marker.length >= fence.length ? null : fence
      open = false
      gap = true
      continue
    }

    const alert = ALERT.exec(line)

    if (alert !== null) {
      found.push({ type: (alert[1] ?? 'note').toLowerCase() as AlertType, body: [line.replace(ALERT, '')], adjacent: !gap && found.length > 0 })
      open = true
      gap = false
    } else if (open && /^\s*>/.test(line)) {
      found.at(-1)?.body.push(line.replace(/^\s*>\s?/, ''))
    } else if (line.trim() !== '') {
      open = false
      gap = true
    } else {
      open = false
    }
  }

  return found
}

// The alerts the desktop section allows: one of each, never side by side. Without the section,
// none.
export const SECTION_ALERTS: readonly AlertType[] = ['warning', 'caution']

// A sentence ends at . ! ? before a space or the end; numbers like 1.5 and file names like
// a.js have no space after the point.
const sentencesOf = (block: string) => block.split(/(?<=[.!?…])\s+/).filter(sentence => sentence.trim() !== '')

// Where the voice puts its horizontal rules and its "Next:" line, by setting. With rules on:
// next=end has one under the result and one above "Next:"; next=top has "Next:" right under
// the result and one rule after it; next=off has one under the result. Plain Markdown and
// rules=off have none. Footnotes may end with a line holding only `&nbsp;`.
function layout(lines: readonly string[], s: Settings): { rules: boolean; next: boolean } {
  const isRule = (i: number) => RULE_LINE.test(lines.at(i) ?? '')
  const isNext = (i: number) => NEXT.test(lines.at(i) ?? '')
  const ruled = s.rules === 'on' && s.markdown !== 'plain'
  const nextAt = lines.findIndex((_, i) => isNext(i))

  if (!ruled) {
    const none = !lines.some((_, i) => isRule(i))

    return {
      rules: none,
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

// `missing` is how many of `localLinks(text)` name no file; the caller reads the disk.
// `allowed` is the alert types the turn's prompt allowed: `SECTION_ALERTS` with the desktop
// section, none without it.
export function lintMessage(text: string, settings: Settings = settingsOf(undefined), missing = 0, allowed: readonly AlertType[] = SECTION_ALERTS): Lint {
  const all = text.split('\n').map(line => line.trim()).filter(line => line !== '')
  // A trailing `&nbsp;` line only keeps a footnote off the last line.
  const lines = all.at(-1) === '&nbsp;' ? all.slice(0, -1) : all
  const parts = proseBlocks(text)
  const blocks = parts.map(b => b.text)
  const sentences = blocks.flatMap(sentencesOf)
  const sentenceWords = sentences.map(wordsOf)
  const blockWords = blocks.map(wordsOf)
  const words = parts.filter(b => !b.floor).reduce((sum, b) => sum + wordsOf(b.text), 0)
  const longestSentence = Math.max(0, ...sentenceWords)
  const longestBlock = Math.max(0, ...blockWords)
  const placed = layout(lines, settings)
  const wide = settings.sentences === '20'
  // Only rich Markdown allows <kbd>; basic and plain forbid it like any other tag.
  const html = settings.markdown === 'rich' ? HTML : /<\/?[a-z][a-z0-9-]*(\s[^>]*)?>/i
  const alerts = alertsOf(text)
  const ofType = (type: AlertType) => alerts.filter(a => a.type === type).length

  const checks: Record<Rule, boolean> = {
    'result first': /^\*\*[^*].*\*\*$/.test(lines[0] ?? ''),
    'rules where set': placed.rules,
    'next step where set': placed.next,
    'sentences within limit': longestSentence <= (wide ? 20 : 12),
    'blocks within limit': longestBlock <= (wide ? 60 : 40),
    'words within limit': words <= WORDS[settings.detail],
    'no raw html': !html.test(blocks.join('\n')),
    'links resolve': missing === 0,
    // GitHub: "one or two per article", "avoid placing alerts consecutively".
    'alerts within limit': alerts.length <= 2 && SECTION_ALERTS.every(type => ofType(type) <= 1),
    'alerts apart': !alerts.some(a => a.adjacent),
    'alert types allowed': alerts.every(a => allowed.includes(a.type)),
    // Whether an alert holds a risk cannot be counted; an empty body or a body holding the
    // `Next:` line stands for one that holds none.
    'alerts hold a risk (proxy)': alerts.every(a => a.body.join('').trim() !== '' && !a.body.some(line => NEXT.test(line.trim()))),
    'next stands alone (proxy)': !lines.some(line => NEXT.test(line) && POINTS_BACK.test(line)),
  }

  return {
    failed: RULES.filter(rule => !checks[rule]),
    words,
    longestSentence,
    longestBlock,
    sentence: sentences[sentenceWords.indexOf(longestSentence)] ?? '',
  }
}

export type Tally = {
  messages: number
  failures: Partial<Record<Rule, number>>
  words: number
  outputTokens: number
  // `mermaid` and `alert` say whether the message used each form; absent in older entries.
  recent: { at: string; words: number; tokens: number; failed: Rule[]; mermaid?: boolean; alert?: boolean }[]
}

export const EMPTY: Tally = { messages: 0, failures: {}, words: 0, outputTokens: 0, recent: [] }

// A tally an earlier version stored, its rule names brought up to date.
export function upgrade(t: Tally): Tally {
  const name = (rule: string) => RENAMED[rule] ?? rule
  const failures: Tally['failures'] = {}

  for (const [rule, n] of Object.entries(t.failures)) {
    failures[name(rule) as Rule] = (failures[name(rule) as Rule] ?? 0) + (n ?? 0)
  }

  return { ...t, failures, recent: t.recent.map(r => ({ ...r, failed: r.failed.map(f => name(f) as Rule) })) }
}

export function tally(prev: Tally, lint: Lint, tokens: number, at: string, forms: { mermaid: boolean; alert: boolean } = { mermaid: false, alert: false }): Tally {
  const failures = { ...prev.failures }

  for (const rule of lint.failed) {
    failures[rule] = (failures[rule] ?? 0) + 1
  }

  return {
    messages: prev.messages + 1,
    failures,
    words: prev.words + lint.words,
    outputTokens: prev.outputTokens + tokens,
    recent: [...prev.recent, { at, words: lint.words, tokens, failed: lint.failed, ...forms }].slice(-50),
  }
}

// The forms the desktop section allows, so its two arms can be told apart by use.
export const usesForms = (text: string) => ({ mermaid: /^\s*(`{3,}|~{3,})\s*mermaid\b/m.test(text), alert: /^\s*>\s*\[!(note|tip|important|warning|caution)\]/im.test(text) })

/** What /hush-lint says, in the person's language, from the catalogs in `register.tsx`. */
export type ReportWords = {
  none: (title: string) => string
  summary: (title: string, n: { messages: number; mermaid: number; alert: number; recent: number; words: number; tokens: number }) => string
  rule: string
  passed: string
  // Display names only: the stored tallies keep the English names in `RULES`.
  rules: Record<Rule, string>
}

export function report(t: Tally, title: string, w: ReportWords): string {
  if (t.messages === 0) {
    return w.none(title)
  }

  const pct = (n: number) => `${Math.round((100 * n) / t.messages)}%`
  const rows = RULES.map(rule => `| ${w.rules[rule]} | ${pct(t.messages - (t.failures[rule] ?? 0))} |`)

  return [
    w.summary(title, {
      messages: t.messages,
      mermaid: t.recent.filter(r => r.mermaid === true).length,
      alert: t.recent.filter(r => r.alert === true).length,
      recent: t.recent.length,
      words: Math.round(t.words / t.messages),
      tokens: Math.round(t.outputTokens / t.messages),
    }),
    '',
    `| ${w.rule} | ${w.passed} |`,
    '|---|---|',
    ...rows,
  ].join('\n')
}
