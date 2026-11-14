import { HOUR, lengthOf, ticksOf } from './chart-art'
import type { ChartWords, Gantt, Journey, Kanban, Timeline } from './mermaid'
import type { Palette } from './skin'
import { HEADER_H, PAD, seriesColor, text, wrapText } from './svg-chart-kit'
import type { Body } from './svg-chart-kit'
import { fitText, measure, riseDelay } from './svg-kit'

// The planning kinds as card bodies: gantt bars on a time axis, a timeline rail with its
// events as chips, a journey's mood as a curve, a kanban board as panels.

// --- Gantt --------------------------------------------------------------------------

const ROW_H = 28
const BAR_H = 14

export function ganttBody(chart: Gantt, palette: Palette, width: number, words: ChartWords): Body | null {
  const tasks = chart.tasks

  if (tasks.length === 0) {
    return null
  }

  const min = Math.min(...tasks.map(task => task.start))
  const max = Math.max(min + HOUR, ...tasks.map(task => task.end))
  const grouped = tasks.some(task => task.section !== '')
  const labelW = Math.min(200, Math.max(...tasks.map(task => measure(task.label, false, 12.5))) + (grouped ? 12 : 0))
  const x0 = PAD + labelW + 16
  const x1 = width - PAD - 44
  const plot = x1 - x0

  if (plot < 160) {
    return null
  }

  const xOf = (at: number): number => x0 + ((at - min) / (max - min)) * plot
  const sectionOf = (section: string): number => Math.max(0, chart.sections.indexOf(section))
  const top = HEADER_H + PAD + 18
  const parts: string[] = []
  const rows: { y: number; task?: (typeof tasks)[number]; section?: string }[] = []
  let y = top
  let section: string | undefined

  for (const task of tasks) {
    if (grouped && task.section !== section) {
      section = task.section
      rows.push({ y, section })
      y += ROW_H - 4
    }

    rows.push({ y, task })
    y += ROW_H
  }

  const bottom = y

  for (const tick of ticksOf(min, max, Math.floor(plot / 9), words)) {
    const x = xOf(tick.at)
    parts.push(
      `<line x1="${x}" y1="${top - 6}" x2="${x}" y2="${bottom}" stroke="${palette.fg}" stroke-opacity=".08"/>`,
      text(x, top - 12, tick.label, `text-anchor="middle" font-size="10.5" style="fill:${palette.muted}"`),
    )
  }

  rows.forEach((row, i) => {
    if (row.section !== undefined) {
      parts.push(text(PAD, row.y + 16, row.section.toUpperCase(), `font-size="10.5" style="fill:${seriesColor(palette, sectionOf(row.section))};letter-spacing:.08em;font-weight:600"`))
      return
    }

    const task = row.task

    if (task === undefined) {
      return
    }

    const color = task.crit ? palette.err : seriesColor(palette, sectionOf(task.section))
    const mid = row.y + ROW_H / 2
    const label = text(PAD + (grouped ? 12 : 0), mid + 4.5, fitText(task.label, labelW - (grouped ? 12 : 0), false, 12.5), 'font-size="12.5"')

    if (task.milestone) {
      const x = xOf(task.start)
      parts.push(
        `<g class="rise" ${riseDelay(i, 30, 80)}>${label}<path d="M${x} ${mid - 8}L${x + 8} ${mid}L${x} ${mid + 8}L${x - 8} ${mid}Z" fill="${palette.warn}"/></g>`,
      )
      return
    }

    const left = xOf(task.start)
    const w = Math.max(3, xOf(task.end) - left)
    const opacity = task.done ? 0.35 : 0.85
    const ring = task.active ? ` stroke="${color}" stroke-width="1.5" stroke-opacity="1"` : ''

    parts.push(
      `<g class="rise" ${riseDelay(i, 30, 80)}>${label}`,
      `<rect x="${left}" y="${mid - BAR_H / 2}" width="${w}" height="${BAR_H}" rx="4" fill="${color}" fill-opacity="${opacity}"${ring}/>`,
      text(Math.min(left + w + 8, x1 + 6), mid + 4, lengthOf(task.end - task.start, words), `font-size="10.5" style="fill:${palette.muted}"`),
      `</g>`,
    )
  })

  return { body: parts.join(''), height: bottom + PAD - 4 }
}

// --- Timeline -----------------------------------------------------------------------

const CHIP_H = 24
const CHIP_GAP = 8

export function timelineBody(chart: Timeline, palette: Palette, width: number): Body | null {
  const periods = chart.periods

  if (periods.length === 0) {
    return null
  }

  const labelW = Math.min(160, Math.max(...periods.map(period => measure(period.label, false, 13) + 4)))
  const rail = PAD + labelW + 18
  const chipsX = rail + 20
  const room = width - PAD - chipsX

  if (room < 140) {
    return null
  }

  const grouped = periods.some(period => period.section !== '')
  const sectionOf = (section: string): number => Math.max(0, chart.sections.indexOf(section))
  const parts: string[] = []
  const dots: { y: number; color: string }[] = []
  let y = HEADER_H + PAD
  let section: string | undefined

  periods.forEach((period, i) => {
    if (grouped && period.section !== section) {
      section = period.section
      parts.push(text(PAD, y + 12, section.toUpperCase(), `font-size="10.5" style="fill:${seriesColor(palette, sectionOf(section))};letter-spacing:.08em;font-weight:600"`))
      y += 26
    }

    const color = seriesColor(palette, grouped ? sectionOf(period.section) : i)
    const chips: string[] = []
    let x = chipsX
    let line = 0

    for (const event of period.events) {
      const label = fitText(event, room - 20, false, 12)
      const w = measure(label, false, 12) + 20

      if (x > chipsX && x + w > width - PAD) {
        x = chipsX
        line++
      }

      const top = y + line * (CHIP_H + CHIP_GAP)
      chips.push(
        `<rect x="${x}" y="${top}" width="${w}" height="${CHIP_H}" rx="${CHIP_H / 2}" fill="${color}" fill-opacity=".14"/>`,
        text(x + 10, top + 16, label, 'font-size="12"'),
      )
      x += w + CHIP_GAP
    }

    const lines = Math.max(1, line + 1)
    dots.push({ y: y + CHIP_H / 2, color })
    parts.push(
      `<g class="rise" ${riseDelay(i, 50, 80)}>`,
      text(rail - 18, y + 16.5, fitText(period.label, labelW, false, 13), 'text-anchor="end" font-size="13" style="font-weight:600"'),
      ...chips,
      `</g>`,
    )
    y += lines * (CHIP_H + CHIP_GAP) + 10
  })

  const first = dots[0]?.y ?? y
  const last = dots[dots.length - 1]?.y ?? y

  return {
    body: [
      `<line x1="${rail}" y1="${first}" x2="${rail}" y2="${last}" stroke="${palette.fg}" stroke-opacity=".16" stroke-width="2"/>`,
      ...dots.map(dot => `<circle cx="${rail}" cy="${dot.y}" r="5" fill="${dot.color}"/>`),
      ...parts,
    ].join(''),
    height: y + PAD - 18,
  }
}

// --- Journey ------------------------------------------------------------------------

const MOOD_H = 150
const DOT_R = 11

const scoreSlot = (score: number): 'ok' | 'warn' | 'err' => (score >= 4 ? 'ok' : score === 3 ? 'warn' : 'err')

export function journeyBody(chart: Journey, palette: Palette, width: number, words: ChartWords): Body | null {
  const steps = chart.steps
  const x0 = PAD + 28
  const x1 = width - PAD
  const band = (x1 - x0) / Math.max(1, steps.length)

  if (steps.length === 0 || band < 44) {
    return null
  }

  const grouped = steps.some(step => step.section !== '')
  const top = HEADER_H + PAD + (grouped ? 30 : 8)
  const yOf = (score: number): number => top + ((5 - Math.max(1, Math.min(5, score))) / 4) * MOOD_H
  const xOf = (i: number): number => x0 + band * i + band / 2
  const parts: string[] = []

  for (let score = 1; score <= 5; score++) {
    parts.push(
      `<line x1="${x0}" y1="${yOf(score)}" x2="${x1}" y2="${yOf(score)}" stroke="${palette.fg}" stroke-opacity="${score === 3 ? 0.14 : 0.06}"/>`,
      text(PAD, yOf(score) + 4, String(score), `font-size="10.5" style="fill:${palette.muted}"`),
    )
  }

  // Sections as tinted spans over their steps.
  if (grouped) {
    let start = 0

    steps.forEach((step, i) => {
      if (steps[i + 1]?.section === step.section) {
        return
      }

      const color = seriesColor(palette, Math.max(0, chart.sections.indexOf(step.section)))
      const left = x0 + band * start + 2
      const w = band * (i + 1 - start) - 4
      parts.push(
        `<rect x="${left}" y="${HEADER_H + PAD - 4}" width="${w}" height="22" rx="6" fill="${color}" fill-opacity=".14"/>`,
        text(left + w / 2, HEADER_H + PAD + 11, fitText(step.section, w - 12, false, 11.5), `text-anchor="middle" font-size="11.5" style="fill:${color};font-weight:600"`),
      )
      start = i + 1
    })
  }

  // The mood line stops at each dot's ring, so the tinted dots read clean on any page.
  const segments = steps.slice(1).flatMap((step, k) => {
    const x1 = xOf(k)
    const y1 = yOf(steps[k]?.score ?? step.score)
    const x2 = xOf(k + 1)
    const y2 = yOf(step.score)
    const length = Math.hypot(x2 - x1, y2 - y1)

    if (length <= DOT_R * 2) return []
    const dx = ((x2 - x1) / length) * DOT_R
    const dy = ((y2 - y1) / length) * DOT_R

    return [`M${x1 + dx} ${y1 + dy}L${x2 - dx} ${y2 - dy}`]
  })
  parts.push(`<path class="rise" ${riseDelay(0, 0, 160)} d="${segments.join('')}" fill="none" stroke="${palette.fg}" stroke-opacity=".35" stroke-width="2" stroke-linecap="round"/>`)

  const labels = steps.map(step => wrapText(step.label, band - 8, 11.5, 2))
  const labelRows = Math.max(1, ...labels.map(lines => lines.length))

  steps.forEach((step, i) => {
    const color = palette[scoreSlot(step.score)]
    const lines = labels[i] ?? []

    parts.push(
      `<g class="rise" ${riseDelay(i, 40, 120)}>`,
      `<circle cx="${xOf(i)}" cy="${yOf(step.score)}" r="${DOT_R}" fill="${color}" fill-opacity=".2" stroke="${color}" stroke-width="1.5"/>`,
      text(xOf(i), yOf(step.score) + 4, String(step.score), `text-anchor="middle" font-size="11" style="fill:${color};font-weight:700"`),
      ...lines.map((line, k) => text(xOf(i), top + MOOD_H + 26 + k * 15, line, `text-anchor="middle" font-size="11.5"`)),
      `</g>`,
    )
  })

  let height = top + MOOD_H + 26 + 30 + (labelRows - 1) * 15

  if (chart.actors.length > 0) {
    parts.push(text(x0, height + 4, fitText(words.with(chart.actors.join(', ')), x1 - x0, false, 11.5), `font-size="11.5" style="fill:${palette.muted}"`))
    height += 20
  }

  return { body: parts.join(''), height: height + PAD - 10 }
}

// --- Kanban -------------------------------------------------------------------------

const PANEL_MIN = 160
const PANEL_GAP = 12
const CARD_PAD = 10
const LINE_H = 16

const prioritySlot = (priority: string): 'err' | 'warn' | 'ok' | 'muted' => {
  const level = priority.toLowerCase()

  return /very high|high|critical/.test(level) ? 'err' : /medium/.test(level) ? 'warn' : /low/.test(level) ? 'ok' : 'muted'
}

export function kanbanBody(chart: Kanban, palette: Palette, width: number, words: ChartWords): Body | null {
  const columns = chart.columns

  if (columns.length === 0) {
    return null
  }

  const avail = width - PAD * 2
  const across = Math.max(1, Math.min(columns.length, Math.floor((avail + PANEL_GAP) / (PANEL_MIN + PANEL_GAP))))
  const panelW = (avail - PANEL_GAP * (across - 1)) / across
  const textW = panelW - CARD_PAD * 2 - 16
  const parts: string[] = []
  let rowTop = HEADER_H + PAD

  for (let start = 0; start < columns.length; start += across) {
    const panels = columns.slice(start, start + across).map((column, k) => {
      const i = start + k
      const color = seriesColor(palette, i)
      const x = PAD + k * (panelW + PANEL_GAP)
      const inner: string[] = []
      let y = rowTop + 40

      for (const card of column.cards) {
        const lines = wrapText(card.label, textW, 12.5, 3)
        const meta = [card.assigned === '' ? '' : `@${card.assigned}`, card.ticket].filter(part => part !== '').join('  ·  ')
        const hasMeta = meta !== '' || card.priority !== ''
        const h = CARD_PAD * 2 + lines.length * LINE_H + (hasMeta ? LINE_H + 2 : 0) - 2

        inner.push(
          `<rect x="${x + 8}" y="${y}" width="${panelW - 16}" height="${h}" rx="7" fill="${palette.fg}" fill-opacity=".06"/>`,
          `<rect x="${x + 8}" y="${y + 6}" width="3" height="${h - 12}" rx="1.5" fill="${color}"/>`,
          ...lines.map((line, n) => text(x + 8 + CARD_PAD + 6, y + CARD_PAD + 11 + n * LINE_H, line, 'font-size="12.5"')),
        )

        if (hasMeta) {
          const metaY = y + CARD_PAD + 11 + lines.length * LINE_H + 2
          const priorityW = card.priority === '' ? 0 : measure(card.priority, false, 10.5) + 12
          const slot = prioritySlot(card.priority)
          const priorityColor = slot === 'muted' ? palette.muted : palette[slot]

          if (card.priority !== '') {
            inner.push(text(x + 8 + CARD_PAD + 6, metaY, card.priority, `font-size="10.5" style="fill:${priorityColor};font-weight:600"`))
          }

          inner.push(text(x + 8 + CARD_PAD + 6 + priorityW, metaY, fitText(meta, textW - priorityW, false, 10.5), `font-size="10.5" style="fill:${palette.muted}"`))
        }

        y += h + 8
      }

      if (column.cards.length === 0) {
        inner.push(text(x + 16, y + 14, words.empty,`font-size="11.5" style="fill:${palette.muted};font-style:italic"`))
        y += 26
      }

      return { x, i, color, column, inner, bottom: y }
    })

    const bottom = Math.max(...panels.map(panel => panel.bottom)) + 4

    for (const panel of panels) {
      const count = String(panel.column.cards.length)
      const countW = measure(count, false, 11) + 14

      parts.push(
        `<g class="rise" ${riseDelay(panel.i, 60, 80)}>`,
        `<rect x="${panel.x}" y="${rowTop}" width="${panelW}" height="${bottom - rowTop}" rx="10" fill="${palette.fg}" fill-opacity=".035" stroke="${palette.fg}" stroke-opacity=".08"/>`,
        `<circle cx="${panel.x + 16}" cy="${rowTop + 20}" r="4" fill="${panel.color}"/>`,
        text(panel.x + 28, rowTop + 24.5, fitText(panel.column.label, panelW - 44 - countW, false, 13), 'font-size="13" style="font-weight:600"'),
        `<rect x="${panel.x + panelW - 10 - countW}" y="${rowTop + 11}" width="${countW}" height="18" rx="9" fill="${panel.color}" fill-opacity=".16"/>`,
        text(panel.x + panelW - 10 - countW / 2, rowTop + 24, count, `text-anchor="middle" font-size="11" style="fill:${panel.color};font-weight:600"`),
        ...panel.inner,
        `</g>`,
      )
    }

    rowTop = bottom + PANEL_GAP
  }

  return { body: parts.join(''), height: rowTop - PANEL_GAP + PAD }
}
