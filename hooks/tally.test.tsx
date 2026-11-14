import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

// The silent check through the mod: a final message adds to `tally.json` beside the settings
// file. Each beneath hook stands for the engine: its files, its environment.

const ANSWER = '**Done.**\n\n---\n\nOne fact.\n\n---\n\n**Next:** read it.'
const HOME = '/home/p'
const TALLY = `${HOME}/.claude/hush/tally.json`

// The engine may add a drive letter or turn a slash; a path is compared as `/dir/file`.
const norm = (path: string) => path.replace(/^[A-Za-z]:/, '').replace(/\\/g, '/')

const kit = ($: Engine, on: On, opts: { env?: Record<string, string>; files?: Record<string, string>; failWrite?: boolean } = {}) => {
  const files = new Map(Object.entries(opts.files ?? {}).map(([k, v]) => [norm(k), v]))
  const writes: string[] = []
  const registered: string[] = []
  const stored: string[] = []

  on('env.get', (_, e) => ({ value: opts.env?.[e.name] }))
  on('fs.read', (_, e) => {
    const text = files.get(norm(e.path))

    return text === undefined ? { deny: 'ENOENT' } : { value: text }
  })
  on('fs.write', (_, e) => {
    writes.push(norm(e.path))

    if (opts.failWrite) return { deny: 'EACCES' }

    files.set(norm(e.path), e.text)

    return { value: undefined }
  })
  on('session.cwd', () => ({ value: '/work' }))
  on('fs.exists', () => ({ value: false }))
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
    registered,
    stored,
    start: () => $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work' } as never),
    finish: (answer = ANSWER, extra: object = {}) => $.turn.complete({ answer, durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer', ...extra } as never),
  }
}

const HOME_ENV = { USERPROFILE: HOME }
const read = (k: ReturnType<typeof kit>, file = TALLY) => JSON.parse(k.files.get(norm(file)) ?? 'null')

test('a final message adds one to the tally beside the settings file', async ($, on) => {
  const k = kit($, on, { env: HOME_ENV })

  await k.finish()
  await k.finish('plain')

  expect(read(k)).toMatchObject({ messages: 2, met: 1, misses: { 'result first': 1, 'rules where set': 1, 'next step where set': 1 } })
  expect(k.writes).toEqual([TALLY, TALLY])
})

test('the tally sits beside HUSH_CONFIG_FILE when it is set, and the settings come from it', async ($, on) => {
  const config = '/cfg/mine.json'
  const k = kit($, on, { env: { HUSH_CONFIG_FILE: config, USERPROFILE: HOME }, files: { [config]: JSON.stringify({ next: 'off' }) } })

  await k.finish()

  // next=off: the Next line in ANSWER is a miss.
  expect(read(k, '/cfg/tally.json')).toMatchObject({ messages: 1, met: 0, misses: { 'next step where set': 1 } })
  expect(k.writes).toEqual(['/cfg/tally.json'])
})

test('HOME stands in for USERPROFILE, and no home means no file', async ($, on) => {
  const withHome = kit($, on, { env: { HOME } })
  await withHome.finish()
  expect(withHome.writes).toEqual([TALLY])
})

test('no home and no HUSH_CONFIG_FILE writes nothing', async ($, on) => {
  const k = kit($, on)

  await k.finish()

  expect(k.writes).toEqual([])
})

test('a subagent’s turn and an empty answer add nothing', async ($, on) => {
  const k = kit($, on, { env: HOME_ENV })

  await k.finish(ANSWER, { agentId: 'a1' })
  await k.finish('   \n')
  await k.finish(ANSWER, { reason: 'aborted' })

  expect(k.writes).toEqual([])
})

test('HUSH_DISABLE=1 adds nothing', async ($, on) => {
  const k = kit($, on, { env: { ...HOME_ENV, HUSH_DISABLE: '1' } })

  await k.finish()

  expect(k.writes).toEqual([])
})

test('a failing write is swallowed, and the turn still completes', async ($, on) => {
  const k = kit($, on, { env: HOME_ENV, failWrite: true })

  await expect(k.finish()).resolves.toBeDefined()
  expect(k.writes).toEqual([TALLY])
})

test('a failing read starts a new count, and a damaged file is replaced by one', async ($, on) => {
  const k = kit($, on, { env: HOME_ENV, files: { [TALLY]: '{broken' } })

  await k.finish()

  expect(read(k)).toMatchObject({ messages: 1 })
})

test('a link to a place that does not exist misses links resolve', async ($, on) => {
  const k = kit($, on, { env: HOME_ENV })

  await k.finish(ANSWER.replace('read it.', 'open [a.js:1](src/a.js:1).'))

  expect(read(k).misses).toEqual({ 'links resolve': 1 })
})

test('the file holds no word of any reply', async ($, on) => {
  const k = kit($, on, { env: HOME_ENV })

  await k.finish('**Secret result words.**\n\nPrivate sentence about the token.')

  const text = k.files.get(norm(TALLY)) ?? ''
  expect(text).not.toMatch(/Secret|Private|token/)
  expect(Object.keys(JSON.parse(text)).sort()).toEqual(['last', 'messages', 'met', 'misses', 'since'])
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
