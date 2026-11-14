import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

// The silent check through the mod: a final message adds to `tally.json` beside the settings
// file. Each beneath hook stands for the engine: its files, its environment, its session.

const ANSWER = '**Done.**\n\n---\n\nOne fact.\n\n---\n\n**Next:** read it.'
const HOME = '/home/p'
const TALLY = `${HOME}/.claude/hush/tally.json`
const CONFIG = `${HOME}/.claude/hush/config.json`
const KEY = 'end-on-rich-12-off-off'

// The engine may add a drive letter or turn a slash; a path is compared as `/dir/file`.
const norm = (path: string) => path.replace(/^[A-Za-z]:/, '').replace(/\\/g, '/')

type Opts = {
  env?: Record<string, string>
  /** A variable whose read the engine rejects. */
  envDeny?: string
  files?: Record<string, string>
  /** Files that exist but whose read the engine rejects, as another plugin's fs.read hook may. */
  unreadable?: string[]
  failWrite?: boolean
  surfaces?: string[]
  root?: string
}

const kit = ($: Engine, on: On, opts: Opts = {}) => {
  const files = new Map(Object.entries(opts.files ?? {}).map(([k, v]) => [norm(k), v]))
  const unreadable = new Set((opts.unreadable ?? []).map(norm))
  const writes: string[] = []
  // The paths as the mod wrote them, drive letter and separators kept.
  const raw: string[] = []
  const registered: string[] = []
  const stored: string[] = []

  on('env.get', (_, e) => (e.name === opts.envDeny ? { deny: 'refused' } : { value: opts.env?.[e.name] }))
  on('fs.read', (_, e) => {
    const text = files.get(norm(e.path))

    // The engine rejects a read over 4 MiB.
    return text === undefined || unreadable.has(norm(e.path)) || text.length > 4 * 1024 * 1024 ? { deny: 'ENOENT' } : { value: text }
  })
  on('fs.write', (_, e) => {
    writes.push(norm(e.path))
    raw.push(e.path)

    if (opts.failWrite) return { deny: 'EACCES' }

    files.set(norm(e.path), e.text)

    return { value: undefined }
  })
  on('session.surfaces', () => ({ value: (opts.surfaces ?? ['desktop']) as never }))
  on('session.root', () => ({ value: opts.root ?? '/work' }))
  on('fs.exists', (_, e) => ({ value: files.has(norm(e.path)) || unreadable.has(norm(e.path)) }))
  on('session.id', () => ({ value: 's1' }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('store.get', () => ({ value: undefined }))
  on('store.set', (_, e) => {
    stored.push(e.key)

    return { value: undefined }
  })
  on('store.keys', () => ({ value: [] }))
  on('store.delete', () => ({ value: undefined }))
  on('command.register', (_, e) => {
    registered.push(e.name)

    return { value: { command: e.name } }
  })
  on('turn.start', (_, e) => ({ turnId: e.turnId }) as never)
  on('turn.complete', () => ({ text: '' }))

  return {
    files,
    writes,
    raw,
    registered,
    stored,
    start: () => $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work' } as never),
    compact: (agentId?: string) =>
      $.session.append({ message: { type: 'user', role: 'user', content: [{ type: 'text', text: 'The summary.' }] }, door: 'compaction', uuid: 'c1', origin: { kind: 'engine' }, ...(agentId === undefined ? {} : { agentId }) } as never),
    finish: (answer = ANSWER, extra: object = {}) => $.turn.complete({ answer, durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer', ...extra } as never),
  }
}

// A session as the engine runs it: the mod reads the settings in force at its start.
const started = async ($: Engine, on: On, opts: Opts = {}) => {
  const k = kit($, on, opts)

  await k.start()

  return k
}

const HOME_ENV = { HOME }
const read = (k: ReturnType<typeof kit>, file = TALLY) => JSON.parse(k.files.get(norm(file)) ?? 'null')

test('a final message adds one to the tally beside the settings file', async ($, on) => {
  const k = await started($, on, { env: HOME_ENV })

  await k.finish()
  await k.finish('plain\n\nmore')

  expect(read(k)).toMatchObject({ messages: 2, met: 1, misses: { 'result first': 1, 'rules where set': 1, 'next step where set': 1 } })
  expect(k.writes).toEqual([TALLY, TALLY])
})

test('a one-line answer is not counted', async ($, on) => {
  const k = await started($, on, { env: HOME_ENV })

  await k.finish('Nothing new.')
  await k.finish('  Still waiting.\n')

  expect(k.writes).toEqual([])
})

test('an answer that is not text is not counted, and the turn still completes', async ($, on) => {
  const k = await started($, on, { env: HOME_ENV })

  await expect(k.finish(undefined as never, { answer: undefined })).resolves.toBeDefined()
  expect(k.writes).toEqual([])
})

test('the tally sits beside HUSH_CONFIG_FILE when it is set, and the settings come from it', async ($, on) => {
  const config = '/cfg/mine.json'
  const k = await started($, on, { env: { HUSH_CONFIG_FILE: config, HOME }, files: { [config]: JSON.stringify({ next: 'off' }) } })

  await k.finish()

  // next=off: a rule above a final "Next:" line is a miss.
  expect(read(k, '/cfg/tally.json')).toMatchObject({ messages: 1, met: 0, misses: { 'next step where set': 1 }, settings: 'off-on-rich-12-off-off' })
  expect(k.writes).toEqual(['/cfg/tally.json'])
})

for (const named of ['config.json', './cfg/x.json', 'cfg/']) {
  test(`a HUSH_CONFIG_FILE that is not an absolute path, ${named}, counts nothing and writes nothing`, async ($, on) => {
    const k = await started($, on, { env: { HUSH_CONFIG_FILE: named, HOME } })

    await k.finish()

    expect(k.writes).toEqual([])
  })
}

for (const [named, root] of [
  ['/cfg/', '/work'],
  ['/home/p/hush/', '/work'],
  ['C:\\cfg\\', 'C:\\work'],
] as const) {
  test(`a HUSH_CONFIG_FILE that ends in a separator, ${named}, writes nothing, not even in the folder above`, async ($, on) => {
    const k = await started($, on, { root, env: { HUSH_CONFIG_FILE: named, HOME } })

    await k.finish()

    expect(k.writes).toEqual([])
  })
}

test('on macOS and Linux the home is HOME, never USERPROFILE', async ($, on) => {
  const k = await started($, on, { env: { HOME, USERPROFILE: '/wrong' } })

  await k.finish()

  expect(k.writes).toEqual([TALLY])
})

test('on Windows the home is USERPROFILE, never HOME, as os.homedir() reads it, on its own drive', async ($, on) => {
  const k = await started($, on, { root: 'C:\\work', env: { USERPROFILE: 'D:\\Users\\p', HOME: '/c/Users/other' } })

  await k.finish()

  expect(k.raw).toEqual(['D:\\Users\\p\\.claude\\hush\\tally.json'])
})

test('with no home for the platform, nothing is written', async ($, on) => {
  const posix = await started($, on, { env: { USERPROFILE: '/home/p' } })
  await posix.finish()
  expect(posix.writes).toEqual([])
})

test('on Windows, HOME alone is no home', async ($, on) => {
  const windows = await started($, on, { root: 'C:\\work', env: { HOME } })
  await windows.finish()
  expect(windows.writes).toEqual([])
})

for (const root of ['', 'work']) {
  test(`a project root that names no platform for certain, ${JSON.stringify(root)}, writes nothing`, async ($, on) => {
    const k = await started($, on, { root, env: { USERPROFILE: 'C:\\Users\\p', HOME } })

    await k.finish()

    expect(k.writes).toEqual([])
  })
}

test('no home and no HUSH_CONFIG_FILE writes nothing', async ($, on) => {
  const k = await started($, on)

  await k.finish()

  expect(k.writes).toEqual([])
})

test('an environment read the engine rejects writes nothing, and the turn still completes', async ($, on) => {
  const k = await started($, on, { env: HOME_ENV, envDeny: 'HUSH_CONFIG_FILE' })

  await expect(k.finish()).resolves.toBeDefined()
  expect(k.writes).toEqual([])
})

test('a session nobody reads, such as claude -p, is not counted', async ($, on) => {
  const k = await started($, on, { env: HOME_ENV, surfaces: [] })

  await k.finish()

  expect(k.writes).toEqual([])
})

test('a subagent’s turn, an empty answer, and an aborted, refused or failed turn add nothing', async ($, on) => {
  const k = await started($, on, { env: HOME_ENV })

  await k.finish(ANSWER, { agentId: 'a1' })
  await k.finish('   \n')
  await k.finish(ANSWER, { reason: 'aborted', isAborted: true })
  await k.finish(ANSWER, { reason: 'refusal' })
  await k.finish(ANSWER, { reason: 'error' })

  expect(k.writes).toEqual([])
})

test('HUSH_DISABLE=1 adds nothing', async ($, on) => {
  const k = await started($, on, { env: { ...HOME_ENV, HUSH_DISABLE: '1' } })

  await k.finish()

  expect(k.writes).toEqual([])
})

test('a failing write is swallowed, and the turn still completes', async ($, on) => {
  const k = await started($, on, { env: HOME_ENV, failWrite: true })

  await expect(k.finish()).resolves.toBeDefined()
  expect(k.writes).toEqual([TALLY])
})

test('a failing read starts a new count, and a damaged file is replaced by one', async ($, on) => {
  const k = await started($, on, { env: HOME_ENV, files: { [TALLY]: '{broken' } })

  await k.finish()

  expect(read(k)).toMatchObject({ messages: 1 })
})

const OLD = JSON.stringify({ messages: 5, met: 5, misses: {}, since: '2026-11-01', last: '2026-11-01', settings: KEY })

test('a count kept for the same settings goes on', async ($, on) => {
  const k = await started($, on, { env: HOME_ENV, files: { [TALLY]: OLD } })

  await k.finish()

  expect(read(k)).toMatchObject({ messages: 6, met: 6, since: '2026-11-01', settings: KEY })
})

for (const pad of [70 * 1024, 4 * 1024 * 1024 + 1]) {
  test(`a tally padded past the size a count can reach (${pad} spaces) starts a new count`, async ($, on) => {
    const k = await started($, on, { env: HOME_ENV, files: { [TALLY]: OLD + ' '.repeat(pad) } })

    await k.finish()

    expect(read(k)).toMatchObject({ messages: 1 })
  })
}

test('a change to a setting the rules read starts a new count', async ($, on) => {
  const config = '/cfg/c.json'
  const k = await started($, on, { env: { HUSH_CONFIG_FILE: config }, files: { [config]: JSON.stringify({ headers: 'on' }), '/cfg/tally.json': OLD } })

  await k.finish()

  expect(read(k, '/cfg/tally.json')).toMatchObject({ messages: 1, settings: 'end-on-rich-12-off-on' })
})

test('a change to a setting no rule reads keeps the count', async ($, on) => {
  const config = '/cfg/c.json'
  const k = await started($, on, { env: { HUSH_CONFIG_FILE: config }, files: { [config]: JSON.stringify({ why: 'off' }), '/cfg/tally.json': OLD } })

  await k.finish()

  expect(read(k, '/cfg/tally.json')).toMatchObject({ messages: 6, met: 6, settings: KEY })
})

// The settings the model was sent: at the start and after a compaction, never at a turn's end.
test('settings saved after the session started are not the ones in force: that turn is not counted', async ($, on) => {
  const k = await started($, on, { env: HOME_ENV })

  // `/hush:config set next=top` here or in another session.
  k.files.set(norm(CONFIG), JSON.stringify({ next: 'top' }))
  await k.finish()
  await k.finish()

  expect(k.writes).toEqual([])
})

test('a compaction sends the saved settings again, and the count goes on under them', async ($, on) => {
  const k = await started($, on, { env: HOME_ENV })

  k.files.set(norm(CONFIG), JSON.stringify({ next: 'off' }))
  await k.compact('a1')
  await k.finish()
  expect(k.writes).toEqual([])

  await k.compact()
  await k.finish('**Done.**\n\n---\n\nOne fact.')

  expect(read(k)).toMatchObject({ messages: 1, met: 1, settings: 'off-on-rich-12-off-off' })
})

test('a mod that never saw the session start counts nothing', async ($, on) => {
  const k = kit($, on, { env: HOME_ENV })

  await k.finish()

  expect(k.writes).toEqual([])
})

test('a later start of the mod in the same session, as after a reload, keeps the settings it read first', async ($, on) => {
  const k = await started($, on, { env: HOME_ENV })

  k.files.set(norm(CONFIG), JSON.stringify({ next: 'top' }))
  await k.start()
  await k.finish()

  expect(k.writes).toEqual([])
})

for (const [name, text] of [
  ['broken JSON', '{broken'],
  ['a byte order mark', '\uFEFF{"next":"top"}'],
]) {
  test(`a settings file that exists but cannot be parsed, with ${name}, counts nothing; only a missing one means defaults`, async ($, on) => {
    const k = await started($, on, { env: HOME_ENV, files: { [CONFIG]: text } })

    await k.finish()

    expect(k.writes).toEqual([])
  })
}

test('a settings file another plugin will not let the mod read counts nothing', async ($, on) => {
  const k = await started($, on, { env: HOME_ENV, unreadable: [CONFIG] })

  await k.finish()

  expect(k.writes).toEqual([])
})

test('the file holds no word of any reply', async ($, on) => {
  const k = await started($, on, { env: HOME_ENV })

  await k.finish('**Secret result words.**\n\nPrivate sentence about the token.')

  const text = k.files.get(norm(TALLY)) ?? ''
  const t = JSON.parse(text)
  expect(text).not.toMatch(/Secret|Private|token/)
  expect(Object.keys(t).sort()).toEqual(['last', 'messages', 'met', 'misses', 'settings', 'since'])
  expect(t.settings).toBe(KEY)
  expect(t.since).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  expect(Object.values(t.misses).every(n => typeof n === 'number')).toBe(true)
})

test('the check leaves the fold as it was: a reply folds and the count still adds', async ($, on) => {
  const k = kit($, on, { env: HOME_ENV })
  await k.start()
  await $.turn.start({ turnId: 't1' } as never)
  await $.session.append({ message: { type: 'assistant', role: 'assistant', content: [{ type: 'text', text: 'Now I check the store.' }] }, door: 'response', uuid: 'u1', origin: { kind: 'model', model: 'm' } } as never)
  await $.session.append({ message: { type: 'assistant', role: 'assistant', content: [{ type: 'text', text: ANSWER }] }, door: 'response', uuid: 'u2', origin: { kind: 'model', model: 'm' } } as never)
  await k.finish()

  expect(read(k)).toMatchObject({ messages: 1, met: 1 })
  expect(k.stored).toEqual(['folds-4:s1'])
})

test('a failing write leaves the fold saved', async ($, on) => {
  const k = kit($, on, { env: HOME_ENV, failWrite: true })
  await k.start()
  await $.turn.start({ turnId: 't1' } as never)
  await $.session.append({ message: { type: 'assistant', role: 'assistant', content: [{ type: 'text', text: 'Now I check the store.' }] }, door: 'response', uuid: 'u1', origin: { kind: 'model', model: 'm' } } as never)
  await $.session.append({ message: { type: 'assistant', role: 'assistant', content: [{ type: 'text', text: ANSWER }] }, door: 'response', uuid: 'u2', origin: { kind: 'model', model: 'm' } } as never)
  await k.finish()

  expect(k.stored).toEqual(['folds-4:s1'])
})

test('a session start registers no command', async ($, on) => {
  const k = kit($, on, { env: HOME_ENV })

  await k.start()
  await k.finish()

  expect(k.registered).toEqual([])
})
