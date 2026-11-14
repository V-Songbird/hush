// Finds the tables and fenced code in a reply so they can be drawn as cards; the rest
// stays markdown.

export type Align = 'left' | 'right' | 'center'

export type Table = { kind: 'table'; header: string[]; align: Align[]; rows: string[][] }

// `raw` is the fence as written, for the surfaces that keep Claude Code's own drawing.
export type Code = { kind: 'code'; lang: string; code: string; raw: string }

// `tex` is the formula alone; `raw` the block as written, kept for the copy button.
export type Math = { kind: 'math'; tex: string; raw: string }

export type Segment = { kind: 'text'; text: string } | Table | Code | Math

// Fences the desktop marks runnable with a Run button of its own. A card is an image and
// cannot carry it, so these keep Claude Code's drawing there.
const SHELLS = new Set(['bash', 'sh', 'shell', 'zsh', 'fish', 'console', 'powershell', 'pwsh', 'ps1', 'cmd', 'bat'])

export const isShell = (segment: Segment): boolean => segment.kind === 'code' && SHELLS.has(segment.lang)

const SEPARATOR = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/
const FENCE = /^\s*(```|~~~)\s*([\w+#.-]*)/

// Claude Code's own drawing keeps a line break the model wrote; the engine's Markdown
// reads a lone newline as a soft break and runs the two lines together. The two spaces
// that make it a hard break go on every line a paragraph carries on, so markdown the skin
// hands back keeps the shape it was written in. A line in a fence is left alone, where the
// spaces would be part of the code, and a line that already ends in a break keeps it.
export function hardBreaks(markdown: string): string {
  const lines = markdown.split('\n')
  let inFence = false

  return lines
    .map((line, i) => {
      if (FENCE.test(line)) {
        inFence = !inFence

        return line
      }

      // A blank line on either side already parts the two, and so does the end of the text.
      const parted = line.trim() === '' || (lines[i + 1] ?? '').trim() === ''

      return inFence || parted || / {2}$/.test(line) || line.endsWith('\\') ? line : `${line}  `
    })
    .join('\n')
}

// Inline emphasis and code ticks read as noise in a padded cell.
const clean = (cell: string): string =>
  cell.replace(/\*\*|__|`/g, '').replace(/\\\|/g, '|').trim()

export function cellsOf(line: string): string[] {
  const inner = line.trim().replace(/^\|/, '').replace(/(?<!\\)\|$/, '')

  return inner.split(/(?<!\\)\|/).map(clean)
}

const alignOf = (cell: string): Align => {
  const spec = cell.trim()

  if (spec.startsWith(':') && spec.endsWith(':')) {
    return 'center'
  }

  return spec.endsWith(':') ? 'right' : 'left'
}

const fit = (cells: string[], width: number): string[] =>
  Array.from({ length: width }, (_, i) => cells[i] ?? '')

// `tables` off leaves tables as text; a fence `fence` turns down stays text too, so a
// reply can be split for its charts alone. `math` takes display formulas out as their own
// segments: ````math`` fences, `$$…$$` and `\[…\]`.
export type SplitOptions = { tables: boolean; fence: (lang: string, code: string) => boolean; math?: boolean }

const SPLIT_ALL: SplitOptions = { tables: true, fence: () => true }

export function splitReply(markdown: string, options: SplitOptions = SPLIT_ALL): Segment[] {
  const lines = markdown.split('\n')
  const segments: Segment[] = []
  let text: string[] = []
  let inFence = false

  const flush = () => {
    if (text.join('\n').trim() !== '') {
      segments.push({ kind: 'text', text: text.join('\n') })
    }

    text = []
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? ''
    const next = lines[i + 1] ?? ''

    const fence = FENCE.exec(line)

    if (options.math === true && !inFence) {
      const formula = displayMath(lines, i, fence)

      if (formula !== null) {
        flush()
        segments.push({ kind: 'math', tex: formula.tex, raw: lines.slice(i, formula.end + 1).join('\n') })
        i = formula.end
        continue
      }
    }

    // A closed fence becomes a code segment; one still streaming stays text.
    if (fence !== null && !inFence) {
      const close = lines.findIndex((other, j) => j > i && FENCE.test(other) && other.trim().replace(/[`~]/g, '') === '')

      if (close !== -1) {
        const lang = (fence[2] ?? '').toLowerCase()
        const code = lines.slice(i + 1, close).join('\n')

        if (!options.fence(lang, code)) {
          text.push(...lines.slice(i, close + 1))
          i = close
          continue
        }

        flush()
        segments.push({ kind: 'code', lang, code, raw: lines.slice(i, close + 1).join('\n') })
        i = close
        continue
      }

      inFence = true
    } else if (fence !== null) {
      inFence = false
    }

    const header = cellsOf(line)
    const isTable =
      options.tables &&
      !inFence &&
      line.includes('|') &&
      SEPARATOR.test(next) &&
      header.length > 1 &&
      cellsOf(next).length === header.length

    if (!isTable) {
      text.push(line)
      continue
    }

    flush()

    const rows: string[][] = []
    i += 2

    while (i < lines.length && (lines[i] ?? '').includes('|') && (lines[i] ?? '').trim() !== '') {
      rows.push(fit(cellsOf(lines[i] ?? ''), header.length))
      i++
    }

    i--
    segments.push({ kind: 'table', header, align: cellsOf(next).map(alignOf), rows })
  }

  flush()

  return segments
}

const DISPLAY_OPEN = /^\s*(\$\$|\\\[)(.*)$/

// A display formula starting on line `i`: where it ends and the TeX inside. One still
// streaming (no closing delimiter yet) is not one, so it stays text until it closes.
function displayMath(lines: readonly string[], i: number, fence: RegExpExecArray | null): { tex: string; end: number } | null {
  const line = lines[i] ?? ''

  if (fence !== null) {
    if ((fence[2] ?? '').toLowerCase() !== 'math') {
      return null
    }

    const close = lines.findIndex((other, j) => j > i && FENCE.test(other) && other.trim().replace(/[`~]/g, '') === '')

    return close === -1 ? null : { tex: lines.slice(i + 1, close).join('\n'), end: close }
  }

  const open = DISPLAY_OPEN.exec(line)

  if (open === null) {
    return null
  }

  const closer = open[1] === '$$' ? '$$' : '\\]'
  const rest = open[2] ?? ''
  const sameLine = rest.indexOf(closer)

  // Whole on one line, ` x `, with nothing but space after it.
  if (sameLine !== -1) {
    const tex = rest.slice(0, sameLine)

    return rest.slice(sameLine + closer.length).trim() === '' && tex.trim() !== '' ? { tex, end: i } : null
  }

  for (let j = i + 1; j < lines.length; j++) {
    const other = lines[j] ?? ''
    const at = other.indexOf(closer)

    if (at !== -1) {
      if (other.slice(at + closer.length).trim() !== '') {
        return null
      }

      const tex = [rest, ...lines.slice(i + 1, j), other.slice(0, at)].join('\n')

      return tex.trim() === '' ? null : { tex, end: j }
    }

    // A blank line ends a paragraph, and a formula with it.
    if (other.trim() === '') {
      return null
    }
  }

  return null
}

// Terminal cells a character takes: wide East Asian characters and emoji take two,
// combining marks, zero-width joiners and skin-tone modifiers none.
const WIDE: readonly (readonly [number, number])[] = [
  [0x1100, 0x115f],
  [0x2e80, 0x303e],
  [0x3041, 0x33ff],
  [0x3400, 0x4dbf],
  [0x4e00, 0x9fff],
  [0xa000, 0xa4cf],
  [0xa960, 0xa97f],
  [0xac00, 0xd7a3],
  [0xf900, 0xfaff],
  [0xfe10, 0xfe19],
  [0xfe30, 0xfe6f],
  [0xff00, 0xff60],
  [0xffe0, 0xffe6],
  [0x1f300, 0x1f64f],
  [0x1f680, 0x1f6ff],
  [0x1f900, 0x1f9ff],
  [0x1fa70, 0x1faff],
  [0x20000, 0x3fffd],
]

export const charWidth = (char: string): number => {
  const code = char.codePointAt(0) ?? 0

  if (/\p{Mn}|\p{Me}|\u200d|[\ufe00-\ufe0f]|\p{Emoji_Modifier}/u.test(char)) {
    return 0
  }

  return WIDE.some(([from, to]) => code >= from && code <= to) ? 2 : 1
}

export const widthOf = (text: string): number => [...text].reduce((sum, char) => sum + charWidth(char), 0)

// `text` cut to `width` cells, marked with an ellipsis where it lost text.
const cutTo = (text: string, width: number): string => {
  if (widthOf(text) <= width) {
    return text
  }

  let kept = ''
  let used = 0

  for (const char of text) {
    const next = charWidth(char)

    if (used + next > width - 1) {
      break
    }

    kept += char
    used += next
  }

  return `${kept}…`
}

// Natural column widths, narrowed from the widest down until the table fits.
export function columnWidths(table: Table, maxWidth: number, gap: number): number[] {
  const widths = table.header.map((cell, col) =>
    Math.max(widthOf(cell), ...table.rows.map(row => widthOf(row[col] ?? ''))),
  )
  const budget = maxWidth - gap * (widths.length - 1)

  while (widths.reduce((sum, width) => sum + width, 0) > budget) {
    const widest = widths.indexOf(Math.max(...widths))

    if ((widths[widest] ?? 0) <= 3) {
      break
    }

    widths[widest] = (widths[widest] ?? 0) - 1
  }

  return widths
}

// A cell cut to its column, marked with an ellipsis where it lost text.
export function cutCell(text: string, width: number): string {
  return cutTo(text, width)
}

// Splits a word too long for its column into pieces that each fit.
function breakWord(word: string, width: number, measure: (text: string) => number): string[] {
  const pieces: string[] = []
  let piece = ''

  for (const char of word) {
    if (piece !== '' && measure(piece + char) > width) {
      pieces.push(piece)
      piece = char
    } else {
      piece += char
    }
  }

  return piece === '' ? pieces : [...pieces, piece]
}

// `text` as lines that fit `width`; past `maxLines`, the last line ends in `…`. `measure`
// is terminal cells by default; the desktop card passes its pixel measure.
export function wrapLines(text: string, width: number, maxLines: number, measure: (text: string) => number = widthOf): string[] {
  const lines: string[] = []
  let line = ''

  for (const word of text.split(/\s+/).filter(Boolean)) {
    const candidate = line === '' ? word : `${line} ${word}`

    if (measure(candidate) <= width) {
      line = candidate
      continue
    }

    if (line !== '') {
      lines.push(line)
    }

    const pieces = measure(word) <= width ? [word] : breakWord(word, width, measure)
    lines.push(...pieces.slice(0, -1))
    line = pieces.at(-1) ?? ''
  }

  const all = line === '' ? lines : [...lines, line]

  if (all.length <= maxLines) {
    return all.length === 0 ? [''] : all
  }

  const kept = all.slice(0, maxLines)
  const chars = [...(kept[maxLines - 1] ?? '')]

  while (chars.length > 0 && measure(`${chars.join('')}…`) > width) {
    chars.pop()
  }

  return [...kept.slice(0, -1), `${chars.join('')}…`]
}

export function padCell(text: string, width: number, align: Align): string {
  const cut = cutTo(text, width)
  const room = width - widthOf(cut)

  if (align === 'right') {
    return ' '.repeat(room) + cut
  }

  if (align === 'center') {
    const left = Math.floor(room / 2)

    return ' '.repeat(left) + cut + ' '.repeat(room - left)
  }

  return cut + ' '.repeat(room)
}

// What `/skin copy` puts on the clipboard: the whole reply, or with `code` its last code
// block; a message instead when there is nothing to copy.
export function copyOf(reply: string, code: boolean): { text: string } | { message: string } {
  if (reply.trim() === '') {
    return { message: 'Nothing to copy yet' }
  }

  if (!code) {
    return { text: reply }
  }

  const last = splitReply(reply).findLast((segment): segment is Code => segment.kind === 'code')

  return last === undefined ? { message: 'No code block in the last reply' } : { text: last.code }
}

// A table as it is drawn, boxed in monospace, for pasting where markdown does not render.
export function tableArt(table: Table): string {
  const widths = table.header.map((cell, col) => Math.max(widthOf(cell), ...table.rows.map(row => widthOf(row[col] ?? ''))))
  const rule = (left: string, mid: string, right: string) => `${left}${widths.map(width => '─'.repeat(width + 2)).join(mid)}${right}`
  const row = (cells: readonly string[]) => `│${widths.map((width, col) => ` ${padCell(cells[col] ?? '', width, table.align[col] ?? 'left')} `).join('│')}│`

  return [rule('╭', '┬', '╮'), row(table.header), rule('├', '┼', '┤'), ...table.rows.map(row), rule('╰', '┴', '╯')].join('\n')
}
