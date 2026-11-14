import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderElement, RenderInput } from 'claude-code'

import { NO_HEADS, fitted, foldOf, hasHead, headOf, isReprompt, kept, labelOf, looseOf, placeOf, textOf, withHeads } from './fold'
import type { Folds, FoldWords, Stored } from './fold'

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
const EMPTY: Folds = { folds: [], loose: NO_HEADS }
const folds = atom({ plugin: 'hush', key: 'folds' } as const, EMPTY, { shape: 'folds-4' })
const opened = atom({ plugin: 'hush', key: 'open' } as const, [], { shape: 'open-1' })
const STORE = 'folds-4:'
export const FOLDS_KEPT = 300
// The store is one JSON file of at most 4 MiB in all, shared with every other key the mod keeps:
// eight sessions of at most 256 KiB each, in UTF-8 bytes, fill half of it.
export const SESSIONS_KEPT = 8
export const SESSION_BUDGET = 256 * 1024
let isReplying = false
// A prompt queued during the turn: the texts after it answer two prompts, so none of them folds.
let isMixed = false
let stored: Stored = { items: [], errors: 0 }

function startReply() {
  stored = { items: [], errors: 0 }
  isMixed = false
}

const isFolds = (v: unknown): v is Folds =>
  typeof v === 'object' && v !== null && Array.isArray((v as Folds).folds) && typeof (v as Folds).loose === 'string'

/** Saves the session's folds, keeping the newest sessions' and dropping any older shape's. */
async function save($: EngineInterface, all: Folds) {
  const key = `${STORE}${await $.session.id()}`
  const others = (await $.store.keys()).filter(k => k.startsWith('folds-') && k !== key)
  const current = others.filter(k => k.startsWith(STORE))

  for (const k of [...others.filter(k => !k.startsWith(STORE)), ...current.slice(0, Math.max(0, current.length - (SESSIONS_KEPT - 1)))]) {
    await $.store.delete(k)
  }

  // Deleted first, so `keys()`, in insertion order, lists sessions oldest written first.
  await $.store.delete(key)
  await $.store.set(key, fitted(all, SESSION_BUDGET))
}

/**
 * The reply stopped: fold what came before its final message, keep it past a reload. A reply cut
 * by a compaction folds nothing: its first rows may no longer be drawn, so all its texts turn loose.
 */
async function closeReply($: EngineInterface, isCut = false) {
  const fold = isMixed || isCut ? null : foldOf(stored)
  const loose = looseOf(stored, fold)
  startReply()

  if (fold === null && loose.length === 0) {
    return
  }

  const all = await update($, folds, s => kept({ folds: [...s.folds, ...(fold === null ? [] : [fold])], loose: withHeads(s.loose, loose) }, FOLDS_KEPT))

  if (all.folds.length > 0) {
    // A store that refuses the write leaves this session's folds in `$.state` until it ends.
    await save($, all).catch(() => undefined)
  }
}

/** The fold a row belongs to, read while drawing so a new fold or a press draws it again. */
async function foldAt($: EngineInterface, text: string) {
  const at = placeOf(await read($, folds), text)

  return at === undefined ? undefined : { ...at, isOpen: (await read($, opened)).includes(at.fold.head) }
}

/**
 * A folded row on the desktop: the first draws the line, the rest draw nothing until it opens.
 * Undefined for a row outside every fold, which the caller leaves to the app.
 */
async function drawFolded(
  $: EngineInterface,
  e: RenderInput<'AssistantMessage', 'desktop'>,
  draw: () => Promise<RenderElement>,
  hide: () => Promise<RenderElement>,
): Promise<RenderElement | undefined> {
  const at = await foldAt($, e.props.text)

  if (at === undefined) {
    return undefined
  }

  const { Box, Button, Text } = $.ui.resolve(e)
  const { fold, place, hidden, isOpen } = at

  if (place === 'member') {
    return isOpen ? draw() : hide()
  }

  const label = labelOf(fold, hidden, (await stringsOf($)).fold, isOpen)
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

    // Each session sees its own folds: the saved ones, or none, never another session's.
    const saved = await $.store.get(`${STORE}${await $.session.id()}`)
    await update($, folds, () => (isFolds(saved) ? saved : EMPTY))
    await update($, opened, () => [])

    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined && !(await isDisabled($))) {
      isReplying = true
      startReply()
    }

    return next(e)
  })

  // What the reply stored, and what ends it: a re-prompt (a Stop hook's, `/goal`'s), a prompt the
  // person queued while Claude worked, or a compaction.
  on('session.append', async ($, e, next) => {
    const row = await next(e)
    const blocks = Array.isArray(e.message.content) ? e.message.content : []

    // A subagent's texts are never a reply's, but the app may draw them: their words turn loose,
    // so a main fold never hides one. Nothing is gathered for the subagent.
    if (e.agentId !== undefined) {
      const heads = e.message.type === 'assistant' ? blocks.flatMap(block => (block.type === 'text' && typeof block.text === 'string' ? [headOf(block.text)] : [])) : []

      if (heads.length > 0 && !(await isDisabled($))) {
        const { loose } = await read($, folds)

        if (!heads.every(head => hasHead(loose, head))) await update($, folds, s => ({ ...s, loose: withHeads(s.loose, heads) }))
      }

      return row
    }

    // `isReplying` stays false under HUSH_DISABLE=1, so nothing is gathered.
    if (isReplying) {
      const isPrompt = e.door === 'prompt' || e.door === 'queue' || (e.message.type === 'attachment' && e.message.name === 'queued_command')

      // The prompt that starts the turn arrives before anything is gathered and ends nothing.
      if (isPrompt && stored.items.length > 0) {
        await closeReply($)
        isMixed = true
      }

      // The app may stop drawing the rows before a compaction: what came before it folds nothing.
      // A prompt queued before it still mixes two answers in what follows.
      if (e.door === 'compaction') {
        const wasMixed = isMixed
        await closeReply($, true)
        isMixed = wasMixed
      }

      for (const block of blocks) {
        if (e.message.type === 'assistant' && block.type === 'text' && typeof block.text === 'string') stored.items.push(textOf(block.text))
        if (e.message.type === 'assistant' && block.type === 'tool_use') stored.items.push({ kind: 'tool' })
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

    if (e.agentId !== undefined) return done

    // Gathering stops either way, so a reply switched off mid-turn leaves no later turn gathering.
    isReplying = false

    if (await isDisabled($)) {
      startReply()
    } else {
      await closeReply($)
    }

    return done
  })

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    if (e.surface !== 'desktop' || (await isDisabled($))) return next(e)

    // A hidden text goes to the app empty, so it may drop the row and its gap, not just its words.
    const folded = await drawFolded($, e, () => next(e), () => next({ ...e, props: { ...e.props, text: '' } }))

    return folded ?? next(e)
  })
}
