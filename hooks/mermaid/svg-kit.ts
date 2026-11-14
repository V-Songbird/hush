import { charWidth } from './markdown'
import type { Palette } from './skin'

// What every vector card shares: fonts, text measuring and fitting, escaping, and the
// card shell. Cards have no background of their own: the desktop draws an Svg as an
// image, so the page shows through, and bands are faint tints of the text colour.

export const FONT = `ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Inter, sans-serif`
export const MONO = `ui-monospace, 'Cascadia Code', 'JetBrains Mono', Consolas, monospace`

export const escape = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// Width of a string in pixels, close enough to lay out a card without a renderer.
export function measure(text: string, isMono: boolean, size: number): number {
  if (isMono) {
    return [...text].reduce((sum, char) => sum + charWidth(char), 0) * size * 0.6
  }

  return [...text].reduce((sum, char) => {
    const cells = charWidth(char)

    // Wide East Asian characters (Hangul, kana, Han) and emoji are about one em wide,
    // nearly twice a Latin letter; combining marks and joiners take no room (#66).
    if (cells !== 1) {
      return sum + cells * size * 0.5
    }

    if ('iljtf.,:;|!\'` '.includes(char)) {
      return sum + size * 0.3
    }

    if ('mwMW@%'.includes(char)) {
      return sum + size * 0.82
    }

    return sum + (char >= 'A' && char <= 'Z' ? size * 0.64 : size * 0.54)
  }, 0)
}

export function fitText(text: string, width: number, isMono: boolean, size: number): string {
  if (measure(text, isMono, size) <= width) {
    return text
  }

  // One pass: a width is the sum of its characters', so the cut is where the running sum
  // and the ellipsis no longer fit. Re-measuring the whole text per character dropped was
  // quadratic, and a code card's alt text runs to thousands of characters.
  const chars = [...text]
  const room = width - measure('…', isMono, size)
  let used = 0
  let kept = 0

  for (const char of chars) {
    used += measure(char, isMono, size)

    if (used > room) {
      break
    }

    kept += 1
  }

  return `${chars.slice(0, Math.max(1, kept)).join('')}…`
}

// The room a reply gives a card, from the width the desktop reports in cells of its code
// font, kept to a range a card reads well at. Measured against the desktop's reply column,
// a reported cell is about 7.2px (6.4 drew cards at about 88% of the column). A card drawn
// a little wider than the column is scaled down to fit it, since cards leave their size to
// the markup, so this errs wide rather than leaving the column's right side empty.
const PX_PER_COLUMN = 7.2

export const cardWidth = (columns: number, min = 480, max = 1600): number =>
  Math.round(Math.min(max, Math.max(min, columns * PX_PER_COLUMN)))

const RISE_MS = 450
const FADE_MS = 300
const STAGGER_BUDGET_MS = 360

// Rows that rise in one after another, honouring reduced motion.
export const MOTION = [
  `.rise{opacity:0;animation:rise ${RISE_MS}ms cubic-bezier(.2,.8,.2,1) forwards}`,
  `.card{animation:fade ${FADE_MS}ms ease-out}`,
  '@keyframes rise{from{opacity:0;transform:translateY(5px)}to{opacity:1}}',
  '@keyframes fade{from{opacity:0}to{opacity:1}}',
  '@media (prefers-reduced-motion:reduce){.rise,.card{animation:none;opacity:1}}',
].join('')

// Every entrance at its end state. The desktop draws each new source as a new image and
// plays its animation from the start, so a card drawn again (a reply streaming in, a
// scroll) is drawn settled, or it would fade out and back in on each redraw.
const SETTLED = '.rise,.card,.row,.rule,.fill{animation:none!important;opacity:1!important;stroke-dashoffset:0!important}'

export const settled = (source: string): string => source.replace('</style>', `${SETTLED}</style>`)

export const staggerStep = (count: number, stepMs: number): number => Math.min(stepMs, STAGGER_BUDGET_MS / Math.max(1, count - 1))

export const riseDelay =(index: number, stepMs: number, startMs = 80): string =>
  `style="animation-delay:${Math.round(startMs + index * stepMs)}ms"`

export const staggerEnd = (count: number, stepMs: number, startMs = 80, durationMs = RISE_MS): number =>
  Math.max(FADE_MS, Math.ceil(startMs + Math.max(0, count - 1) * stepMs + durationMs))

export const riseEnd = (source: string): number =>
  Math.max(RISE_MS, ...[...source.matchAll(/animation-delay:(\d+)ms/g)].map(([, delay = '0']) => Number(delay) + RISE_MS))

// Muted ink is the text colour (`currentColor`) at an opacity, set as an attribute: secondary
// text at MUTED, lines, arrowheads and outlines at MUTED_LINE. The values approach the app's
// `text-secondary` against its text ink.
export const MUTED = 0.72
export const MUTED_LINE = 0.6

const RADIUS = 12

// The room a card leaves in its top-right corner for a Copy button laid over it.
export const CONTROL_SLOT = 84

// Where a header's labels centre: the line the Copy button laid over a card sits on,
// one text row down from the card's top edge.
export const HEADER_MID = 29

// The card: a rounded hairline outline, with everything inside clipped to its corners.
export function svgCard(width: number, height: number, palette: Palette, style: string, body: string): string {
  // Unique per size, so cards placed together in one document keep their own corners.
  const clip = `corners-${width}x${height}`

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `<defs><clipPath id="${clip}"><rect width="${width}" height="${height}" rx="${RADIUS}"/></clipPath></defs>`,
    // Sans for text that names no font of its own: a CSS rule on all text would beat the
    // monospace attribute on code, paths and output.
    `<style>text:not([font-family]){font-family:${FONT}}${MOTION}${style}</style>`,
    // Text takes its ink from this attribute, not from a sheet rule, so an element's own
    // `fill` attribute (a muted label, a series colour) still wins over it.
    `<g class="card" fill="${palette.fg}"><g clip-path="url(#${clip})">${body}</g>`,
    `<rect x=".5" y=".5" width="${width - 1}" height="${height - 1}" rx="${RADIUS - 0.5}" fill="none" stroke="${palette.fg}" stroke-opacity=".2"/></g>`,
    `</svg>`,
  ].join('')
}

// A band behind a row, as a faint tint of the text colour, so it reads on any page.
export const tint = (palette: Palette, y: number, width: number, height: number, opacity = 0.05): string =>
  `<rect y="${y}" width="${width}" height="${height}" fill="${palette.fg}" fill-opacity="${opacity}"/>`

// A small rounded label, such as `exit 0` or `new file`, right-aligned at `right`.
export function pill(right: number, y: number, text: string, color: string, palette: Palette): string {
  const width = Math.ceil(measure(text, true, 11) + 16)
  const left = right - width

  return `<rect x="${left}" y="${y}" width="${width}" height="20" rx="10" fill="${color}" fill-opacity=".14"/><text x="${left + width / 2}" y="${y + 14}" text-anchor="middle" font-family="${MONO}" font-size="11" style="fill:${color}">${escape(text)}</text>`
}

export const strokeIcon = (path: string, x: number, y: number, size: number, color: string): string =>
  `<g transform="translate(${x} ${y}) scale(${size / 24})" fill="none" stroke="${color}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${path}</g>`
