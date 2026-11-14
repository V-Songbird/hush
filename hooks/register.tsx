import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderElement, RenderInput } from 'claude-code'

import { foldOf, headOf, isReprompt, labelOf, placeOf } from './fold'
import type { Fold, FoldWords, Stored } from './fold'

// Hush's mod, optional: the command hooks in hooks.json are the product and never depend on it.
// On the desktop app, it folds the progress texts written between tool calls into one line once
// the reply's final message arrives (`fold.ts`). Every other reply, and every other surface, the
// terminal included, is left to the app. It adds no command. HUSH_DISABLE=1 turns it off.

/** What the mod says, by language. English is the complete base. */
export const EN = {
  fold: {
    show: n => `Show ${n} ${n === 1 ? 'progress message' : 'progress messages'}`,
    hide: n => `Hide ${n} ${n === 1 ? 'progress message' : 'progress messages'}`,
    failed: n => `${n} failed`,
    warnings: n => `${n} ${n === 1 ? 'warning' : 'warnings'}`,
  } as FoldWords,
}
export const ES: typeof EN = {
  fold: {
    show: n => `Ver ${n} ${n === 1 ? 'mensaje de avance' : 'mensajes de avance'}`,
    hide: n => `Ocultar ${n} ${n === 1 ? 'mensaje de avance' : 'mensajes de avance'}`,
    failed: n => `${n} ${n === 1 ? 'falló' : 'fallaron'}`,
    warnings: n => `${n} ${n === 1 ? 'aviso' : 'avisos'}`,
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
 * Undefined for a row outside every fold, which the caller leaves to the app.
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

  // The main loop's turn ended: fold what came before its final message. A subagent's turn is not one.
  on('turn.complete', async ($, e, next) => {
    const done = await next(e)

    if (await isDisabled($)) return done

    if (e.agentId === undefined) {
      isReplying = false
      await closeReply($)
    }

    return done
  })

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    if (e.surface !== 'desktop' || (await isDisabled($))) return next(e)

    // A hidden text goes to the app empty, so it may drop the row and its gap, not just its words.
    const folded = await drawFolded($, e, { kind: 'text', text: e.props.text }, () => next(e), () => next({ ...e, props: { ...e.props, text: '' } }))

    return folded ?? next(e)
  })
}
