// The reading every Mermaid parser here shares: statements, quoted labels, number lists,
// and the frontmatter block a diagram may open with.

// Lines that carry no meaning for the drawing, kept out of the statement list.
export const IGNORED = /^(%%|classDef\s|class\s|style\s|linkStyle\s|click\s|accTitle|accDescr)/

export const unquote = (text: string): string =>
  text
    .trim()
    .replace(/^"(.*)"$/s, '$1')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()

export function statementsOf(body: readonly string[]): string[] {
  return body
    .flatMap(line => line.split(';'))
    .map(line => line.trim())
    .filter(line => line !== '' && !IGNORED.test(line))
}

// The source lines with blank and comment lines kept but trailing whitespace off, for
// the kinds whose meaning lives in indentation.
export const linesOf = (body: readonly string[]): string[] =>
  body.map(line => line.replace(/\s+$/, '')).filter(line => line.trim() !== '' && !IGNORED.test(line.trim()))

export const NUMBER = /^-?\d+(?:\.\d+)?$/

export function numbersOf(list: string): number[] | null {
  const values = list
    .split(',')
    .map(value => value.trim())
    .filter(value => value !== '')

  return values.every(value => NUMBER.test(value)) ? values.map(Number) : null
}

export const listOf = (list: string): string[] =>
  list
    .split(',')
    .map(unquote)
    .filter(item => item !== '')

// `---\ntitle: x\n---` before the header: its title, and the source without it.
export function frontmatterOf(source: string): { title: string; lines: string[] } {
  const lines = source.replace(/\r/g, '').split('\n')
  const start = lines.findIndex(line => line.trim() !== '')

  if (lines[start]?.trim() !== '---') {
    return { title: '', lines }
  }

  const end = lines.findIndex((line, i) => i > start && line.trim() === '---')

  if (end === -1) {
    return { title: '', lines }
  }

  const titled = lines.slice(start + 1, end).map(line => /^\s*title\s*:\s*(.*)$/.exec(line)?.[1]).find(title => title !== undefined)

  return { title: unquote(titled ?? ''), lines: lines.slice(end + 1) }
}
