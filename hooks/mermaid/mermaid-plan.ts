import { linesOf, statementsOf, unquote } from './mermaid-lex'

// The planning kinds of Mermaid: gantt charts, timelines, user journeys and kanban
// boards. Each reads as null where the source says something it cannot draw.

export type GanttTask = {
  id: string
  label: string
  section: string
  // Milliseconds, UTC.
  start: number
  end: number
  done: boolean
  active: boolean
  crit: boolean
  milestone: boolean
}

export type Gantt = { kind: 'gantt'; title: string; sections: string[]; tasks: GanttTask[] }

export type Period = { label: string; section: string; events: string[] }

export type Timeline = { kind: 'timeline'; title: string; sections: string[]; periods: Period[] }

export type Step = { label: string; section: string; score: number; actors: string[] }

export type Journey = { kind: 'journey'; title: string; sections: string[]; actors: string[]; steps: Step[] }

export type Card = { label: string; assigned: string; priority: string; ticket: string }

export type Column = { label: string; cards: Card[] }

export type Kanban = { kind: 'kanban'; title: string; columns: Column[] }

const MAX_TASKS = 40
const MAX_PERIODS = 40
const MAX_STEPS = 40
const MAX_COLUMNS = 12
const MAX_CARDS = 60

// --- Gantt --------------------------------------------------------------------------

const DAY = 86_400_000
const UNIT: Readonly<Record<string, number>> = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: DAY, w: 7 * DAY, M: 30 * DAY, y: 365 * DAY }
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
// Settings that change how Mermaid labels or highlights the axis, not what it holds.
const GANTT_SETTINGS = /^(axisFormat|tickInterval|todayMarker|weekday|weekend|inclusiveEndDates|topAxis|displayMode)\b/

type Raw = { id: string; label: string; section: string; flags: Set<string>; start: string; end: string; after: string }

// `dateFormat` as a reader: the tokens Mermaid's examples use, everything else literal.
function dateReader(format: string): (text: string) => number | null {
  const fields: string[] = []
  const pattern = format.replace(/YYYY|YY|MM|M|DD|D|HH|H|mm|ss|SSS|X|x|[.*+?^${}()|[\]\\]/g, token => {
    if (/^[.*+?^${}()|[\]\\]$/.test(token)) {
      return `\\${token}`
    }

    fields.push(token)

    return token === 'X' || token === 'x' ? '(\\d+)' : `(\\d{1,${token === 'YYYY' ? 4 : token === 'SSS' ? 3 : 2}})`
  })
  const exact = new RegExp(`^${pattern}$`)

  return text => {
    const match = exact.exec(text.trim())

    if (match === null) {
      // Mermaid falls back to the browser's own date reading; ISO dates are what it reads.
      const iso = /^\d{4}-\d{2}-\d{2}(T[\d:.]+Z?)?$/.test(text.trim()) ? Date.parse(text.trim()) : Number.NaN

      return Number.isFinite(iso) ? iso : null
    }

    const part = { year: 1970, month: 1, day: 1, hour: 0, minute: 0, second: 0, milli: 0 }

    for (const [i, field] of fields.entries()) {
      const value = Number(match[i + 1])

      switch (field) {
        case 'X':
          return value * 1000
        case 'x':
          return value
        case 'YYYY':
          part.year = value
          break
        case 'YY':
          part.year = 2000 + value
          break
        case 'MM':
        case 'M':
          part.month = value
          break
        case 'DD':
        case 'D':
          part.day = value
          break
        case 'HH':
        case 'H':
          part.hour = value
          break
        case 'mm':
          part.minute = value
          break
        case 'ss':
          part.second = value
          break
        case 'SSS':
          part.milli = value
          break
      }
    }

    const time = Date.UTC(part.year, part.month - 1, part.day, part.hour, part.minute, part.second, part.milli)

    return Number.isFinite(time) ? time : null
  }
}

export function parseGantt(body: readonly string[]): Gantt | null {
  let title = ''
  let readDate = dateReader('YYYY-MM-DD')
  let section = ''
  const excludes: string[] = []
  const sections: string[] = []
  const raws: Raw[] = []

  for (const statement of statementsOf(body)) {
    const setting = /^(title|dateFormat|excludes|section)\s+(.*)$/.exec(statement)
    const task = /^([^:]+?)\s*:\s*(.*)$/.exec(statement)

    if (setting?.[1] === 'title') {
      title = unquote(setting[2] ?? '')
    } else if (setting?.[1] === 'dateFormat') {
      readDate = dateReader((setting[2] ?? '').trim())
    } else if (setting?.[1] === 'excludes') {
      excludes.push(...(setting[2] ?? '').toLowerCase().split(/[\s,]+/).filter(item => item !== ''))
    } else if (setting?.[1] === 'section') {
      section = unquote(setting[2] ?? '')
      sections.push(section)
    } else if (GANTT_SETTINGS.test(statement)) {
      continue
    } else if (task !== null) {
      const items = (task[2] ?? '').split(',').map(item => item.trim()).filter(item => item !== '')
      const flags = new Set<string>()

      while (items[0] !== undefined && /^(done|active|crit|milestone)$/.test(items[0])) {
        flags.add(items.shift() ?? '')
      }

      if (items.length === 0 || items.length > 3) {
        return null
      }

      const [first = '', second = '', third = ''] = items
      raws.push({
        id: items.length === 3 ? first : `task${raws.length + 1}`,
        label: unquote(task[1] ?? ''),
        section,
        flags,
        start: items.length === 1 ? '' : items.length === 2 ? first : second,
        end: items.length === 1 ? first : items.length === 2 ? second : third,
        after: raws[raws.length - 1]?.id ?? '',
      })
    } else {
      return null
    }
  }

  if (raws.length === 0 || raws.length > MAX_TASKS) {
    return null
  }

  const isExcluded = (time: number): boolean => {
    const date = new Date(time)
    const weekday = WEEKDAYS[date.getUTCDay()] ?? ''
    const iso = date.toISOString().slice(0, 10)

    return excludes.some(item =>
      item === 'weekends' ? weekday === 'saturday' || weekday === 'sunday' : item === weekday || readDate(item) === Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) || item === iso,
    )
  }

  // Excluded days inside a task push its end out by a day each, as Mermaid's do.
  const pushOut = (start: number, end: number): number => {
    let until = end

    for (let day = start, guard = 0; day < until && guard < 3660; day += DAY, guard++) {
      if (isExcluded(day)) {
        until += DAY
      }
    }

    return until
  }

  const byId = new Map(raws.map(raw => [raw.id, raw]))
  const resolved = new Map<string, { start: number; end: number }>()
  const open = new Set<string>()

  // Tasks may name tasks further down; each resolves once, a cycle reads as null.
  const resolve = (raw: Raw): { start: number; end: number } | null => {
    const known = resolved.get(raw.id)

    if (known !== undefined) {
      return known
    }

    if (open.has(raw.id)) {
      return null
    }

    open.add(raw.id)
    const start = startOf(raw)
    const end = start === null ? null : endOf(raw, start)
    open.delete(raw.id)

    if (start === null || end === null || end < start) {
      return null
    }

    resolved.set(raw.id, { start, end })

    return { start, end }
  }

  const endsOf = (ids: readonly string[]): number[] | null => {
    const ends = ids.map(id => {
      const other = byId.get(id)

      return other === undefined ? null : resolve(other)?.end ?? null
    })

    return ends.every(end => end !== null) ? (ends as number[]) : null
  }

  const startOf = (raw: Raw): number | null => {
    if (raw.start === '') {
      const previous = byId.get(raw.after)

      return previous === undefined ? null : resolve(previous)?.end ?? null
    }

    const after = /^after\s+(.+)$/.exec(raw.start)

    if (after !== null) {
      const ends = endsOf((after[1] ?? '').split(/\s+/))

      return ends === null ? null : Math.max(...ends)
    }

    return readDate(raw.start)
  }

  const endOf = (raw: Raw, start: number): number | null => {
    const duration = /^(\d+(?:\.\d+)?)(ms|s|m|h|d|w|M|y)$/.exec(raw.end)
    const until = /^until\s+(.+)$/.exec(raw.end)

    if (duration !== null) {
      return pushOut(start, start + Number(duration[1]) * (UNIT[duration[2] ?? 'd'] ?? DAY))
    }

    if (until !== null) {
      const starts = (until[1] ?? '').split(/\s+/).map(id => {
        const other = byId.get(id)

        return other === undefined ? null : resolve(other)?.start ?? null
      })

      return starts.every(time => time !== null) ? Math.min(...(starts as number[])) : null
    }

    return readDate(raw.end)
  }

  const tasks: GanttTask[] = []

  for (const raw of raws) {
    const span = resolve(raw)

    if (span === null) {
      return null
    }

    tasks.push({
      id: raw.id,
      label: raw.label,
      section: raw.section,
      ...span,
      done: raw.flags.has('done'),
      active: raw.flags.has('active'),
      crit: raw.flags.has('crit'),
      milestone: raw.flags.has('milestone'),
    })
  }

  return { kind: 'gantt', title, sections: sections.filter(name => tasks.some(task => task.section === name)), tasks }
}

// --- Timeline -----------------------------------------------------------------------

export function parseTimeline(body: readonly string[]): Timeline | null {
  let title = ''
  let section = ''
  const sections: string[] = []
  const periods: Period[] = []

  for (const statement of linesOf(body).map(line => line.trim())) {
    const setting = /^(title|section)\s+(.*)$/.exec(statement)

    if (setting?.[1] === 'title') {
      title = unquote(setting[2] ?? '')
    } else if (setting?.[1] === 'section') {
      section = unquote(setting[2] ?? '')
      sections.push(section)
    } else if (statement.startsWith(':')) {
      // A line of its own carrying more events for the period above it.
      const last = periods[periods.length - 1]

      if (last === undefined) {
        return null
      }

      last.events.push(...eventsOf(statement.slice(1)))
    } else {
      const [label = '', ...events] = statement.split(':')
      periods.push({ label: unquote(label), section, events: eventsOf(events.join(':')) })
    }
  }

  return periods.length === 0 || periods.length > MAX_PERIODS ? null : { kind: 'timeline', title, sections: sections.filter(name => periods.some(period => period.section === name)), periods }
}

const eventsOf = (text: string): string[] => text.split(':').map(unquote).filter(event => event !== '')

// --- Journey ------------------------------------------------------------------------

export function parseJourney(body: readonly string[]): Journey | null {
  let title = ''
  let section = ''
  const sections: string[] = []
  const steps: Step[] = []

  for (const statement of linesOf(body).map(line => line.trim())) {
    const setting = /^(title|section)\s+(.*)$/.exec(statement)
    const step = /^([^:]+?)\s*:\s*(-?\d+(?:\.\d+)?)\s*(?::\s*(.*))?$/.exec(statement)

    if (setting?.[1] === 'title') {
      title = unquote(setting[2] ?? '')
    } else if (setting?.[1] === 'section') {
      section = unquote(setting[2] ?? '')
      sections.push(section)
    } else if (step !== null) {
      steps.push({
        label: unquote(step[1] ?? ''),
        section,
        score: Math.max(0, Math.min(5, Number(step[2]))),
        actors: (step[3] ?? '').split(',').map(unquote).filter(actor => actor !== ''),
      })
    } else {
      return null
    }
  }

  if (steps.length === 0 || steps.length > MAX_STEPS) {
    return null
  }

  return {
    kind: 'journey',
    title,
    sections: sections.filter(name => steps.some(step => step.section === name)),
    actors: [...new Set(steps.flatMap(step => step.actors))],
    steps,
  }
}

// --- Kanban -------------------------------------------------------------------------

const indentOf = (line: string): number => line.length - line.trimStart().length

// `id[Text]` or bare text, and the `@{ key: value }` a card may carry.
function itemOf(text: string): { label: string; meta: Record<string, string> } {
  const at = text.indexOf('@{')
  const head = (at === -1 ? text : text.slice(0, at)).trim()
  const meta: Record<string, string> = {}

  if (at !== -1) {
    for (const pair of text.slice(at + 2).replace(/\}\s*$/, '').matchAll(/(\w+)\s*:\s*('[^']*'|"[^"]*"|[^,]+)/g)) {
      meta[pair[1] ?? ''] = (pair[2] ?? '').trim().replace(/^(['"])(.*)\1$/, '$2')
    }
  }

  const bracketed = /^[^\s[\]]*\[(.*)\]$/.exec(head)

  return { label: unquote(bracketed?.[1] ?? head), meta }
}

export function parseKanban(body: readonly string[]): Kanban | null {
  const lines = linesOf(body)
  const columnIndent = Math.min(...lines.map(indentOf))
  const columns: Column[] = []

  for (const line of lines) {
    const item = itemOf(line.trim())

    if (indentOf(line) === columnIndent) {
      columns.push({ label: item.label, cards: [] })
    } else {
      const column = columns[columns.length - 1]

      if (column === undefined) {
        return null
      }

      column.cards.push({ label: item.label, assigned: item.meta.assigned ?? '', priority: item.meta.priority ?? '', ticket: item.meta.ticket ?? '' })
    }
  }

  const cards = columns.reduce((sum, column) => sum + column.cards.length, 0)

  return columns.length === 0 || columns.length > MAX_COLUMNS || cards > MAX_CARDS ? null : { kind: 'kanban', title: '', columns }
}
