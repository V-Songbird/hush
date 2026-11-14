import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderElement, RenderInput } from 'claude-code'

import { NO_HEADS, fitted, foldOf, hasHead, headOf, isReprompt, kept, labelOf, looseOf, placeOf, textOf, withHeads } from './fold'
import type { Folds, FoldWords, Stored } from './fold'
import { TALLY_MAX, asTally, countFiles, isDefault, lintMessage, settingsKey, settingsOf, tally } from './lint'
import type { Settings } from './lint'

// Hush's mod, optional: the command hooks in hooks.json are the product and never depend on it.
// On the desktop app, it folds the progress texts written between tool calls into one line once
// the reply's final message arrives (`fold.ts`). Every other reply, and every other surface, the
// terminal included, is left to the app. It adds no command. HUSH_DISABLE=1 turns it off.
// It also checks each final message of a session someone reads, on any surface, in silence
// (`lint.ts`): a count kept in `tally.json` beside the settings file, which `/hush:config`
// reads. It changes nothing in the reply.

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

/**
 * The settings saved now and the count's file beside them, or undefined when the check cannot
 * know them: then nothing is counted. Only a missing settings file means the defaults; one that
 * exists but cannot be read or parsed is unknown. A rejection is the caller's to swallow.
 */
async function savedSettings($: EngineInterface): Promise<{ settings: Settings; key: string; isDefault: boolean; tally: string } | undefined> {
  // The project root tells the platform: a POSIX path opens with one `/`, a Windows one with a
  // drive or `\\`. Anything else, an empty root included, is neither. The home is the one
  // `os.homedir()` reads, as /hush:config's CLI does.
  const root = await $.session.root()
  const isWindows = /^(?:[A-Za-z]:[\\/]|[\\/]{2})/.test(root)

  if (!isWindows && !/^\/(?!\/)/.test(root)) return undefined

  const named = await $.env.get('HUSH_CONFIG_FILE')
  const home = named ? undefined : isWindows ? await $.env.get('USERPROFILE') : await $.env.get('HOME')
  const files = countFiles(named, home, isWindows)

  if (files === undefined) return undefined

  let saved: unknown

  try {
    saved = JSON.parse(String(await $.fs.read(files.config)))
  } catch {
    if (await $.fs.exists(files.config)) return undefined
  }

  const settings = settingsOf(saved)

  return { settings, key: settingsKey(settings), isDefault: isDefault(settings), tally: files.tally }
}

/** The first words of what `hooks/style-settings.js` sends the model; tests/desktop_mod.test.js keeps the two equal. */
export const SETTINGS_HEADER =
  'hush settings, chosen by the user with /hush:config. Each one replaces only the rule it names. The rest of the Hush style stays. No setting removes a blocker, a pending approval, an unverified claim or anything left unchecked.'

// The settings key the model was sent, which the check counts under. Hush's SessionStart command
// hook sends the saved settings under SETTINGS_HEADER at a start, a /clear, a resume, a fork and a
// compaction, and sends nothing for the defaults. It runs beneath the hooks modules, so its text
// is in what `next(e)` answers. The saved key is held only when what the model got matches what
// is saved: that text for settings off their defaults, no such text for the defaults. Anything
// else, a hook that failed or timed out included, holds `''`, which matches no settings, so the
// session counts nothing. A session the mod saw no SessionStart for, as when the plugin is
// enabled mid-session, holds nothing and counts nothing.
const IN_FORCE = { plugin: 'hush', key: 'inForce' } as const

/**
 * Counts one final message in `tally.json`: its rules met or missed, never its words. It reads,
 * adds and writes in one go, so two sessions ending together may lose a count; the count is a
 * guide, not a record. A failure anywhere, a read-only home included, is swallowed: the check
 * never breaks the turn or the fold.
 *
 * Only a session someone reads is counted: one that draws on a surface, the terminal's REPL or
 * an app. A `claude -p` run draws on none. A one-line answer is left out: a turn nobody asked
 * for may end with one short line, and the voice asks no structure of it. A turn whose saved
 * settings differ from the ones the model was sent is left out too.
 */
async function checkAnswer($: EngineInterface, answer: string) {
  try {
    if (!answer.trim().includes('\n') || (await $.session.surfaces()).length === 0) return

    const now = await savedSettings($)

    if (now === undefined || now.key !== (await $.state.get(IN_FORCE)).value) return

    const prev = asTally(await $.fs.read(now.tally).then(text => (String(text).length > TALLY_MAX ? undefined : (JSON.parse(String(text)) as unknown))).catch(() => undefined), now.key)

    await $.fs.write(now.tally, JSON.stringify(tally(prev, lintMessage(answer, now.settings), new Date().toISOString().slice(0, 10), now.key)) + '\n')
  } catch {
    // Nothing to report: the check is silent.
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
// A subagent's words turned loose since the last save.
let hasUnsaved = false
let stored: Stored = { items: [], errors: 0 }

function startReply() {
  stored = { items: [], errors: 0 }
  isMixed = false
}

// A damaged set of loose heads could answer "no" for a head it took, so the record is not read.
const isFolds = (v: unknown): v is Folds => {
  const { folds, loose } = (typeof v === 'object' && v !== null ? v : {}) as Partial<Folds>

  return Array.isArray(folds) && typeof loose === 'string' && loose.length === NO_HEADS.length && /^[A-Za-z0-9+/]+$/.test(loose)
}

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
  hasUnsaved = false
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

  // The settings the model was sent, for the check (IN_FORCE). The answer goes on unchanged.
  on('classic.SessionStart', async ($, e, next) => {
    const done = await next(e)

    try {
      if (await isDisabled($)) return done

      const now = await savedSettings($).catch(() => undefined)
      const isSent = (done.additionalContext ?? []).some(text => typeof text === 'string' && text.startsWith(SETTINGS_HEADER))

      await $.state.set(IN_FORCE, now !== undefined && isSent === !now.isDefault ? now.key : '')
    } catch {
      // Nothing held: the next count reads no key and counts nothing.
    }

    return done
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

        if (!heads.every(head => hasHead(loose, head))) {
          await update($, folds, s => ({ ...s, loose: withHeads(s.loose, heads) }))
          hasUnsaved = true
        }
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

    if (e.agentId !== undefined) {
      // A subagent may end after the reply's last save: keep its words loose past a reopen.
      const all = await read($, folds)

      if (hasUnsaved && all.folds.length > 0) await save($, all).catch(() => undefined)

      return done
    }

    // Gathering stops either way, so a reply switched off mid-turn leaves no later turn gathering.
    isReplying = false

    if (await isDisabled($)) {
      startReply()
    } else {
      await closeReply($)

      if (e.reason === 'answer') await checkAnswer($, e.answer)
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
