import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderElement, RenderInput, ThemeKey } from 'claude-code'

import { hardBreaks } from './mermaid/markdown'
import type { Chart, ChartWords } from './mermaid/mermaid'
import type { Palette } from './mermaid/skin'
import { chartSvg } from './mermaid/svg-chart'
import { cardWidth } from './mermaid/svg-kit'
import { EMPTY, SECTION_ALERTS, lintMessage, localLinks, report, settingsOf, tally, upgrade, usesForms } from './lint'
import type { ReportWords, Tally } from './lint'
import { foldOf, headOf, isReprompt, labelOf, placeOf } from './fold'
import type { Fold, FoldWords, Stored } from './fold'
import { octicon } from './octicons'
import { cite, splitReply } from './reply'
import type { AlertType } from './reply'
import { DESKTOP_SECTION, teachesDesktop } from './voice'

// Hush's mod, optional: the command hooks in hooks.json are the product and never depend on it.
// On the desktop app, it draws a reply's Mermaid fences as pictures and its GitHub alerts as
// coloured boxes, and folds the progress texts before each final message (`fold.ts`). A reply
// with neither form is left to the app whole, and every other surface, the terminal included,
// is never touched. On every surface, it checks each final message against the voice's
// countable rules and keeps the totals (`lint.ts`). HUSH_DISABLE=1 turns all of it off.

/** What the mod says, by language. English is the complete base. */
export const EN = {
  command: 'How often Hush final messages kept the voice rules',
  notComposed: 'The last Hush prompt has not been composed yet.',
  carried: 'The last Hush prompt carried the desktop section.',
  notCarried: 'The last Hush prompt did not carry the desktop section.',
  withSection: 'With the desktop section',
  withoutSection: 'Without it',
  // An alert's icon alt text: the app's banner shows the icon and no title.
  alerts: { note: 'Note', tip: 'Tip', important: 'Important', warning: 'Warning', caution: 'Caution' } as Record<AlertType, string>,
  fold: {
    show: n => `Show ${n} ${n === 1 ? 'progress message' : 'progress messages'}`,
    hide: n => `Hide ${n} ${n === 1 ? 'progress message' : 'progress messages'}`,
    failed: n => `${n} failed`,
    warnings: n => `${n} ${n === 1 ? 'warning' : 'warnings'}`,
  } as FoldWords,
  report: {
    none: title => `${title}: none checked yet.`,
    summary: (title, n) =>
      `${title}: ${n.messages} checked, ${n.mermaid} with mermaid and ${n.alert} with an alert among the last ${n.recent}. Average ${n.words} words outside code, ${n.tokens} output tokens per turn.`,
    rule: 'Rule',
    passed: 'Passed',
    rules: {
      'result first': 'result first',
      'rules where set': 'rules where set',
      'next step where set': 'next step where set',
      'sentences within limit': 'sentences within limit',
      'blocks within limit': 'blocks within limit',
      'words within limit': 'words within limit',
      'no raw html': 'no raw html',
      'links resolve': 'links resolve',
      'alerts within limit': 'alerts within limit',
      'alerts apart': 'alerts apart',
      'alert types allowed': 'alert types allowed',
      'alerts hold a risk (proxy)': 'alerts hold a risk (proxy)',
      'next stands alone (proxy)': 'next stands alone (proxy)',
    },
  } as ReportWords,
  // A chart card's header, legend, tooltips and alt text (`mermaid/`).
  chart: {
    kinds: {
      flow: 'Flowchart',
      xy: 'Chart',
      pie: 'Pie',
      gantt: 'Gantt',
      timeline: 'Timeline',
      journey: 'Journey',
      kanban: 'Kanban',
      mindmap: 'Mindmap',
      quadrant: 'Quadrant',
      radar: 'Radar',
      sankey: 'Sankey',
      git: 'Git graph',
      treemap: 'Treemap',
      packet: 'Packet',
      block: 'Block diagram',
      architecture: 'Architecture',
    },
    c4Levels: { Context: 'C4 context', Container: 'C4 container', Component: 'C4 component', Dynamic: 'C4 dynamic', Deployment: 'C4 deployment' },
    units: {
      step: ['step', 'steps'],
      point: ['point', 'points'],
      series: ['series', 'series'],
      slice: ['slice', 'slices'],
      task: ['task', 'tasks'],
      period: ['period', 'periods'],
      card: ['card', 'cards'],
      node: ['node', 'nodes'],
      curve: ['curve', 'curves'],
      flow: ['flow', 'flows'],
      commit: ['commit', 'commits'],
      item: ['item', 'items'],
      bit: ['bit', 'bits'],
      block: ['block', 'blocks'],
      service: ['service', 'services'],
      element: ['element', 'elements'],
    },
    series: { bar: 'bar', line: 'line' },
    total: 'total',
    empty: 'empty',
    with: names => `with ${names}`,
    span: (start, end) => `${start} to ${end}`,
    done: 'done',
    active: 'active',
    months: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
    day: (month, day) => `${month} ${day}`,
    durations: { day: 'd', hour: 'h', minute: 'm' },
    merge: from => `merge ${from}`,
    cherryPick: from => `cherry-pick ${from}`,
    c4Kind: (base, store, isExternal) => {
      const kind = `${isExternal ? 'external ' : ''}${base}${store === null ? '' : ` ${store}`}`

      return kind.charAt(0).toUpperCase() + kind.slice(1)
    },
    boundaries: { enterprise: 'enterprise', system: 'system', container: 'container' },
  } as ChartWords,
}
export const ES: typeof EN = {
  command: 'Con qué frecuencia los mensajes finales de Hush cumplieron las reglas de la voz',
  notComposed: 'El último prompt de Hush aún no se ha compuesto.',
  carried: 'El último prompt de Hush llevó la sección de escritorio.',
  notCarried: 'El último prompt de Hush no llevó la sección de escritorio.',
  withSection: 'Con la sección de escritorio',
  withoutSection: 'Sin ella',
  alerts: { note: 'Nota', tip: 'Consejo', important: 'Importante', warning: 'Advertencia', caution: 'Precaución' },
  fold: {
    show: n => `Ver ${n} ${n === 1 ? 'mensaje de avance' : 'mensajes de avance'}`,
    hide: n => `Ocultar ${n} ${n === 1 ? 'mensaje de avance' : 'mensajes de avance'}`,
    failed: n => `${n} ${n === 1 ? 'falló' : 'fallaron'}`,
    warnings: n => `${n} ${n === 1 ? 'aviso' : 'avisos'}`,
  },
  report: {
    none: title => `${title}: ninguno revisado aún.`,
    summary: (title, n) =>
      `${title}: ${n.messages} revisados, ${n.mermaid} con mermaid y ${n.alert} con una alerta entre los últimos ${n.recent}. En promedio, ${n.words} palabras fuera del código y ${n.tokens} tokens de salida por turno.`,
    rule: 'Regla',
    passed: 'Cumple',
    rules: {
      'result first': 'resultado primero',
      'rules where set': 'separadores donde se piden',
      'next step where set': 'siguiente paso donde se pide',
      'sentences within limit': 'oraciones dentro del límite',
      'blocks within limit': 'bloques dentro del límite',
      'words within limit': 'palabras dentro del límite',
      'no raw html': 'sin html crudo',
      'links resolve': 'los enlaces existen',
      'alerts within limit': 'alertas dentro del límite',
      'alerts apart': 'alertas separadas',
      'alert types allowed': 'tipos de alerta permitidos',
      'alerts hold a risk (proxy)': 'las alertas llevan un riesgo (aproximado)',
      'next stands alone (proxy)': 'el siguiente paso se entiende solo (aproximado)',
    },
  },
  chart: {
    kinds: {
      flow: 'Diagrama de flujo',
      xy: 'Gráfico',
      pie: 'Gráfico circular',
      gantt: 'Gantt',
      timeline: 'Cronología',
      journey: 'Recorrido',
      kanban: 'Kanban',
      mindmap: 'Mapa mental',
      quadrant: 'Cuadrantes',
      radar: 'Radar',
      sankey: 'Sankey',
      git: 'Grafo de git',
      treemap: 'Mapa de árbol',
      packet: 'Paquete',
      block: 'Diagrama de bloques',
      architecture: 'Arquitectura',
    },
    c4Levels: { Context: 'C4 de contexto', Container: 'C4 de contenedores', Component: 'C4 de componentes', Dynamic: 'C4 dinámico', Deployment: 'C4 de despliegue' },
    units: {
      step: ['paso', 'pasos'],
      point: ['punto', 'puntos'],
      series: ['serie', 'series'],
      slice: ['sector', 'sectores'],
      task: ['tarea', 'tareas'],
      period: ['periodo', 'periodos'],
      card: ['tarjeta', 'tarjetas'],
      node: ['nodo', 'nodos'],
      curve: ['curva', 'curvas'],
      flow: ['flujo', 'flujos'],
      commit: ['commit', 'commits'],
      item: ['elemento', 'elementos'],
      bit: ['bit', 'bits'],
      block: ['bloque', 'bloques'],
      service: ['servicio', 'servicios'],
      element: ['elemento', 'elementos'],
    },
    series: { bar: 'barras', line: 'línea' },
    total: 'total',
    empty: 'sin elementos',
    with: names => `con ${names}`,
    span: (start, end) => `del ${start} al ${end}`,
    done: 'terminada',
    active: 'en curso',
    months: ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sept', 'oct', 'nov', 'dic'],
    day: (month, day) => `${day} ${month}`,
    durations: { day: 'd', hour: 'h', minute: 'min' },
    merge: from => `fusión de ${from}`,
    cherryPick: from => `cherry-pick de ${from}`,
    c4Kind: (base, store, isExternal) => {
      const kind = { person: 'Persona', system: 'Sistema', container: 'Contenedor', component: 'Componente' }[base]
      const stored = store === null ? '' : ` de ${store === 'database' ? 'base de datos' : 'cola'}`

      return `${kind}${stored}${isExternal ? (base === 'person' ? ' externa' : ' externo') : ''}`
    },
    boundaries: { enterprise: 'empresa', system: 'sistema', container: 'contenedor' },
  },
}

/** Whether Claude Code's `language` setting, free text such as "Español", "Spanish" or "es-MX", names Spanish. */
export const isSpanish = (v: unknown): boolean => {
  if (typeof v !== 'string') return false
  const t = v.trim().toLowerCase()
  return /^es(?:$|[-_])/.test(t) || ['en', 'es'].some(d => t.startsWith(new Intl.DisplayNames([d], { type: 'language' }).of('es')!.toLowerCase()))
}

/** The mod's strings for the `language` setting; English when it is unset, unknown or unreadable. */
async function stringsOf($: EngineInterface): Promise<typeof EN> {
  try {
    return isSpanish(await $.settings.read({ key: 'language' })) ? ES : EN
  } catch {
    return EN
  }
}

/** HUSH_DISABLE=1, read as `hooks/lib/gate.js` reads it: the product-wide off switch stops the mod too. */
async function isDisabled($: EngineInterface): Promise<boolean> {
  try {
    return (await $.env.get('HUSH_DISABLE'))?.trim() === '1'
  } catch {
    return false
  }
}

// What the store holds, or a fresh tally when it holds nothing this version wrote.
const asTally = (value: unknown): Tally =>
  typeof value === 'object' && value !== null && typeof (value as Tally).messages === 'number' ? upgrade(value as Tally) : EMPTY

// Text and neutral marks take `currentColor`: the desktop passes its text ink into the
// picture, so they follow the person's theme and any look with no copied value. Muted ink is
// that colour at an opacity, set as an attribute where it is drawn. Series have no theme key,
// so they copy the app's `chart-categorical-1..8` tokens (app 4.4212, read 2026-11-02), once
// per theme: a picture cannot read the page's CSS variables.
export const LIGHT: Palette = {
  user: '#2a78d6',
  read: '#eb6834',
  ok: '#1baf7a',
  warn: '#eda100',
  web: '#6250d6',
  mcp: '#008300',
  search: '#e87ba4',
  err: '#e34948',
  fg: 'currentColor',
  muted: 'currentColor',
}

export const DARK: Palette = {
  user: '#3987e5',
  read: '#d95926',
  ok: '#199e70',
  warn: '#c98500',
  web: '#9085e9',
  mcp: '#008300',
  search: '#d55181',
  err: '#e66767',
  fg: 'currentColor',
  muted: 'currentColor',
}

// The app's banner (`shared-frame` in app 4.4212) draws an icon and no title text, so the
// title is only the icon's alt text, in the catalogs above. Theme keys, so an alert's border and icon take the person's theme as the app's own marks
// do: the desktop maps them to `text-accent`, `text-success`, `text-pro`, `text-warning`
// and `text-danger`. Important takes `autoAccept`'s `text-pro`, not `merged`, whose light
// purple measured 3.46:1 on the page. The box has no fill: no theme key gives a see-through
// tint, and a raw one would not follow the person's theme. `light` and `dark` are those text
// tokens' values, for the icon: an Svg takes no theme key, and the engine refuses one inside a
// Text ("Svg inside an inline element"), so the key cannot reach it.
const ALERTS: Record<AlertType, { color: ThemeKey; light: string; dark: string }> = {
  note: { color: 'suggestion', light: '#184f95', dark: '#6da7ec' },
  tip: { color: 'success', light: '#006300', dark: '#0ca30c' },
  important: { color: 'autoAccept', light: '#4a3aa7', dark: '#a096eb' },
  warning: { color: 'warning', light: '#734500', dark: '#db9300' },
  caution: { color: 'error', light: '#8e2626', dark: '#ec7e7e' },
}

// The alerts drawn as a plain line led by their icon, with no box.
const QUIET: ReadonlySet<AlertType> = new Set(['note', 'tip'])

// One picture for both themes: the light and the dark drawing, each shown only where the
// page's colour scheme matches, so the card follows the app without asking for its theme.
// Null when the chart is too crowded for the width.
export function themedChart(chart: Chart, width: number, words: ChartWords): { source: string; alt: string } | null {
  const light = chartSvg(chart, LIGHT, width, words)
  const dark = chartSvg(chart, DARK, width, words)

  if (light === null || dark === null) {
    return null
  }

  // Each drawing's ids, an arrowhead's and the corners', are scoped, so neither drawing takes
  // the other's.
  const scoped = (source: string, scope: string) =>
    source
      .replaceAll('id="', `id="${scope}-`)
      .replaceAll('url(#', `url(#${scope}-`)
  const style = '@media (prefers-color-scheme:dark){.hl{display:none}}@media not (prefers-color-scheme:dark){.hd{display:none}}'

  return {
    source: `<svg xmlns="http://www.w3.org/2000/svg" width="${light.width}" height="${light.height}" viewBox="0 0 ${light.width} ${light.height}"><style>${style}</style><g class="hl">${scoped(light.source, 'hl')}</g><g class="hd">${scoped(dark.source, 'hd')}</g></svg>`,
    alt: light.alt,
  }
}

// Two tallies, so the desktop section can be judged against the voice without it: one for
// turns whose prompt carried the section, one for the rest (the older tally's key).
const TALLY = 'lint-tally'
const TALLY_SECTION = 'lint-tally-desktop'

// Whether the last Hush prompt composed carried the section. Only a Hush-styled prompt sets
// it, so a subagent's prompt, which has no output style, does not overwrite the main turn's.
// It lives in the store, not in a module variable: the mod reloads between a turn's prompt
// and its end, and a variable would start over (seen live, 2026-11-03).
const LAST_COMPOSE = 'lint-last-compose'

// The settings /hush:config saved, read each turn since the reader may change them mid-session;
// the same file and override Hush's `style-settings.js` reads. Nothing readable is the defaults.
async function hushConfig($: EngineInterface): Promise<unknown> {
  try {
    const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME'))
    const file = (await $.env.get('HUSH_CONFIG_FILE')) ?? `${home}/.claude/hush/config.json`

    return JSON.parse(await $.fs.read(file))
  } catch {
    return undefined
  }
}

// The final-only view (`fold.ts`). The reply being written: what the conversation stored for it,
// in order. Module variables: a hot reload mid-reply loses that reply's fold, never a fold
// already made, which lives in `$.state` and the store.
const folds = atom({ plugin: 'hush', key: 'folds' } as const, [], { shape: 'folds-2' })
const opened = atom({ plugin: 'hush', key: 'open' } as const, [], { shape: 'open-1' })
const FOLDS_KEPT = 300
let isReplying = false
let stored: Stored = { items: [], texts: [], errors: 0 }

function startReply() {
  stored = { items: [], texts: [], errors: 0 }
}

/** The reply stopped: fold what came before its final message, keep it past a reload. */
async function closeReply($: EngineInterface) {
  const fold = foldOf(stored)
  startReply()

  if (fold !== null) {
    const all = await update($, folds, list => [...list, fold].slice(-FOLDS_KEPT))
    await $.store.set(`folds-2:${await $.session.id()}`, all)
  }
}

/** The fold a row belongs to, read while drawing so a new fold or a press draws it again. */
async function foldAt($: EngineInterface, row: Parameters<typeof placeOf>[1]) {
  // The newest fold wins: a text repeated in a later reply belongs to that reply.
  const all = await read($, folds)

  for (let i = all.length - 1; i >= 0; i--) {
    const fold = all[i]!
    const place = placeOf(fold, row)

    if (place !== undefined) {
      return { fold, place, isOpen: (await read($, opened)).includes(fold.head) }
    }
  }

  return undefined
}

/**
 * A folded row on the desktop: the first draws the line, the rest draw nothing until it opens.
 * Undefined for a row outside every fold, which the caller draws as before.
 */
async function drawFolded(
  $: EngineInterface,
  e: RenderInput<'AssistantMessage', 'desktop'>,
  row: Parameters<typeof placeOf>[1],
  draw: () => Promise<RenderElement>,
  hide: () => Promise<RenderElement>,
): Promise<RenderElement | undefined> {
  const at = await foldAt($, row)

  if (at === undefined) {
    return undefined
  }

  const { Box, Button, Text } = $.ui.resolve(e)
  const { fold, place, isOpen } = at

  if (place === 'member') {
    return isOpen ? draw() : hide()
  }

  const label = labelOf(fold, (await stringsOf($)).fold, isOpen)
  const toggle = () => void update($, opened, list => (list.includes(fold.head) ? list.filter(h => h !== fold.head) : [...list, fold.head]))
  const line = (
    // The desktop draws its own button and ignores a nested `Text`'s props, so the Button dims
    // and the marks sit beside it, where their colour shows.
    <Box key={`fold-${fold.head}`} flexDirection="row">
      <Button plain dimColor onPress={toggle}>{`${isOpen ? '▾' : '▸'} ${label.text}`}</Button>
      {label.errors === undefined ? null : <Text color="error">{` · ${label.errors}`}</Text>}
      {label.warnings === undefined ? null : <Text color="warning">{` · ${label.warnings}`}</Text>}
    </Box>
  )

  return isOpen ? (
    <Box flexDirection="column">
      {line}
      {await draw()}
    </Box>
  ) : (
    line
  )
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    if (await isDisabled($)) return next(e)

    // A mod's command has no plugin prefix: the person types `/hush-lint`.
    await $.command.register({ name: 'hush-lint', description: (await stringsOf($)).command })

    // A reopened session finds its folds again; a hot reload keeps them in `$.state` already.
    const saved = await $.store.get(`folds-2:${await $.session.id()}`)

    if (Array.isArray(saved) && (await read($, folds)).length === 0) {
      await update($, folds, () => saved as Fold[])
    }

    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined && !(await isDisabled($))) {
      isReplying = true
      startReply()
    }

    return next(e)
  })

  // What the reply stored, and the re-prompt that ends it (a Stop hook's, `/goal`'s).
  on('session.append', async ($, e, next) => {
    const row = await next(e)

    // `isReplying` stays false under HUSH_DISABLE=1, so nothing is gathered.
    if (e.agentId === undefined && isReplying) {
      const blocks = Array.isArray(e.message.content) ? e.message.content : []

      for (const block of blocks) {
        if (e.message.type === 'assistant' && block.type === 'text' && typeof block.text === 'string') {
          stored.texts.push(block.text)
          stored.items.push({ kind: 'text', head: headOf(block.text) })
        }
        if (e.message.type === 'assistant' && block.type === 'tool_use' && typeof block.id === 'string') stored.items.push({ kind: 'tool', id: block.id })
        if (block.type === 'tool_result' && block.is_error === true) stored.errors++
      }

      const text = blocks.map(block => (block.type === 'text' && typeof block.text === 'string' ? block.text : '')).join('')

      if (e.message.type === 'user' && e.message.isMeta === true && isReprompt(text)) {
        await closeReply($)
      }
    }

    return row
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'hush-lint' }, async $ => {
    const hasSection = await $.store.get(LAST_COMPOSE)
    const s = await stringsOf($)

    return {
      text: [
        // The app names the mod before a command's text, so the text does not.
        hasSection === undefined ? s.notComposed : hasSection === true ? s.carried : s.notCarried,
        report(asTally(await $.store.get(TALLY_SECTION)), s.withSection, s.report),
        report(asTally(await $.store.get(TALLY)), s.withoutSection, s.report),
      ].join('\n\n'),
    }
  })

  // Tell Claude what this mod draws, only where it draws it (`voice.ts`).
  on('prompt.compose', async ($, e, next) => {
    const result = await next(e)

    if (await isDisabled($)) return result

    const teaches = teachesDesktop(e, settingsOf(await hushConfig($)))

    if (e.outputStyle !== null && /^hush(:|$)/i.test(e.outputStyle.name)) {
      await $.store.set(LAST_COMPOSE, teaches)
    }

    if (!teaches) {
      return result
    }

    return { sections: [...result.sections, { id: 'hush:desktop', text: DESKTOP_SECTION, scope: 'session' as const }] }
  })

  // Main-loop answers only: a subagent's report and an aborted turn are no final message.
  on('turn.complete', async ($, e, next) => {
    const done = await next(e)

    if (await isDisabled($)) return done

    if (e.agentId === undefined) {
      isReplying = false
      await closeReply($)
    }

    if (e.agentId === undefined && e.reason === 'answer' && e.answer.trim() !== '') {
      const taught = (await $.store.get(LAST_COMPOSE)) === true
      const key = taught ? TALLY_SECTION : TALLY
      const prev = asTally(await $.store.get(key))
      // A link resolves against the session's directory, as the app opens it; an absolute
      // path stands alone.
      const cwd = await $.session.cwd()
      const found = await Promise.all(
        localLinks(e.answer).map(path => $.fs.exists(/^([a-z]:)?[\\/]/i.test(path) ? path : `${cwd}/${path}`).catch(() => true)),
      )
      const lint = lintMessage(e.answer, settingsOf(await hushConfig($)), found.filter(isThere => !isThere).length, taught ? SECTION_ALERTS : [])
      await $.store.set(key, tally(prev, lint, e.usage?.output_tokens ?? 0, new Date().toISOString(), usesForms(e.answer)))
    }

    return done
  })

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    if (e.surface !== 'desktop' || (await isDisabled($))) return next(e)

    // A hidden text goes to the app empty, so it may drop the row and its gap, not just its words.
    const folded = await drawFolded($, e, { kind: 'text', text: e.props.text }, () => next(e), () => next({ ...e, props: { ...e.props, text: '' } }))

    if (folded !== undefined) {
      return folded
    }

    const parts = splitReply(e.props.text)

    if (parts === null) {
      return next(e)
    }

    const width = cardWidth(e.viewport?.columns ?? 100)
    const { Box, Markdown, Svg } = $.ui.resolve(e)
    const s = await stringsOf($)
    // The app's own renderer draws each prose part, as it draws a whole reply: `next` once per
    // part with that part's text. The engine's `Markdown` element draws smaller and tighter
    // than the app's reply text. Only the first part keeps the reply's `isFirstOfReply`.
    const first = parts.findIndex(part => part.kind === 'markdown')
    const prose = await Promise.all(
      parts.map((part, i) =>
        part.kind === 'markdown' ? next({ ...e, props: { ...e.props, text: cite(part.text).replace(/^\n+|\n+$/g, ''), isFirstOfReply: e.props.isFirstOfReply && i === first } }) : null,
      ),
    )

    return (
      // A named step between a reply's blocks, which the desktop sizes on its own scale.
      <Box flexDirection="column" gap="md">
        {parts.map((part, i) => {
          if (part.kind === 'markdown') {
            return <Box key={`md${i}`}>{prose[i]}</Box>
          }

          if (part.kind === 'notes') {
            return <Markdown key={`notes${i}`} text={hardBreaks(cite(part.text))} dimColor />
          }

          if (part.kind === 'alert') {
            const alert = ALERTS[part.type]
            const line = (
              <Box key={`alert${i}`} flexDirection="row" alignItems="flex-start" columnGap={1}>
                {/* One line tall and centred, as the app's banner holds its icon (`min-h-[1lh] items-center`), so the icon sits on the first line of text. */}
                <Box height={1} flexShrink={0} alignItems="center">
                  <Svg source={octicon(part.type, alert.light, alert.dark)} alt={s.alerts[part.type]} width={16} height={16} />
                </Box>
                {part.body === '' ? null : <Markdown text={hardBreaks(cite(part.body))} />}
              </Box>
            )

            // A note or a tip asks for no attention: its icon alone marks the line. Only the
            // alerts that must be seen take the banner's box.
            return QUIET.has(part.type) ? (
              line
            ) : (
              <Box key={`alert${i}`} flexDirection="column" borderStyle="round" borderColor={alert.color} paddingX={1}>
                {line}
              </Box>
            )
          }

          // A chart too crowded for this width keeps its source as a code block.
          const built = themedChart(part.chart, width, s.chart)

          return built === null ? (
            <Markdown key={`md${i}`} text={`\`\`\`mermaid\n${part.source}\n\`\`\``} />
          ) : (
            <Svg key={`chart${i}`} source={built.source} alt={built.alt} />
          )
        })}
      </Box>
    )
  })
}
