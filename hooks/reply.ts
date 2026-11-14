import { parseMermaid } from './mermaid/mermaid'
import type { Chart } from './mermaid/mermaid'

// Which parts of a reply Hush draws itself. Only a closed Mermaid fence the parser reads and
// a GitHub alert become their own parts; everything else, every other fence included, stays
// markdown for the app to draw. A reply with neither is null: the app draws it whole.

export type AlertType = 'note' | 'tip' | 'important' | 'warning' | 'caution'

export type Part =
  | { kind: 'markdown'; text: string }
  | { kind: 'chart'; chart: Chart; source: string }
  | { kind: 'alert'; type: AlertType; body: string }
  | { kind: 'notes'; text: string }

const FENCE = /^\s*(`{3,}|~{3,})\s*([\w-]*)/
const ALERT = /^\s*>\s*\[!(note|tip|important|warning|caution)\]\s*(.*)$/i
const QUOTE = /^\s*>\s?(.*)$/
const FOOTNOTE = /^\[\^([^\]\s]+)\]:/
const CITED = /\[\^([^\]\s]+)\](?!:)/g
const KBD = /<kbd>(.*?)<\/kbd>/gi

// The line that closes the fence opened by `marker`, or -1 while it still streams.
function closeOf(lines: readonly string[], from: number, marker: string): number {
  const char = marker[0] ?? '`'

  return lines.findIndex((line, j) => j > from && new RegExp(`^\\s*\\${char}{${marker.length},}\\s*$`).test(line))
}

export function splitReply(text: string): Part[] | null {
  const lines = text.split('\n')
  const parts: Part[] = []
  let prose: string[] = []
  let isOwn = false

  const flush = () => {
    if (prose.join('').trim() !== '') {
      parts.push({ kind: 'markdown', text: prose.join('\n') })
    }

    prose = []
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? ''
    const fence = FENCE.exec(line)

    if (fence !== null) {
      const close = closeOf(lines, i, fence[1] ?? '```')
      const end = close === -1 ? lines.length - 1 : close
      const source = lines.slice(i + 1, end).join('\n')
      const chart = close !== -1 && fence[2]?.toLowerCase() === 'mermaid' ? parseMermaid(source) : null

      if (chart === null) {
        prose.push(...lines.slice(i, end + 1))
      } else {
        flush()
        parts.push({ kind: 'chart', chart, source })
        isOwn = true
      }

      i = end
      continue
    }

    const alert = ALERT.exec(line)

    if (alert !== null) {
      flush()
      const body = alert[2] === '' || alert[2] === undefined ? [] : [alert[2]]

      while (i + 1 < lines.length && QUOTE.test(lines[i + 1] ?? '')) {
        i++
        body.push(QUOTE.exec(lines[i] ?? '')?.[1] ?? '')
      }

      parts.push({ kind: 'alert', type: (alert[1] ?? 'note').toLowerCase() as AlertType, body: body.join('\n').trim() })
      isOwn = true
      continue
    }

    const note = FOOTNOTE.exec(line)

    if (note !== null) {
      flush()
      const last = parts.at(-1)
      // The note's own line opens with its label in brackets, as the app's own does.
      const entry = `[${note[1] ?? ''}] ${line.slice(note[0].length).trim()}`

      if (last?.kind === 'notes') {
        last.text = `${last.text}\n${entry}`
      } else {
        parts.push({ kind: 'notes', text: entry })
      }

      continue
    }

    prose.push(line)
  }

  flush()

  return isOwn ? parts : null
}

const SUPERSCRIPT = '⁰¹²³⁴⁵⁶⁷⁸⁹'

// A footnote's mark: raised digits for a number, the label in brackets otherwise.
function mark(label: string): string {
  return /^\d+$/.test(label) ? [...label].map(digit => SUPERSCRIPT[Number(digit)]).join('') : `[${label}]`
}

// Footnotes as the app draws its own: a raised mark that links nowhere, and the notes as
// plain dim lines where the reply put them. The engine's markdown would draw them as links,
// and in a reply the mod draws those links lead nowhere. A key the voice writes as `<kbd>` the
// engine's markdown shows as a raw tag, so it becomes inline code, the closest it draws.
export function cite(text: string): string {
  return text.replace(CITED, (_, label: string) => mark(label)).replace(KBD, (_, key: string) => `\`${key}\``)
}
